import { input } from "@inquirer/prompts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yargs from "yargs/yargs";
import { buildElementAnnotatedView, decodeHtml } from "../src/htmlTargets.js";
import { DEFAULT_MODEL } from "../src/luna.js";
import { PART_SCHEMA, PART_SCHEMA_NAME, buildRelatedPartPrompt } from "../src/partExtractor.js";

const devDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(devDirectory, "..");
export const defaultEmailFile = path.join(rootDirectory, "asset", "sample.html");

export function extractElementPrompt({ find, file = defaultEmailFile }) {
  if (!find?.trim()) throw new Error("A find phase is required.");
  const resolved = path.resolve(file);
  const source = decodeHtml(fs.readFileSync(resolved), file);
  const view = buildElementAnnotatedView(source);
  return {
    file: resolved,
    prompt: buildRelatedPartPrompt(find, view.html),
    analyzedElements: view.elements.size,
    sourceBytes: Buffer.byteLength(source),
  };
}

async function promptForMissing(values) {
  const find = values.find || await input({
    message: "What should I find?",
    required: true,
  });
  const file = values.file || await input({
    message: "Email file?",
    default: defaultEmailFile,
  });
  return { find, file };
}

export async function main(values = {}) {
  const selected = await promptForMissing(values);
  const result = extractElementPrompt(selected);
  const promptBytes = Buffer.byteLength(result.prompt);
  console.log({
    find: selected.find,
    source: result.file,
    model: DEFAULT_MODEL,
    schema: PART_SCHEMA_NAME,
    analyzedElements: result.analyzedElements,
    sourceBytes: result.sourceBytes,
    promptBytes,
    estimatedTokens: Math.round(promptBytes / 4),
  });
  console.log("\nResponse schema:\n");
  console.log(JSON.stringify(PART_SCHEMA, null, 2));
  console.log("\nPrompt:\n");
  console.log(result.prompt);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const argv = yargs(process.argv.slice(2)).string(["value1", "value2", "value3"]).parse();
  main({ find: argv.value1, file: argv.value2 }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
