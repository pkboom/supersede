import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(__dirname, "..", "..", "src", "cli", "handover.ts");

let job: string;

function write(rel: string, body: string): void {
  const full = join(job, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

function run(...args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync("npx", ["tsx", CLI, job, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { out, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status ?? 1 };
  }
}

const FOOTER = `<mj-section><mj-column><mj-text>Shoe Brand · 123 Old Street</mj-text></mj-column></mj-section>`;

const ORIGINAL =
  `<mjml><mj-body>` +
  `<mj-section><mj-column><mj-text>Hello</mj-text></mj-column></mj-section>` +
  FOOTER +
  `</mj-body></mjml>`;

const REWIRED =
  `<mjml><mj-body>` +
  `<mj-section><mj-column><mj-text>Hello</mj-text></mj-column></mj-section>` +
  `<mj-component component-id="shoe-brand/footer" revision="1" />` +
  `</mj-body></mjml>`;

beforeEach(() => {
  job = mkdtempSync(join(tmpdir(), "handover-"));
});
afterEach(() => {
  rmSync(job, { recursive: true, force: true });
});

describe("handover CLI", () => {
  it("produces byte-identical before/after renders and a clean plain export", () => {
    write("components/shoe-brand/footer.mjml", FOOTER);
    write("templates/welcome.mjml", REWIRED);
    write("originals/welcome.mjml", ORIGINAL);

    const { out, code } = run();
    expect(code).toBe(0);
    expect(out).toContain("1/1 byte-identical renders");

    const plain = readFileSync(join(job, "plain-export", "welcome.mjml"), "utf8");
    expect(plain).toBe(ORIGINAL);
    expect(plain).not.toContain("mj-component");
    expect(plain).not.toContain("data-slot");

    expect(existsSync(join(job, "proof", "welcome.before.html"))).toBe(true);
    expect(existsSync(join(job, "proof", "welcome.after.html"))).toBe(true);
    expect(readFileSync(join(job, "proof", "REPORT.md"), "utf8")).toContain("identical");
  });

  it("strips a data-slot marker so plain-export carries no trace of the tool", () => {
    write(
      "components/shoe-brand/btn.mjml",
      `<mj-button data-slot="label" href="https://x.test">Buy</mj-button>`
    );
    write(
      "templates/t.mjml",
      `<mjml><mj-body><mj-section><mj-column>` +
        `<mj-component component-id="shoe-brand/btn" revision="1" ov-slot-label="Shop now" />` +
        `</mj-column></mj-section></mj-body></mjml>`
    );

    const { code } = run();
    expect(code).toBe(0);
    const plain = readFileSync(join(job, "plain-export", "t.mjml"), "utf8");
    expect(plain).toContain("Shop now");
    expect(plain).not.toContain("data-slot");
  });

  it("FAILS LOUDLY when a reference cannot be resolved, rather than shipping a gap", () => {
    write("components/shoe-brand/other.mjml", FOOTER);
    write("templates/welcome.mjml", REWIRED);

    const { out, code } = run();
    expect(code).toBe(1);
    expect(out).toMatch(/No revision 1 of component/);
  });

  it("refuses <mj-include/>, which reads files off the operator's disk", () => {
    write("components/shoe-brand/footer.mjml", FOOTER);
    write(
      "templates/evil.mjml",
      `<mjml><mj-body><mj-include path="/etc/passwd" /></mj-body></mjml>`
    );

    const { out, code } = run();
    expect(code).toBe(1);
    expect(out).toContain("mj-include");
  });

  it("reports a differing render instead of claiming success", () => {
    write("components/shoe-brand/footer.mjml", `<mj-section><mj-column><mj-text>DIFFERENT</mj-text></mj-column></mj-section>`);
    write("templates/welcome.mjml", REWIRED);
    write("originals/welcome.mjml", ORIGINAL);

    const { out, code } = run();
    expect(code).toBe(1);
    expect(out).toContain("renders DIFFER");
    expect(out).toContain("0/1 byte-identical");
  });

  it("--check writes nothing", () => {
    write("components/shoe-brand/footer.mjml", FOOTER);
    write("templates/welcome.mjml", REWIRED);
    write("originals/welcome.mjml", ORIGINAL);

    const { code } = run("--check");
    expect(code).toBe(0);
    expect(existsSync(join(job, "proof"))).toBe(false);
    expect(existsSync(join(job, "plain-export"))).toBe(false);
  });

  it("rejects a component body with two roots, naming the component", () => {
    write("components/shoe-brand/footer.mjml", `${FOOTER}${FOOTER}`);
    write("templates/welcome.mjml", REWIRED);

    const { out, code } = run();
    expect(code).toBe(1);
    expect(out).toContain("shoe-brand/footer");
  });
});
