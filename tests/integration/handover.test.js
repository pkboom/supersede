import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const CLI = join(__dirname, "..", "..", "src", "handover.js");
let job;
function write(rel, body) {
  const full = join(job, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}
function run(...args) {
  try {
    const out = execFileSync(process.execPath, [CLI, job, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { out, code: 0 };
  } catch (err) {
    const e = err;
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status ?? 1 };
  }
}
const FOOTER = `<tr><td><p>Shoe Brand · 123 Old Street</p></td></tr>`;
const ORIGINAL = `<html><body>` + `<tr><td><p>Hello</p></td></tr>` + FOOTER + `</body></html>`;
const REWIRED =
  `<html><body>` +
  `<tr><td><p>Hello</p></td></tr>` +
  `<x-component component-id="shoe-brand/footer" revision="1" />` +
  `</body></html>`;
beforeEach(() => {
  job = mkdtempSync(join(tmpdir(), "handover-"));
});
afterEach(() => {
  rmSync(job, { recursive: true, force: true });
});
describe("handover CLI", () => {
  it("produces byte-identical before/after renders and a clean plain export", () => {
    write("components/shoe-brand/footer.html", FOOTER);
    write("templates/welcome.html", REWIRED);
    write("originals/welcome.html", ORIGINAL);
    const { out, code } = run();
    expect(code).toBe(0);
    expect(out).toContain("1/1 byte-identical");
    const plain = readFileSync(join(job, "plain-export", "welcome.html"), "utf8");
    expect(plain).toBe(ORIGINAL);
    expect(plain).not.toContain("x-component");
    expect(plain).not.toContain("data-slot");
    expect(existsSync(join(job, "proof", "welcome.before.html"))).toBe(true);
    expect(existsSync(join(job, "proof", "welcome.after.html"))).toBe(true);
    expect(readFileSync(join(job, "proof", "REPORT.md"), "utf8")).toContain("identical");
  });
  it("strips a data-slot marker so plain-export carries no trace of the tool", () => {
    write("components/shoe-brand/btn.html", `<a data-slot="label" href="https://x.test">Buy</a>`);
    write(
      "templates/t.html",
      `<html><body><table><tr><td>` +
        `<x-component component-id="shoe-brand/btn" revision="1" ov-slot-label="Shop now" />` +
        `</td></tr></table></body></html>`,
    );
    const { code } = run();
    expect(code).toBe(0);
    const plain = readFileSync(join(job, "plain-export", "t.html"), "utf8");
    expect(plain).toContain("Shop now");
    expect(plain).not.toContain("data-slot");
  });
  it("FAILS LOUDLY when a reference cannot be resolved, rather than shipping a gap", () => {
    write("components/shoe-brand/other.html", FOOTER);
    write("templates/welcome.html", REWIRED);
    const { out, code } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/No revision 1 of component/);
  });
  it("reports a differing render instead of claiming success", () => {
    write("components/shoe-brand/footer.html", `<tr><td><p>DIFFERENT</p></td></tr>`);
    write("templates/welcome.html", REWIRED);
    write("originals/welcome.html", ORIGINAL);
    const { out, code } = run();
    expect(code).toBe(1);
    expect(out).toContain("bytes DIFFER");
    expect(out).toContain("0/1 byte-identical");
  });
  it("--check writes nothing", () => {
    write("components/shoe-brand/footer.html", FOOTER);
    write("templates/welcome.html", REWIRED);
    write("originals/welcome.html", ORIGINAL);
    const { code } = run("--check");
    expect(code).toBe(0);
    expect(existsSync(join(job, "proof"))).toBe(false);
    expect(existsSync(join(job, "plain-export"))).toBe(false);
  });
  it("rejects a component body with two roots, naming the component", () => {
    write("components/shoe-brand/footer.html", `${FOOTER}${FOOTER}`);
    write("templates/welcome.html", REWIRED);
    const { out, code } = run();
    expect(code).toBe(1);
    expect(out).toContain("shoe-brand/footer");
  });
});
