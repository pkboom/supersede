import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { decodeHtml } from "./html.js";
import { extractRelatedPartWithLuna } from "./pipeline/extractElement.js";
import { buildChangeRequest, checkDeterminism, narrowChangeWithLuna } from "./pipeline/narrowChange.js";
import { CHANGES_DIRECTORY, currentSweep, recordChange, writeChangeScript } from "./pipeline/progress.js";
import { buildReplacementScript, changeSlug } from "./pipeline/replacementScript.js";

const SKIPPED = new Set([CHANGES_DIRECTORY, ".git", ".omc", ".omx", "node_modules"]);

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

export function remainingJob(job, progress, sweep = currentSweep(progress)) {
  const swept = progress.changes.filter((change) => change.sweep === sweep);
  const done = new Set(swept.flatMap((change) => change.files ?? []));
  return { root: job.root, files: job.files.filter((file) => !done.has(file.id)) };
}

export async function proposeChange(job, find, { onMiss, ...options } = {}) {
  if (!find?.trim()) throw new Error("A find phase is required.");
  if (!job.files.length) throw new Error("No file is left to check in this sweep.");
  for (const [index, seed] of job.files.entries()) {
    try {
      const element = await extractRelatedPartWithLuna(seed.source, { ...options, text: find });
      return { seed, find, element };
    } catch (error) {
      if (error?.status === "not_found") {
        onMiss?.(seed.id, error.message);
        continue;
      }
      if (!error?.status) throw error;
      const rest = job.files.length - index - 1;
      const where = rest ? `${seed.id}, and the files after it were not checked` : seed.id;
      throw Object.assign(new Error(`${error.message} (${where})`), { status: error.status });
    }
  }
  throw new Error("no file still to check holds the element for that request");
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

function runChangeScript(root, script, { run = execFileSync } = {}) {
  try {
    return { ok: true, output: run(process.execPath, [path.join(root, script)], { encoding: "utf8" }) };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    return { ok: false, output: output || (error instanceof Error ? error.message : String(error)) };
  }
}

export function commitChange(job, progress, { instruction, proposal, narrowed, sweep }, options = {}) {
  if (typeof sweep !== "number") throw new Error("A sweep number is required.");
  const name = changeSlug(proposal.find, progress.changes.length + 1);
  const script = path.relative(job.root, writeChangeScript(job.root, name, buildReplacementScript({
    request: narrowed.request,
    from: narrowed.change.from,
    to: narrowed.change.to,
    files: narrowed.covered,
  })));
  const applied = runChangeScript(job.root, script, options);
  const before = new Map(job.files.map((file) => [file.id, file.source]));
  const landed = narrowed.covered.filter(
    (id) => decodeHtml(fs.readFileSync(path.join(job.root, id)), id) !== before.get(id),
  );
  const elementBytes = proposal.element.html.length;
  const spanBytes = narrowed.change.from.length;
  const next = recordChange(job.root, progress, {
    at: new Date().toISOString(),
    sweep,
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
    files: landed,
    script,
    applied: applied.ok,
  });
  return { progress: next, applied };
}
