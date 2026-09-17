/**
 * Produce the §4 handover for one migration job — with no server and no database.
 *
 * The paid workflow is files on a laptop (BUSINESS.md §3), so this compiles MJML
 * in-process rather than POSTing to `/api/render`. That removes SQLite, drizzle
 * and the HTTP round-trip from the job entirely; the server survives only for a
 * future browser UI.
 *
 * Layout, in and out:
 *
 *   <job>/
 *     components/<id>.mjml   component bodies; the path under components/ IS
 *                            the component-id (shoe-brand/footer.mjml ->
 *                            "shoe-brand/footer")
 *     templates/*.mjml       the rewired templates, carrying <mj-component/>
 *     originals/*.mjml       (optional) the agency's untouched files
 *   ->
 *     proof/<name>.before.html   render of originals/<name>.mjml
 *     proof/<name>.after.html    render of the expanded template
 *     proof/REPORT.md            per template: identical / differs, and why
 *     plain-export/<name>.mjml   expanded MJML, no references left
 *
 * Usage:
 *   npm run handover -- <job-dir>
 *   npm run handover -- <job-dir> --check   verify only, write nothing
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
// mjml ships an ESM/CJS hybrid; the default export is the compile function.
// Typed in ../declarations.d.ts — there is no @types/mjml for v4.
import mjml2html from "mjml";
import {
  COMPONENT_TAG,
  InMemoryComponentStore,
  expand,
  ExpansionError,
} from "../shared/components/index.js";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
};

class HandoverError extends Error {}

/** Every .mjml under `dir`, recursively, as paths relative to `dir`. */
function mjmlFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".mjml")) out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Compile one template to HTML, refusing the two failures that would otherwise
 * ship silently. Both are lifted from `src/server/routes/render.ts`, where they
 * guarded the same compile behind HTTP status codes.
 */
function renderOrThrow(name: string, source: string): string {
  // mjml resolves <mj-include path="..."/> against the local filesystem, and its
  // traversal fix (CVE-2020-12827) is incomplete through 4.18.0, the pinned
  // version. In this workflow the file it would read is YOUR disk, and the
  // contents would be pasted into a template you hand to a client.
  if (/<\s*mj-include(?![\w-])/i.test(source)) {
    throw new HandoverError(
      `${name}: <mj-include/> is not supported — it reads files from your filesystem.`
    );
  }

  let result: ReturnType<typeof mjml2html>;
  try {
    result = mjml2html(source, { validationLevel: "soft" });
  } catch (err) {
    throw new HandoverError(`${name}: MJML could not be compiled: ${(err as Error).message}`);
  }

  const errors = (result.errors ?? []).map((e) => {
    const raw =
      typeof e === "string"
        ? e
        : String(
            (e as { formattedMessage?: string; message?: string })?.formattedMessage ??
              (e as { message?: string })?.message ??
              e
          );
    return raw.replace(/^Line (\d+) of \S+ /, "Line $1 ");
  });

  // The authoritative survivor check. Our own expander proves a reference did
  // not survive OUR scan; this proves it did not survive the COMPILER, which is
  // the only opinion that decides what reaches the recipient. An unexpanded
  // reference compiles to a clean-looking email with the block silently absent.
  const survived = errors.filter((e) => e.includes(COMPONENT_TAG));
  if (survived.length > 0) {
    throw new HandoverError(
      `${name}: a <${COMPONENT_TAG}/> reached the compiler unexpanded — the block would be ` +
        `silently missing from the delivered email: ${survived.join("; ")}`
    );
  }

  // Anything else mjml flagged is reported but not fatal: soft validation warns
  // about markup this tool did not author and the customer may rely on.
  if (errors.length > 0) {
    for (const e of errors) console.log(c.yellow(`    warn ${name}: ${e}`));
  }
  return result.html;
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

  // ---- publish every component body from components/ ----
  const store = new InMemoryComponentStore();
  const componentFiles = mjmlFilesUnder(componentsDir);
  if (componentFiles.length === 0) {
    console.error(c.red(`no .mjml component bodies found under ${componentsDir}`));
    process.exit(2);
  }
  console.log(c.bold("\ncomponents"));
  for (const rel of componentFiles) {
    // The path under components/ is the id, so nesting gives you the brand
    // prefix for free: shoe-brand/footer.mjml -> "shoe-brand/footer".
    const id = rel.slice(0, -".mjml".length).split(sep).join("/");
    const body = readFileSync(join(componentsDir, rel), "utf8").trimEnd();
    try {
      // publish() enforces the single-root and comment invariants, naming the
      // component being edited rather than some template that references it.
      store.publish(id, body);
    } catch (err) {
      console.error(c.red(`  ${id}: ${(err as Error).message}`));
      process.exit(1);
    }
    console.log(`  ${c.green("published")} ${id}@1  ${c.dim(`${body.length}B`)}`);
  }

  // ---- expand + render every template ----
  const templates = mjmlFilesUnder(templatesDir);
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
    const name = rel.slice(0, -".mjml".length);
    const rewired = readFileSync(join(templatesDir, rel), "utf8");

    let expanded: string;
    try {
      expanded = expand(rewired, store).mjml;
    } catch (err) {
      const msg = err instanceof ExpansionError ? err.message : String(err);
      console.log(`  ${c.red("FAIL")} ${name}  expansion: ${msg}`);
      rows.push({ name, identical: null, note: `expansion failed: ${msg}` });
      failures++;
      continue;
    }

    let after: string;
    try {
      after = renderOrThrow(name, expanded);
    } catch (err) {
      console.log(`  ${c.red("FAIL")} ${name}  ${(err as Error).message}`);
      rows.push({ name, identical: null, note: (err as Error).message });
      failures++;
      continue;
    }

    // proof/ needs a BEFORE to compare against. Without originals/ there is
    // nothing to prove, so say so rather than emitting a one-sided "proof".
    const originalPath = join(originalsDir, rel);
    let identical: boolean | null = null;
    let note = "no originals/ — nothing to compare against";
    if (existsSync(originalPath)) {
      const original = readFileSync(originalPath, "utf8");
      const before = renderOrThrow(`${name} (before)`, original);
      identical = sha(before) === sha(after);
      note = identical
        ? "before/after renders identical"
        : `renders DIFFER (before ${before.length}B, after ${after.length}B)`;
      if (!identical) failures++;
      if (!checkOnly) {
        writeFileSync(join(proofDir, `${name.split(sep).join("-")}.before.html`), before);
      }
    }

    if (!checkOnly) {
      writeFileSync(join(proofDir, `${name.split(sep).join("-")}.after.html`), after);
      const outPlain = join(plainDir, rel);
      mkdirSync(join(outPlain, ".."), { recursive: true });
      writeFileSync(outPlain, expanded);
    }

    const mark = identical === null ? c.yellow("  ? ") : identical ? c.green(" OK ") : c.red("DIFF");
    console.log(`  ${mark} ${name}  ${c.dim(note)}`);
    rows.push({ name, identical, note });
  }

  if (!checkOnly) {
    const lines = [
      "# Proof — before vs after",
      "",
      "Each template was rendered twice: once from the original MJML you sent,",
      "once from the migrated template after its components were pasted back in.",
      "Identical means the two HTML outputs match byte for byte.",
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
      `\n${identicalCount}/${comparable.length} byte-identical renders` +
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
