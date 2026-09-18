#!/usr/bin/env node

import { input } from "@inquirer/prompts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yargs from "yargs/yargs";
import { decodeHtml, minifyHtmlForLuna, stripMarkers } from "../src/htmlTargets.js";
import { DEFAULT_MODEL } from "../src/luna.js";
import {
  REQUESTED_ITEM_SCHEMA,
  REQUESTED_ITEM_SCHEMA_NAME,
  buildRequestedItemPrompt,
} from "../src/itemResolver.js";

const devDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(devDirectory, "..");
export const defaultEmailFile = path.join(rootDirectory, "asset", "sample.html");

export function requestedItemPrompt({ request, file = defaultEmailFile }) {
  if (!request?.trim()) throw new Error("A request is required.");
  const resolved = path.resolve(file);
  const source = decodeHtml(fs.readFileSync(resolved), file);
  return {
    file: resolved,
    prompt: buildRequestedItemPrompt(request, minifyHtmlForLuna(stripMarkers(source))),
    sourceBytes: Buffer.byteLength(source),
  };
}

async function promptForMissing(values) {
  const request = values.request || await input({
    message: "What do you want to update?",
    required: true,
  });
  const file = values.file || await input({
    message: "Email file?",
    default: defaultEmailFile,
  });
  return { request, file };
}

export async function main(values = {}) {
  const selected = await promptForMissing(values);
  const result = requestedItemPrompt(selected);
  const promptBytes = Buffer.byteLength(result.prompt);
  console.log({
    request: selected.request,
    source: result.file,
    model: DEFAULT_MODEL,
    schema: REQUESTED_ITEM_SCHEMA_NAME,
    sourceBytes: result.sourceBytes,
    promptBytes,
    estimatedTokens: Math.round(promptBytes / 4),
  });
  console.log("\nResponse schema:\n");
  console.log(JSON.stringify(REQUESTED_ITEM_SCHEMA, null, 2));
  console.log("\nPrompt:\n");
  console.log(result.prompt);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const argv = yargs(process.argv.slice(2)).parse();
  main({ request: argv.value1, file: argv.value2 }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
