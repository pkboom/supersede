import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { input } from "@inquirer/prompts";
import { DEFAULT_MODEL } from "./luna.js";
import { runEmailPatternWorkflow } from "./patternWorkflow.js";

const USAGE = `
Usage:

  node src/index.js [INPUT] [OUTPUT] [options]

Run it with no arguments and it asks what you want to do, then where. Anything
you supply up front is not asked for again, so a fully specified command never
prompts and stays usable from a script.

Options:

  --instruction TEXT
  --instruction-file FILE
  --artifacts DIR             default: OUTPUT.evidence
  --model MODEL               default: ${DEFAULT_MODEL}
  --max-validation-attempts N default: 2

The command loops over unprocessed emails. It keeps the first email as the seed,
compares it with the second, then the third, until two files establish a shared
pattern. It applies that pattern wherever it matches, validates every result,
and repeats with failed or unmatched files.
`;

const VALUE_OPTIONS = new Set([
  "--instruction",
  "--instruction-file",
  "--artifacts",
  "--model",
  "--max-validation-attempts",
]);

export function splitArguments(args) {
  const positional = [];
  const flags = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    if (!VALUE_OPTIONS.has(argument)) throw new Error(`Unknown option: ${argument}${USAGE}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argument} requires a value.${USAGE}`);
    flags.push([argument, value]);
    index += 1;
  }
  if (positional.length > 2) throw new Error(`Unexpected argument: ${positional[2]}${USAGE}`);
  return { positional, flags };
}

export function parseOptions(flags) {
  let instruction;
  let instructionFile;
  let artifacts;
  let model = DEFAULT_MODEL;
  let maxValidationAttempts = 2;
  for (const [option, value] of flags) {
    if (option === "--instruction") instruction = value;
    else if (option === "--instruction-file") instructionFile = value;
    else if (option === "--artifacts") artifacts = value;
    else if (option === "--model") model = value;
    else {
      maxValidationAttempts = Number(value);
      if (!Number.isInteger(maxValidationAttempts) || maxValidationAttempts < 1 || maxValidationAttempts > 10) {
        throw new Error("--max-validation-attempts must be an integer from 1 to 10.");
      }
    }
  }
  if (instruction && instructionFile) throw new Error("Use --instruction or --instruction-file, not both.");
  if (instructionFile) instruction = fs.readFileSync(path.resolve(instructionFile), "utf8");
  if (instruction !== undefined && !instruction.trim()) throw new Error(`An edit instruction is required.${USAGE}`);
  return { instruction, artifacts, model, maxValidationAttempts };
}

const askForInput = {
  instruction: () => input({ message: "What do you want?", required: true }),
  input: () => input({ message: "Folder of emails to read?", required: true }),
  output: () => input({ message: "Folder to write?", required: true }),
};

export async function resolvePlan(args, ask = askForInput) {
  const { positional, flags } = splitArguments(args);
  const options = parseOptions(flags);
  const instruction = options.instruction ?? await ask.instruction();
  if (!instruction?.trim()) throw new Error(`An edit instruction is required.${USAGE}`);
  const inputDirectory = positional[0] ?? await ask.input();
  const outputDirectory = positional[1] ?? await ask.output();
  const output = path.resolve(outputDirectory);
  return {
    instruction,
    input: path.resolve(inputDirectory),
    output,
    artifacts: options.artifacts ? path.resolve(options.artifacts) : `${output}.evidence`,
    model: options.model,
    maxValidationAttempts: options.maxValidationAttempts,
  };
}

export async function main(args = process.argv.slice(2), ask = askForInput) {
  const plan = await resolvePlan(args, ask);
  const report = await runEmailPatternWorkflow(plan.input, plan.output, plan.instruction, plan.artifacts, {
    model: plan.model,
    maxValidationAttempts: plan.maxValidationAttempts,
  });
  console.log({
    status: report.status,
    patterns: report.patterns.length,
    processed: report.processed.length,
    reviews: report.reviews.length,
    artifacts: plan.artifacts,
  });
  if (report.status !== "pass") process.exitCode = 2;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
