import { input } from "@inquirer/prompts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yargs from "yargs/yargs";
import { decodeHtml } from "../src/htmlTargets.js";
import { DEFAULT_MODEL } from "../src/luna.js";
import { resolveRequestedItemWithLuna } from "../src/itemResolver.js";

const devDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(devDirectory, "..");
export const defaultEmailFile = path.join(rootDirectory, "asset", "sample.html");

export async function resolveRequestedItem({ request, file = defaultEmailFile, model, runLuna }) {
  const resolved = path.resolve(file);
  const source = decodeHtml(fs.readFileSync(resolved), file);
  const result = await resolveRequestedItemWithLuna(source, { request, model, runLuna });
  return { file: resolved, ...result };
}

async function promptForMissing(values) {
  const request =
    values.request ||
    (await input({
      message: "What do you want to update?",
      required: true,
    }));
  const file =
    values.file ||
    (await input({
      message: "Email file?",
      default: defaultEmailFile,
    }));
  return { request, file };
}

export async function main(values = {}) {
  const selected = await promptForMissing(values);
  const result = await resolveRequestedItem(selected);
  console.log({
    request: selected.request,
    source: result.file,
    model: DEFAULT_MODEL,
    refinedRequest: result.refinedRequest,
    current: result.current,
    replacement: result.replacement,
    foundVerbatim: result.foundVerbatim,
  });
  console.log(`\nReason: ${result.reason}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const argv = yargs(process.argv.slice(2)).parse();
  main({ request: argv.value1, file: argv.value2 }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
