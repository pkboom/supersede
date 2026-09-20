import fs from "node:fs";
import path from "node:path";

const PROGRESS_FILE = "progress.json";
const LOG_FILE = "log.md";
export const CHANGES_DIRECTORY = "changes";

export function readProgress(workspace) {
  const file = path.join(path.resolve(workspace), PROGRESS_FILE);
  if (!fs.existsSync(file)) return { version: 1, changes: [] };
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed?.changes)) throw new Error(`Unreadable progress file: ${file}`);
  return parsed;
}

export function currentSweep(progress) {
  return progress.changes.at(-1)?.sweep ?? 1;
}

export function recordChange(workspace, progress, entry) {
  const root = path.resolve(workspace);
  const next = { ...progress, changes: [...progress.changes, entry] };
  fs.writeFileSync(path.join(root, PROGRESS_FILE), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  appendLog(root, entry);
  return next;
}

function truncate(value, limit = 100) {
  const flat = String(value).replace(/\s+/gu, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function formatLogEntry(entry) {
  const lines = [`## ${entry.at} — ${truncate(entry.request)}`, ""];
  if (entry.instruction) lines.push(`- asked: ${truncate(entry.instruction, 200)}`);
  lines.push(`- sweep: ${entry.sweep}`);
  lines.push(`- find: ${truncate(entry.find, 200)}`);
  lines.push(`- replace with: ${truncate(entry.replacement, 200)}`);
  lines.push(`- seed: \`${entry.seed}\``);
  lines.push(`- element: \`${entry.elementTag}\`, ${entry.elementBytes} bytes`);
  lines.push(`- span: ${entry.spanBytes} bytes (${entry.blastRadius})`);
  lines.push(`- from: \`${truncate(entry.from)}\``);
  lines.push(`- to: \`${truncate(entry.to)}\``);
  lines.push(`- script: \`${entry.script}\` — ${entry.applied ? "applied" : "refused, files unchanged"}`);
  lines.push("", "| file | matches |", "|---|---|");
  for (const file of entry.perFile) lines.push(`| \`${file.file}\` | ${file.status} (${file.occurrences}) |`);
  lines.push("", `**${entry.files.length} file${entry.files.length === 1 ? "" : "s"} covered — ${entry.determinism}**`, "");
  return lines.join("\n");
}

function appendLog(workspace, entry) {
  const file = path.join(path.resolve(workspace), LOG_FILE);
  const header = fs.existsSync(file) ? "" : "# Job log\n\n";
  fs.appendFileSync(file, `${header}${formatLogEntry(entry)}\n`, "utf8");
  return file;
}

export function writeChangeScript(workspace, name, contents) {
  const directory = path.join(path.resolve(workspace), CHANGES_DIRECTORY);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${name}.mjs`);
  fs.writeFileSync(file, contents, "utf8");
  return file;
}
