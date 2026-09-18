import { input } from "@inquirer/prompts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yargs from "yargs/yargs";
import { decodeHtml } from "../src/htmlTargets.js";
import { resolveRequestedItemWithLuna } from "../src/itemResolver.js";
import { extractRelatedPartWithLuna } from "../src/partExtractor.js";
import { checkDeterminism, narrowChangeWithLuna } from "../src/changeNarrower.js";

const devDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(devDirectory, "..");
export const defaultWorkspace = path.join(rootDirectory, "workspace", "delta");

const SKIPPED = new Set(["updated", ".git", ".omc", ".omx", "node_modules"]);

export function readWorkspace(directory) {
  const root = path.resolve(directory);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Workspace is not a directory: ${root}`);
  }
  const files = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !SKIPPED.has(entry.name))
    .filter((entry) => [".html", ".htm"].includes(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
  if (files.length < 2) throw new Error(`Narrowing needs at least two emails, found ${files.length} in ${root}.`);
  return {
    root,
    files: files.map((id) => ({ id, source: decodeHtml(fs.readFileSync(path.join(root, id)), id) })),
  };
}

export async function narrowChange({ request, directory, model, runLuna }) {
  const workspace = readWorkspace(directory);
  const [seed, ...rest] = workspace.files;
  const resolved = await resolveRequestedItemWithLuna(seed.source, { request, model, runLuna });
  const element = await extractRelatedPartWithLuna(seed.source, { text: resolved.refinedRequest, model, runLuna });
  const change = await narrowChangeWithLuna(element.html, {
    text: resolved.refinedRequest,
    expectFrom: resolved.current,
    model,
    runLuna,
  });
  const determinism = checkDeterminism(workspace.files, change);
  return {
    workspace,
    seed,
    partner: rest[0],
    resolved,
    element,
    change,
    determinism,
    blastRadius: { element: element.html.length, span: change.from.length },
  };
}

async function promptForMissing(values) {
  const request = values.request || await input({
    message: "What do you want to update?",
    required: true,
  });
  const directory = values.directory || await input({
    message: "Workspace folder?",
    default: defaultWorkspace,
  });
  return { request, directory };
}

export async function main(values = {}) {
  const selected = await promptForMissing(values);
  const result = await narrowChange(selected);
  const { element, span } = result.blastRadius;
  console.log({
    request: selected.request,
    workspace: result.workspace.root,
    seed: result.seed.id,
    partner: result.partner.id,
    refinedRequest: result.resolved.refinedRequest,
    elementTag: result.element.tagName,
    elementBytes: element,
    spanBytes: span,
    blastRadius: `${((span / element) * 100).toFixed(1)}% of the element`,
    determinism: result.determinism.status,
  });
  console.log("\nDeterministic change:\n");
  console.log(`  - ${result.change.from}`);
  console.log(`  + ${result.change.to}`);
  console.log("\nMatches per file:\n");
  for (const entry of result.determinism.perFile) {
    console.log(`  ${entry.file}: ${entry.status} (${entry.occurrences})`);
  }
  if (result.determinism.status !== "deterministic") process.exitCode = 2;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const argv = yargs(process.argv.slice(2)).parse();
  main({ request: argv.value1, directory: argv.value2 }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
