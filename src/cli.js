import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirm, input } from "@inquirer/prompts";
import { commitChange, narrowProposal, proposeChange, readJob, remainingFiles } from "./job.js";
import { replacementLanded } from "./pipeline/narrowChange.js";
import { processedFiles, readProgress } from "./pipeline/progress.js";
import { splitRequestWithLuna } from "./pipeline/splitRequest.js";

const DEFAULT_WORKSPACE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "asset",
  "delta",
);

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
      split = await splitRequestWithLuna(await ask.instruction(), options);
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

const isMain = process.argv[1] && import.meta.filename === realpathSync(path.resolve(process.argv[1]));
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
