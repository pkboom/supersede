import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  COMPONENT_TAG,
  InMemoryComponentStore,
  expand,
  ExpansionError,
} from "../shared/components/index.js";
import { c } from "./term.js";

class HandoverError extends Error {}

/** Every .html under `dir`, recursively, relative to `dir`. */
function htmlFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".html")) out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * The last line of defence, and now the only one.
 *
 * There is no compiler and no validation step in this pipeline, so a surviving
 * reference is not an error anywhere — it renders as nothing, and the email
 * ships without its footer. That is why this runs over the FINAL bytes, after
 * every substitution, rather than trusting the expander's own guard.
 */
function assertNoSurvivors(name: string, html: string): void {
  const survivors = [...html.matchAll(new RegExp(`<\\s*${COMPONENT_TAG}(?![\\w-])`, "gi"))];
  if (survivors.length > 0) {
    throw new HandoverError(
      `${name}: ${survivors.length} <${COMPONENT_TAG}/> reference(s) survived expansion — ` +
        `the block would be silently missing from the delivered email ` +
        `(first at byte ${survivors[0]!.index}).`
    );
  }
}

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function main(): void {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const jobDir = args.find((a) => !a.startsWith("--"));
  if (!jobDir) {
    console.error("usage: npm run handover -- <job-dir> [--check]");
    process.exit(2);
  }

  const componentsDir = join(jobDir, "components");
  const templatesDir = join(jobDir, "templates");
  const originalsDir = join(jobDir, "originals");
  for (const d of [componentsDir, templatesDir]) {
    if (!existsSync(d)) {
      console.error(c.red(`missing required directory: ${d}`));
      process.exit(2);
    }
  }

  const store = new InMemoryComponentStore();
  const componentFiles = htmlFilesUnder(componentsDir);
  if (componentFiles.length === 0) {
    console.error(c.red(`no .html component bodies found under ${componentsDir}`));
    process.exit(2);
  }
  console.log(c.bold("\ncomponents"));
  for (const rel of componentFiles) {
    // shoe-brand/footer.html -> "shoe-brand/footer", so nesting gives you the
    // brand prefix for free.
    const id = rel.slice(0, -".html".length).split(sep).join("/");
    const body = readFileSync(join(componentsDir, rel), "utf8").trimEnd();
    try {
      store.publish(id, body);
    } catch (err) {
      console.error(c.red(`  ${id}: ${(err as Error).message}`));
      process.exit(1);
    }
    console.log(`  ${c.green("published")} ${id}@1  ${c.dim(`${body.length}B`)}`);
  }

  const templates = htmlFilesUnder(templatesDir);
  const proofDir = join(jobDir, "proof");
  const plainDir = join(jobDir, "plain-export");
  if (!checkOnly) {
    mkdirSync(proofDir, { recursive: true });
    mkdirSync(plainDir, { recursive: true });
  }

  const rows: Array<{ name: string; identical: boolean | null; note: string }> = [];
  let failures = 0;

  console.log(c.bold("\ntemplates"));
  for (const rel of templates) {
    const name = rel.slice(0, -".html".length);
    const rewired = readFileSync(join(templatesDir, rel), "utf8");

    let after: string;
    try {
      after = expand(rewired, store).html;
      assertNoSurvivors(name, after);
    } catch (err) {
      const msg = err instanceof ExpansionError || err instanceof HandoverError
        ? (err as Error).message
        : String(err);
      console.log(`  ${c.red("FAIL")} ${name}  ${msg}`);
      rows.push({ name, identical: null, note: msg });
      failures++;
      continue;
    }

    // Without originals/ there is nothing to prove, which is worth saying
    // rather than emitting a one-sided "proof".
    //
    // With no compiler in the pipeline, before and after are both plain HTML,
    // so this compares the delivered bytes directly instead of comparing two
    // renders of them, which cannot be satisfied by two different inputs that
    // happen to render the same way.
    const originalPath = join(originalsDir, rel);
    let identical: boolean | null = null;
    let note = "no originals/ — nothing to compare against";
    if (existsSync(originalPath)) {
      const before = readFileSync(originalPath, "utf8");
      identical = sha(before) === sha(after);
      note = identical
        ? "before/after byte-identical"
        : `bytes DIFFER (before ${before.length}B, after ${after.length}B)`;
      if (!identical) failures++;
      if (!checkOnly) {
        writeFileSync(join(proofDir, `${name.split(sep).join("-")}.before.html`), before);
      }
    }

    if (!checkOnly) {
      writeFileSync(join(proofDir, `${name.split(sep).join("-")}.after.html`), after);
      const outPlain = join(plainDir, rel);
      mkdirSync(join(outPlain, ".."), { recursive: true });
      writeFileSync(outPlain, after);
    }

    const mark = identical === null ? c.yellow("  ? ") : identical ? c.green(" OK ") : c.red("DIFF");
    console.log(`  ${mark} ${name}  ${c.dim(note)}`);
    rows.push({ name, identical, note });
  }

  if (!checkOnly) {
    const lines = [
      "# Proof — before vs after",
      "",
      "Each template appears twice: the original HTML you sent, and the migrated",
      "template after its components were pasted back in. Identical means the two",
      "files match byte for byte — not that they look the same, that they ARE the",
      "same bytes.",
      "",
      "| template | result |",
      "|---|---|",
      ...rows.map(
        (r) =>
          `| ${r.name} | ${r.identical === null ? "—" : r.identical ? "identical" : "DIFFERS"} — ${r.note} |`
      ),
      "",
    ];
    writeFileSync(join(proofDir, "REPORT.md"), lines.join("\n"));
  }

  const comparable = rows.filter((r) => r.identical !== null);
  const identicalCount = comparable.filter((r) => r.identical).length;
  console.log(
    c.bold(
      `\n${identicalCount}/${comparable.length} byte-identical` +
        (comparable.length < rows.length
          ? c.dim(`  (${rows.length - comparable.length} without an original to compare)`)
          : "")
    )
  );
  if (!checkOnly) console.log(c.dim(`wrote ${proofDir} and ${plainDir}`));
  if (failures > 0) {
    console.log(c.red(`${failures} failure(s)`));
    process.exit(1);
  }
}

main();
