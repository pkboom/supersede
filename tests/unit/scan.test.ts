import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan, type Candidate } from "../../src/cli/scan.js";

const CLI = join(__dirname, "..", "..", "src", "cli", "scan.ts");

const made: string[] = [];

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "scan-"));
  made.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

function page(n: number, ...blocks: string[]): string {
  return (
    `<html><head><title>Campaign ${n}</title></head><body>` +
    `<h1>Campaign ${n} headline, unlike any other headline here</h1>` +
    `<p>Body copy number ${n}, deliberately unique so only the shared blocks repeat.</p>` +
    blocks.join("") +
    `</body></html>`
  );
}

function byTag(report: { candidates: Candidate[] }, tag: string): Candidate[] {
  return report.candidates.filter((x) => x.tag === tag);
}

const FOOTER = (address: string): string =>
  `<table class="footer"><tbody><tr><td><p>Shoe Brand &middot; ${address} &middot; Unsubscribe</p></td></tr></tbody></table>`;

describe("scan", () => {
  it("finds a block repeated byte-for-byte in 3 files, counting files and bytes saved", () => {
    const footer = FOOTER("123 New Street");
    const dir = fixture({
      "a.html": page(1, footer),
      "b.html": page(2, footer),
      "c.html": page(3, footer),
    });

    const report = scan(dir);
    const found = byTag(report, "table");

    expect(found).toHaveLength(1);
    expect(found[0]!.category).toBe("byte-identical");
    expect(found[0]!.files).toEqual(["a.html", "b.html", "c.html"]);
    expect(found[0]!.occurrences).toBe(3);
    expect(found[0]!.size).toBe(footer.length);
    expect(found[0]!.savings).toBe(2 * footer.length);
    expect(found[0]!.normalizesFiles).toEqual([]);
    expect(found[0]!.id).toBe("footer");
  });

  it("calls a block that differs only in attribute ORDER needs-normalizing, not byte-identical", () => {
    const ordered = `<table class="social" align="center"><tbody><tr><td><a href="https://fb.test">Facebook</a></td></tr></tbody></table>`;
    const reordered = `<table align="center" class="social"><tbody><tr><td><a href="https://fb.test">Facebook</a></td></tr></tbody></table>`;
    const dir = fixture({
      "a.html": page(1, ordered),
      "b.html": page(2, ordered),
      "c.html": page(3, reordered),
    });

    const report = scan(dir);
    const found = byTag(report, "table");

    expect(found).toHaveLength(1);
    expect(found[0]!.category).toBe("needs-normalizing");
    expect(found[0]!.category).not.toBe("byte-identical");
    expect(found[0]!.files).toEqual(["a.html", "b.html", "c.html"]);
    expect(found[0]!.byteVariants).toBe(2);
    expect(found[0]!.normalizesFiles).toEqual(["c.html"]);
    expect(found[0]!.splitVariants).toEqual([]);
  });

  it("splits copy whose inline spacing differs, instead of calling it a byte-variant", () => {
    const spaced = `<p class="copy">Call <a href="https://shop.test/help">our team</a> today</p>`;
    const spaceless = `<p class="copy">Call<a href="https://shop.test/help">our team</a>today</p>`;
    const dir = fixture({
      "a.html": page(1, spaced),
      "b.html": page(2, spaced),
      "c.html": page(3, spaceless),
    });

    const found = byTag(scan(dir), "p").filter((x) => x.size === spaced.length);

    expect(found).toHaveLength(1);
    expect(found[0]!.category).toBe("split");
    expect(found[0]!.category).not.toBe("needs-normalizing");
    expect(found[0]!.files).toEqual(["a.html", "b.html"]);
    expect(found[0]!.normalizesFiles).toEqual([]);

    expect(found[0]!.splitVariants).toHaveLength(1);
    expect(found[0]!.splitVariants[0]!.files).toEqual(["c.html"]);
    expect(found[0]!.splitVariants[0]!.difference?.mine).toBe("Call ");
    expect(found[0]!.splitVariants[0]!.difference?.theirs).toBe("Call");
  });

  it("keeps a space that a preceding inline sibling makes significant", () => {
    const spaced = `<p class="links"><a href="https://a.test">Shop</a> <a href="https://b.test">Sale</a></p>`;
    const spaceless = `<p class="links"><a href="https://a.test">Shop</a><a href="https://b.test">Sale</a></p>`;
    const dir = fixture({
      "a.html": page(1, spaced),
      "b.html": page(2, spaced),
      "c.html": page(3, spaceless),
    });

    const found = byTag(scan(dir), "p").filter((x) => x.size === spaced.length);

    expect(found).toHaveLength(1);
    expect(found[0]!.category).toBe("split");
    expect(found[0]!.splitVariants[0]!.files).toEqual(["c.html"]);
  });

  it("keeps a space inside an inline element whose own edge is not a block edge", () => {
    const spaced = `<p class="copy">Call<b> our expert team</b> today at noon</p>`;
    const spaceless = `<p class="copy">Call<b>our expert team</b> today at noon</p>`;
    const dir = fixture({
      "a.html": page(1, spaced),
      "b.html": page(2, spaced),
      "c.html": page(3, spaceless),
    });

    const found = byTag(scan(dir), "p").filter((x) => x.size === spaced.length);

    expect(found).toHaveLength(1);
    expect(found[0]!.category).toBe("split");
    expect(found[0]!.splitVariants[0]!.difference?.mine).toBe(" our expert team");
    expect(found[0]!.splitVariants[0]!.difference?.theirs).toBe("our expert team");
  });

  it("still ignores whitespace at a block edge, so indentation stays invisible", () => {
    const tight = `<p class="copy">Call our team today for a fitting appointment</p>`;
    const indented = `<p class="copy">\n  Call our team today for a fitting appointment\n</p>`;
    const dir = fixture({
      "a.html": page(1, tight),
      "b.html": page(2, tight),
      "c.html": page(3, indented),
    });

    const found = byTag(scan(dir), "p").filter((x) => x.size === tight.length);

    expect(found).toHaveLength(1);
    expect(found[0]!.category).toBe("needs-normalizing");
    expect(found[0]!.splitVariants).toEqual([]);
    expect(found[0]!.files).toEqual(["a.html", "b.html", "c.html"]);
    expect(found[0]!.normalizesFiles).toEqual(["c.html"]);
  });

  it("folds a reformatted copy into the same block instead of calling it a split", () => {
    const compact = FOOTER("123 New Street");
    const pretty =
      `<table  class="footer">\n` +
      `  <tbody>\n    <tr>\n      <td>\n` +
      `        <p>Shoe Brand &middot;   123 New Street &middot; Unsubscribe</p>\n` +
      `      </td>\n    </tr>\n  </tbody>\n</table>`;
    const dir = fixture({
      "a.html": page(1, compact),
      "b.html": page(2, compact),
      "c.html": page(3, pretty),
    });

    const report = scan(dir);
    const found = byTag(report, "table");

    expect(found).toHaveLength(1);
    expect(found[0]!.category).toBe("needs-normalizing");
    expect(found[0]!.splitVariants).toEqual([]);
    expect(found[0]!.files).toEqual(["a.html", "b.html", "c.html"]);
    expect(found[0]!.normalizesFiles).toEqual(["c.html"]);
    expect(found[0]!.size).toBe(compact.length);
  });

  it("treats a whitespace-only difference inside an attribute value as reformatting", () => {
    const tidy = `<div class="row"><a href="https://shop.test/now" style="color:#111; font-weight:bold">Shop the new season</a></div>`;
    const loose = `<div class="row"><a href="https://shop.test/now" style="color:#111;   font-weight:bold">Shop the new season</a></div>`;
    const dir = fixture({
      "a.html": page(1, tidy),
      "b.html": page(2, tidy),
      "c.html": page(3, loose),
    });

    const found = byTag(scan(dir), "div");

    expect(found).toHaveLength(1);
    expect(found[0]!.category).toBe("needs-normalizing");
    expect(found[0]!.normalizesFiles).toEqual(["c.html"]);
  });

  it("reports the 37-of-40 split with both file lists and what the three still say", () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 40; i++) {
      const name = `mail-${String(i).padStart(2, "0")}.html`;
      files[name] = page(i, FOOTER(i <= 37 ? "123 New Street" : "123 Old Street"));
    }
    const dir = fixture(files);

    const report = scan(dir);
    const found = byTag(report, "table");

    expect(found).toHaveLength(1);
    const footer = found[0]!;
    expect(footer.category).toBe("split");
    expect(footer.files).toHaveLength(37);
    expect(footer.files).toContain("mail-01.html");
    expect(footer.files).not.toContain("mail-38.html");
    expect(footer.shapeFiles).toHaveLength(40);

    expect(footer.splitVariants).toHaveLength(1);
    const odd = footer.splitVariants[0]!;
    expect(odd.files).toEqual(["mail-38.html", "mail-39.html", "mail-40.html"]);
    expect(odd.difference?.kind).toBe("text");
    expect(odd.difference?.mine).toContain("123 New Street");
    expect(odd.difference?.theirs).toContain("123 Old Street");
  });

  it("reports the enclosing table, not the row inside it, when both cover the same files", () => {
    const row = `<tr class="product"><td><a href="https://shop.test/item">A product row, long enough to clear min-bytes</a></td></tr>`;
    const table = `<table class="grid"><tbody>${row}${row}</tbody></table>`;
    const dir = fixture({
      "a.html": page(1, table),
      "b.html": page(2, table),
      "c.html": page(3, table),
    });

    const report = scan(dir);

    expect(byTag(report, "table")).toHaveLength(1);
    expect(byTag(report, "table")[0]!.occurrences).toBe(3);
    expect(byTag(report, "tr")).toHaveLength(0);
    expect(byTag(report, "td")).toHaveLength(0);
  });

  it("keeps a child that reaches more files than any parent that swallowed it", () => {
    const button = `<a class="btn" href="https://shop.test/now">Shop the new season now</a>`;
    const footer = `<div class="footer"><p>Shoe Brand, 123 New Street, all rights reserved</p>${button}</div>`;
    const header = `<section class="header"><p>View this email in your browser instead</p>${button}</section>`;
    const dir = fixture({
      "a.html": page(1, footer),
      "b.html": page(2, footer),
      "c.html": page(3, header),
      "d.html": page(4, header),
    });

    const report = scan(dir);

    expect(byTag(report, "div")).toHaveLength(1);
    expect(byTag(report, "div")[0]!.files).toEqual(["a.html", "b.html"]);
    expect(byTag(report, "section")).toHaveLength(1);
    expect(byTag(report, "section")[0]!.files).toEqual(["c.html", "d.html"]);

    const btn = byTag(report, "a");
    expect(btn).toHaveLength(1);
    expect(btn[0]!.files).toEqual(["a.html", "b.html", "c.html", "d.html"]);
    expect(btn[0]!.occurrences).toBe(4);
    expect(btn[0]!.size).toBe(button.length);
  });

  it("drops a child that reaches no further than the parent that swallowed it", () => {
    const button = `<a class="btn" href="https://shop.test/now">Shop the new season now</a>`;
    const footer = `<div class="footer"><p>Shoe Brand, 123 New Street, all rights reserved</p>${button}</div>`;
    const dir = fixture({
      "a.html": page(1, footer),
      "b.html": page(2, footer),
    });

    const report = scan(dir);

    expect(byTag(report, "div")).toHaveLength(1);
    expect(byTag(report, "a")).toHaveLength(0);
  });

  it("skips candidates below --min-bytes", () => {
    const small = `<p class="preheader">Free shipping today</p>`;
    const dir = fixture({
      "a.html": page(1, small),
      "b.html": page(2, small),
      "c.html": page(3, small),
    });

    expect(small.length).toBeGreaterThan(40);
    expect(small.length).toBeLessThan(200);

    expect(byTag(scan(dir, { minBytes: 40 }), "p")).toHaveLength(1);
    expect(byTag(scan(dir, { minBytes: 200 }), "p")).toHaveLength(0);
  });

  it("ignores a block that repeats inside one file only", () => {
    const strip = `<table class="social"><tbody><tr><td><a href="https://fb.test">Facebook forever</a></td></tr></tbody></table>`;
    const dir = fixture({
      "a.html": page(1, strip, strip, strip),
      "b.html": page(2, `<p>Nothing in common with the other file at all whatsoever.</p>`),
    });

    const report = scan(dir);

    expect(byTag(report, "table")).toHaveLength(0);
    expect(report.candidates.every((x) => x.files.length >= 2)).toBe(true);
  });

  it("survives malformed and unclosed HTML and still finds the shared block", () => {
    const footer = FOOTER("123 New Street");
    const broken = (n: number): string =>
      `<html><body><div><p>Campaign ${n} copy that was never closed` +
      `<table><tr><td>unclosed cell ${n}` +
      footer +
      `<a href="https://x.test">dangling <b>bold`;

    const dir = fixture({
      "a.html": broken(1),
      "b.html": broken(2),
      "c.html": `<<>< not really html at all >>> <div class="x"`,
    });

    let report!: ReturnType<typeof scan>;
    expect(() => {
      report = scan(dir);
    }).not.toThrow();

    expect(report.filesScanned).toBe(3);
    expect(byTag(report, "table").some((x) => x.files.length === 2)).toBe(true);
  });

  it("emits parseable JSON and nothing else on stdout under --json", () => {
    const footer = FOOTER("123 New Street");
    const dir = fixture({
      "a.html": page(1, footer),
      "b.html": page(2, footer),
    });

    const out = execFileSync("npx", ["tsx", CLI, dir, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, NO_COLOR: "1" },
    });

    const parsed = JSON.parse(out) as {
      filesScanned: number;
      candidates: Array<{ id: string; category: string; fileCount: number; savings: number }>;
    };
    expect(parsed.filesScanned).toBe(2);
    expect(parsed.candidates[0]!.id).toBe("footer");
    expect(parsed.candidates[0]!.category).toBe("byte-identical");
    expect(parsed.candidates[0]!.fileCount).toBe(2);
    expect(parsed.candidates[0]!.savings).toBe(footer.length);
  });

  it("prints the split as a sentence the operator can quote at the customer", () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 5; i++) {
      files[`m${i}.html`] = page(i, FOOTER(i <= 3 ? "123 New Street" : "123 Old Street"));
    }
    const dir = fixture(files);

    const out = execFileSync("npx", ["tsx", CLI, dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, NO_COLOR: "1" },
    });

    expect(out).toContain("in 3 of 5 files");
    expect(out).toContain("SPLIT");
    expect(out).toContain("123 Old Street");
  });
});
