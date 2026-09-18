import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODEL } from "./luna.js";
import { runEmailPatternWorkflow } from "./patternWorkflow.js";

const USAGE = `
Usage:

  node src/index.js INPUT OUTPUT --instruction "requested change" [options]

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

function valueAfter(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value.${USAGE}`);
  return value;
}

function parseOptions(args, output) {
  let instruction;
  let instructionFile;
  let artifacts = `${output}.evidence`;
  let model = DEFAULT_MODEL;
  let maxValidationAttempts = 2;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--instruction") instruction = valueAfter(args, index++, option);
    else if (option === "--instruction-file") instructionFile = valueAfter(args, index++, option);
    else if (option === "--artifacts") artifacts = path.resolve(valueAfter(args, index++, option));
    else if (option === "--model") model = valueAfter(args, index++, option);
    else if (option === "--max-validation-attempts") {
      maxValidationAttempts = Number(valueAfter(args, index++, option));
      if (!Number.isInteger(maxValidationAttempts) || maxValidationAttempts < 1 || maxValidationAttempts > 10) {
        throw new Error("--max-validation-attempts must be an integer from 1 to 10.");
      }
    } else throw new Error(`Unknown option: ${option}${USAGE}`);
  }
  if (instruction && instructionFile) throw new Error("Use --instruction or --instruction-file, not both.");
  if (instructionFile) instruction = fs.readFileSync(path.resolve(instructionFile), "utf8");
  if (!instruction?.trim()) throw new Error(`An edit instruction is required.${USAGE}`);
  return { instruction, artifacts: path.resolve(artifacts), model, maxValidationAttempts };
}

export async function main(args = process.argv.slice(2)) {
  const [inputArgument, outputArgument, ...rest] = args;
  if (!inputArgument || !outputArgument) throw new Error(USAGE);
  const input = path.resolve(inputArgument);
  const output = path.resolve(outputArgument);
  const options = parseOptions(rest, output);
  const report = await runEmailPatternWorkflow(input, output, options.instruction, options.artifacts, {
    model: options.model,
    maxValidationAttempts: options.maxValidationAttempts,
  });
  console.log({
    status: report.status,
    patterns: report.patterns.length,
    processed: report.processed.length,
    reviews: report.reviews.length,
    artifacts: options.artifacts,
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
