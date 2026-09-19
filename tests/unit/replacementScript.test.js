import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReplacementScript, changeSlug } from "../../src/pipeline/replacementScript.js";

const FROM = "Old Street &bull; Springfield";
const TO = "New Street, New York";

let root;
let script;

function write({ from = FROM, to = TO, files = ["a.html", "b.html"] } = {}) {
  script = join(root, "changes", "001-change.mjs");
  writeFileSync(script, buildReplacementScript({
    request: `Replace the address "${from}" with "${to}".`,
    from,
    to,
    files,
  }));
  return script;
}

function run(...args) {
  return execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "script-"));
  mkdirSync(join(root, "changes"));
  writeFileSync(join(root, "a.html"), `<td>${FROM} one</td>`);
  writeFileSync(join(root, "b.html"), `<td>${FROM} two</td>`);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("changeSlug", () => {
  it("numbers the change and keeps the first five words", () => {
    expect(changeSlug("update the footer postal address now please", 1))
      .toBe("001-update-the-footer-postal-address");
  });

  it("falls back when nothing survives slugging", () => {
    expect(changeSlug("!!! ???", 12)).toBe("012-change");
  });
});

describe("the generated script", () => {
  it("replaces the span in every listed file", () => {
    write();
    const output = run();

    expect(output).toContain("a.html: replaced");
    expect(readFileSync(join(root, "a.html"), "utf8")).toBe(`<td>${TO} one</td>`);
    expect(readFileSync(join(root, "b.html"), "utf8")).toBe(`<td>${TO} two</td>`);
  });

  it("writes nothing with --check", () => {
    write();
    const before = readFileSync(join(root, "a.html"), "utf8");
    const output = run("--check");

    expect(output).toContain("a.html: would replace");
    expect(readFileSync(join(root, "a.html"), "utf8")).toBe(before);
  });

  it("carries the request it was generated for", () => {
    write();

    expect(run("--check")).toContain(`Replace the address "${FROM}" with "${TO}".`);
  });

  it("refuses a file where the span matches twice and leaves it alone", () => {
    writeFileSync(join(root, "a.html"), `<td>${FROM} one ${FROM} again</td>`);
    write();

    expect(() => run()).toThrow();
    expect(readFileSync(join(root, "a.html"), "utf8")).not.toContain(TO);
  });

  it("refuses a file where the span is absent", () => {
    writeFileSync(join(root, "a.html"), "<td>something else</td>");
    write();

    expect(() => run()).toThrow();
  });

  it("applies a replacement literally, without treating $ as a pattern", () => {
    write({ to: "$& $1 $'" });
    run();

    expect(readFileSync(join(root, "a.html"), "utf8")).toBe(`<td>$& $1 $' one</td>`);
  });

  it("still applies the files it can when another is refused", () => {
    writeFileSync(join(root, "a.html"), "<td>something else</td>");
    write();

    expect(() => run()).toThrow();
    expect(readFileSync(join(root, "b.html"), "utf8")).toContain(TO);
  });
});
