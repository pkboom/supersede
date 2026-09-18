#!/usr/bin/env node

import { input } from "@inquirer/prompts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yargs from "yargs/yargs";
import { buildElementAnnotatedView, decodeHtml } from "../src/htmlTargets.js";
import { DEFAULT_MODEL } from "../src/luna.js";
import {
  PART_SCHEMA,
  PART_SCHEMA_NAME,
  REPLACEMENT_SCHEMA,
  buildRelatedPartPrompt,
  buildReplacementPrompt,
} from "../src/partExtractor.js";

const devDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(devDirectory, "..");
export const defaultEmailFile = path.join(rootDirectory, "asset", "sample.html");

export function extractElementPrompt({ text, file = defaultEmailFile }) {
  if (!text?.trim()) throw new Error("A requested item is required.");
  const resolved = path.resolve(file);
  const source = decodeHtml(fs.readFileSync(resolved), file);
  const view = buildElementAnnotatedView(source);
  return {
    file: resolved,
    prompt: buildRelatedPartPrompt(text, view.html),
    analyzedElements: view.elements.size,
    sourceBytes: Buffer.byteLength(source),
  };
}

async function promptForMissing(values) {
  const text = values.text || await input({
    message: "Requested item?",
    required: true,
  });
  const file = values.file || await input({
    message: "Email file?",
    default: defaultEmailFile,
  });
  return { text, file };
}

export async function main(values = {}) {
  const selected = await promptForMissing(values);
  const result = extractElementPrompt(selected);
  const promptBytes = Buffer.byteLength(result.prompt);
  console.log({
    requestedItem: selected.text,
    source: result.file,
    model: DEFAULT_MODEL,
    schema: PART_SCHEMA_NAME,
    analyzedElements: result.analyzedElements,
    sourceBytes: result.sourceBytes,
    promptBytes,
    estimatedTokens: Math.round(promptBytes / 4),
  });
  console.log("\nResponse schemas:\n");
  console.log(JSON.stringify({ select: PART_SCHEMA, rewrite: REPLACEMENT_SCHEMA }, null, 2));
  console.log("\nPrompt 1 of 2 — select the element:\n");
  console.log(result.prompt);
  console.log("\nPrompt 2 of 2 — rewrite it:\n");
  console.log(buildReplacementPrompt(selected.text, "<the selected element, exact original source>"));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const argv = yargs(process.argv.slice(2)).parse();
  main({ text: argv.value1, file: argv.value2 }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
