import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirm, input, select } from "@inquirer/prompts";
import { commitChange, narrowProposal, proposeChange, readJob, remainingJob } from "./job.js";
import { replacementLanded } from "./pipeline/narrowChange.js";
import { currentSweep, readProgress } from "./pipeline/progress.js";
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

function names(files) {
  return files.map((file) => file.id).join(", ");
}

function reason(error) {
  return error instanceof Error ? error.message : String(error);
}

function fatal(error) {
  return error?.name === "ExitPromptError"
    || error instanceof TypeError
    || error instanceof ReferenceError
    || error instanceof RangeError;
}

function report(job, sweep, left) {
  const pending = new Set(left.map((file) => file.id));
  const done = job.files.filter((file) => !pending.has(file.id));
  console.log(`\nSweep ${sweep}: ${done.length} of ${plural(job.files.length, "file")} updated.`);
  if (done.length) console.log(`Updated: ${names(done)}`);
  console.log(left.length ? `Still to check: ${names(left)}` : "No files left to check.");
}

const askForInput = {
  workspace: () => input({ message: "Workspace folder?", default: DEFAULT_WORKSPACE }),
  instruction: () => input({ message: "What should I change?", required: true }),
  looksRight: () => confirm({ message: "Does this element look right?", default: true }),
  again: () => confirm({ message: "Another change?", default: true }),
  nextStep: () => select({
    message: "Some files were not updated. What next?",
    choices: [
      { name: "Describe the change for the variation in those files", value: "variations" },
      { name: "Leave them and start the next sweep", value: "sweep" },
      { name: "Stop", value: "stop" },
    ],
  }),
};

export async function main(args = process.argv.slice(2), ask = askForInput, options = {}) {
  let job = readJob(args[0] ?? await ask.workspace());
  let progress = readProgress(job.root);
  let sweep = currentSweep(progress);
  let scope = remainingJob(job, progress, sweep);

  async function nextRequest() {
    const left = scope.files.length;
    if (left && left < job.files.length) {
      const step = await ask.nextStep();
      if (step === "variations") return true;
      if (step === "stop") return false;
    } else if (!await ask.again()) {
      return false;
    }
    if (left !== job.files.length) {
      sweep += 1;
      scope = job;
      report(job, sweep, scope.files);
    }
    return true;
  }

  if (!scope.files.length) {
    sweep += 1;
    scope = job;
  }
  console.log(`\n${job.root}`);
  report(job, sweep, scope.files);
  if (scope.files.length < job.files.length && !await nextRequest()) {
    return { stopped: false, progress };
  }

  for (;;) {
    let instruction;
    let proposal;
    let narrowed;
    try {
      const split = await splitRequestWithLuna(await ask.instruction(), options);
      const { find, replacement } = split;
      instruction = split.instruction;
      console.log(`\nRequest: ${instruction}`);
      console.log(`Find: ${find}`);
      console.log(`Replace with: ${replacement}`);
      if (split.leaks) {
        console.log(`\nNote: what I search for still carries ${JSON.stringify(replacement)}. The email does not contain it yet, so check the element below is the one you meant.`);
      }

      proposal = await proposeChange(scope, find, {
        ...options,
        onMiss: (file, why) => console.log(`\nLuna found no element in ${file}: ${why}`),
      });
      console.log(`\nElement from ${proposal.seed.id} (${proposal.element.tagName}, ${proposal.element.html.length} bytes):\n`);
      console.log(proposal.element.html);

      if (!await ask.looksRight()) {
        console.log("\nStopped. Nothing was written.");
        return { stopped: true, progress };
      }

      narrowed = await narrowProposal(scope, proposal, replacement, options);
      const spanBytes = narrowed.change.from.length;
      console.log(`\nNarrowed to ${spanBytes} bytes (${((spanBytes / proposal.element.html.length) * 100).toFixed(1)}% of the element):\n`);
      console.log(`  - ${narrowed.change.from}`);
      console.log(`  + ${narrowed.change.to}`);
      if (narrowed.change.interpretation === "value" && !replacementLanded(narrowed.change.to, replacement)) {
        console.log(`\nNote: the narrowed result does not carry ${JSON.stringify(replacement)} literally. Read the two lines above before trusting it.`);
      }

      console.log("\nMatches per file still to check:\n");
      for (const entry of narrowed.determinism.perFile) {
        console.log(`  ${entry.file}: ${entry.status} (${entry.occurrences})`);
      }
      if (narrowed.determinism.status === "ambiguous") {
        throw new Error("the span appears more than once in a file still to check");
      }
    } catch (error) {
      if (fatal(error)) throw error;
      console.log(`\nI could not make that change: ${reason(error)}`);
      if (!await nextRequest()) return { stopped: false, progress };
      continue;
    }

    const committed = commitChange(scope, progress, { instruction, proposal, narrowed, sweep }, options);
    progress = committed.progress;
    console.log(`\nScript: ${path.join(job.root, progress.changes.at(-1).script)}\n`);
    console.log(committed.applied.output.trimEnd());
    if (!committed.applied.ok) {
      console.log("\nThe script refused at least one file. Those files are unchanged and still need checking.");
    }

    job = readJob(job.root);
    scope = remainingJob(job, progress, sweep);
    report(job, sweep, scope.files);

    const missed = scope.files.filter((file) => !narrowed.covered.includes(file.id));
    if (missed.length) {
      console.log(`\nNo match in ${names(missed)} — a variation of the part you asked for.`);
    } else if (!scope.files.length) {
      console.log("\nSweep complete.");
    }

    if (!await nextRequest()) return { stopped: false, progress };
  }
}

const isMain = process.argv[1] && import.meta.filename === realpathSync(path.resolve(process.argv[1]));
if (isMain) {
  main().catch((error) => {
    console.error(reason(error));
    process.exitCode = 1;
  });
}
