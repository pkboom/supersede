import { input } from "@inquirer/prompts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yargs from "yargs/yargs";
import {
  buildAnnotatedView,
  decodeHtml,
} from "../src/htmlTargets.js";
import { extractRelatedPartWithLuna } from "../src/partExtractor.js";

const devDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(devDirectory, "..");
export const defaultEmailFile = path.join(rootDirectory, "asset", "sample.html");
export const defaultOutputFile = path.join(rootDirectory, "asset", "extracted-pattern.html");

export async function extractElement({ find, file = defaultEmailFile, model, runLuna }) {
  const source = decodeHtml(fs.readFileSync(path.resolve(file)), file);
  const view = buildAnnotatedView(source);
  const part = await extractRelatedPartWithLuna(source, { text: find, model, runLuna });
  return {
    file: path.resolve(file),
    editableTargets: view.targets.size,
    part,
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
  const result = await extractElement(selected);
  fs.writeFileSync(defaultOutputFile, result.part.html, "utf8");
  console.log({
    find: selected.find,
    source: result.file,
    editableTargets: result.editableTargets,
    analyzedElements: result.part.analyzedElements,
    extractedTag: result.part.tagName,
    output: defaultOutputFile,
  });
  console.log("\nElement:\n");
  console.log(result.part.html);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const argv = yargs(process.argv.slice(2)).string(["value1", "value2", "value3"]).parse();
  main({ find: argv.value1, file: argv.value2 }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
