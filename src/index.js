import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirm, input } from "@inquirer/prompts";
import {
  buildChangeRequest,
  checkDeterminism,
  narrowChangeWithLuna,
  replacementLanded,
} from "./changeNarrower.js";
import { decodeHtml } from "./htmlTargets.js";
import { extractRelatedPartWithLuna } from "./partExtractor.js";
import { buildReplacementScript, changeSlug } from "./replacementScript.js";
import { splitRequestWithLuna } from "./requestSplitter.js";
import {
  CHANGES_DIRECTORY,
  processedFiles,
  readProgress,
  recordChange,
  writeChangeScript,
} from "./progress.js";

const SKIPPED = new Set([CHANGES_DIRECTORY, ".git", ".omc", ".omx", "node_modules"]);
const DEFAULT_WORKSPACE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "workspace",
  "delta",
);

export function readJob(workspace) {
  const root = path.resolve(workspace);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Workspace is not a directory: ${root}`);
  }
  const files = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !SKIPPED.has(entry.name))
    .filter((entry) => [".html", ".htm"].includes(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
  if (!files.length) throw new Error(`Workspace has no HTML files: ${root}`);
  return {
    root,
    files: files.map((id) => ({ id, source: decodeHtml(fs.readFileSync(path.join(root, id)), id) })),
  };
}

export function remainingFiles(job, progress) {
  const done = new Set(processedFiles(progress));
  return job.files.map((file) => file.id).filter((id) => !done.has(id));
}

export async function splitRequest(instruction, options = {}) {
  return splitRequestWithLuna(instruction, options);
}

export async function proposeChange(job, find, options = {}) {
  if (!find?.trim()) throw new Error("A find phase is required.");
  const seed = job.files[0];
  const element = await extractRelatedPartWithLuna(seed.source, { ...options, text: find });
  return { seed, find, element };
}

export async function narrowProposal(job, proposal, replacement, options = {}) {
  const request = buildChangeRequest(proposal.find, replacement);
  const change = await narrowChangeWithLuna(proposal.element.html, { ...options, text: request, replacement });
  const determinism = checkDeterminism(job.files, change);
  const covered = determinism.perFile
    .filter((entry) => entry.status === "unique")
    .map((entry) => entry.file);
  return { request, replacement, change, determinism, covered };
}

export function runChangeScript(root, script, { run = execFileSync } = {}) {
  try {
    return { ok: true, output: run(process.execPath, [path.join(root, script)], { encoding: "utf8" }) };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    return { ok: false, output: output || (error instanceof Error ? error.message : String(error)) };
  }
}

export function commitChange(job, progress, { instruction, proposal, narrowed }, options = {}) {
  const name = changeSlug(proposal.find, progress.changes.length + 1);
  const script = path.relative(job.root, writeChangeScript(job.root, name, buildReplacementScript({
    request: narrowed.request,
    from: narrowed.change.from,
    to: narrowed.change.to,
    files: narrowed.covered,
  })));
  const applied = runChangeScript(job.root, script, options);
  const elementBytes = proposal.element.html.length;
  const spanBytes = narrowed.change.from.length;
  const next = recordChange(job.root, progress, {
    at: new Date().toISOString(),
    instruction,
    find: proposal.find,
    replacement: narrowed.replacement,
    request: narrowed.request,
    seed: proposal.seed.id,
    elementTag: proposal.element.tagName,
    elementBytes,
    spanBytes,
    blastRadius: `${((spanBytes / elementBytes) * 100).toFixed(1)}% of the element`,
    from: narrowed.change.from,
    to: narrowed.change.to,
    determinism: narrowed.determinism.status,
    perFile: narrowed.determinism.perFile,
    files: narrowed.covered,
    script,
    applied: applied.ok,
  });
  return { progress: next, applied };
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function report(job, progress) {
  const done = processedFiles(progress);
  const left = remainingFiles(job, progress);
  console.log(`\n${plural(progress.changes.length, "change")} recorded, ${done.length} of ${plural(job.files.length, "file")} touched.`);
  if (done.length) console.log(`Processed: ${done.join(", ")}`);
  console.log(left.length ? `Still to check: ${left.join(", ")}` : "No files left to check.");
}

const askForInput = {
  workspace: () => input({ message: "Workspace folder?", default: DEFAULT_WORKSPACE }),
  instruction: () => input({ message: "What should I change?", required: true }),
  looksRight: () => confirm({ message: "Does this element look right?", default: true }),
  again: () => confirm({ message: "Another change?", default: true }),
};

export async function main(args = process.argv.slice(2), ask = askForInput, options = {}) {
  let job = readJob(args[0] ?? await ask.workspace());
  let progress = readProgress(job.root);
  console.log(`\n${job.root}`);
  report(job, progress);

  for (;;) {
    let split;
    try {
      split = await splitRequest(await ask.instruction(), options);
    } catch (error) {
      console.log(`\nI could not read that as one change: ${error instanceof Error ? error.message : String(error)}`);
      if (!await ask.again()) return { stopped: false, progress };
      continue;
    }
    const { instruction, find, replacement } = split;
    console.log(`\nRequest: ${instruction}`);
    console.log(`Find: ${find}`);
    console.log(`Replace with: ${replacement}`);
    if (split.leaks) {
      console.log(`\nNote: what I search for still carries ${JSON.stringify(replacement)}. The email does not contain it yet, so check the element below is the one you meant.`);
    }

    const proposal = await proposeChange(job, find, options);
    console.log(`\nElement from ${proposal.seed.id} (${proposal.element.tagName}, ${proposal.element.html.length} bytes):\n`);
    console.log(proposal.element.html);

    if (!await ask.looksRight()) {
      console.log("\nStopped. Nothing was written.");
      return { stopped: true, progress };
    }

    const narrowed = await narrowProposal(job, proposal, replacement, options);
    const spanBytes = narrowed.change.from.length;
    console.log(`\nNarrowed to ${spanBytes} bytes (${((spanBytes / proposal.element.html.length) * 100).toFixed(1)}% of the element):\n`);
    console.log(`  - ${narrowed.change.from}`);
    console.log(`  + ${narrowed.change.to}`);
    if (narrowed.change.interpretation === "value" && !replacementLanded(narrowed.change.to, replacement)) {
      console.log(`\nNote: the narrowed result does not carry ${JSON.stringify(replacement)} literally. Read the two lines above before trusting it.`);
    }
    console.log("\nMatches per file:\n");
    for (const entry of narrowed.determinism.perFile) {
      console.log(`  ${entry.file}: ${entry.status} (${entry.occurrences})`);
    }

    if (narrowed.determinism.status !== "deterministic") {
      console.log(`\nNot deterministic (${narrowed.determinism.status}). Nothing was written.`);
      if (!await ask.again()) return { stopped: false, progress };
      continue;
    }

    const committed = commitChange(job, progress, { instruction, proposal, narrowed }, options);
    progress = committed.progress;
    console.log(`\nScript: ${path.join(job.root, progress.changes.at(-1).script)}\n`);
    console.log(committed.applied.output.trimEnd());
    if (!committed.applied.ok) {
      console.log("\nThe script refused at least one file. Those files are unchanged and still need checking.");
    }

    job = readJob(job.root);
    report(job, progress);

    if (!await ask.again()) return { stopped: false, progress };
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
