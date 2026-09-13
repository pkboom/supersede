/**
 * The measurement harness drives a decision that can invalidate the whole
 * reference model (§11 experiment (b) re-opens D-2), so its arithmetic is
 * tested rather than trusted.
 *
 * These tests use FIXTURES WITH KNOWN ANSWERS. That matters more than usual
 * here: a measurement tool that is quietly wrong is worse than no tool, because
 * it produces a number people then stop questioning.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function measure(files: Record<string, string>): {
  experimentB: {
    meanDifferingAttrsPerInstance: number;
    belowRootShare: number;
    reopensD2: boolean;
    shapes: Array<{ shape: string; instances: number; meanDiffering: number }>;
  };
  reachability: {
    modeled: number;
    opaque: number;
    opaqueBy: Record<string, number>;
    richText: number;
    plainText: number;
    opaqueShare: number;
  };
  files: number;
} {
  const dir = mkdtempSync(join(tmpdir(), "measure-"));
  try {
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, name), body, "utf8");
    }
    const out = execFileSync(
      "npx",
      ["tsx", "scripts/measure-templates.ts", dir, "--json"],
      { encoding: "utf8", cwd: process.cwd() }
    );
    return JSON.parse(out.slice(out.indexOf("{")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const wrap = (inner: string) => `<mjml><mj-body>${inner}</mj-body></mjml>`;

describe("§3.5 reachability counting", () => {
  it("counts modeled nodes and opaque nodes separately", () => {
    const r = measure({
      "a.mjml": wrap(
        `<mj-section><mj-column><mj-text>plain</mj-text></mj-column></mj-section>`
      ),
    }).reachability;
    // section + column + text = 3 modeled, 0 opaque
    expect(r.modeled).toBe(3);
    expect(r.opaque).toBe(0);
  });

  it("attributes an mj-wrapper to its construct", () => {
    const r = measure({
      "a.mjml": wrap(
        `<mj-wrapper><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-wrapper>`
      ),
    }).reachability;
    // The whole wrapper subtree collapses to ONE opaque node.
    expect(r.opaque).toBe(1);
    expect(r.opaqueBy["<mj-wrapper>"]).toBe(1);
  });

  it("counts rich mj-text as opaque AND as rich text", () => {
    const r = measure({
      "a.mjml": wrap(
        `<mj-section><mj-column><mj-text>Buy <b>now</b></mj-text></mj-column></mj-section>`
      ),
    }).reachability;
    expect(r.richText).toBe(1);
    expect(r.opaqueBy["<mj-text>"]).toBe(1);
    expect(r.plainText).toBe(0);
  });

  it("distinguishes plain from rich text", () => {
    const r = measure({
      "a.mjml": wrap(
        `<mj-section><mj-column><mj-text>plain</mj-text><mj-text>rich <b>x</b></mj-text></mj-column></mj-section>`
      ),
    }).reachability;
    expect(r.plainText).toBe(1);
    expect(r.richText).toBe(1);
  });
});

describe("§11 experiment (b) variance", () => {
  it("reports zero variance for identical repeated blocks", () => {
    const block = `<mj-section background-color="#fff"><mj-column><mj-text>x</mj-text></mj-column></mj-section>`;
    const b = measure({ "a.mjml": wrap(block + block) }).experimentB;
    expect(b.meanDifferingAttrsPerInstance).toBe(0);
    expect(b.reopensD2).toBe(false);
  });

  it("ignores a shape that occurs only once — it cannot vary", () => {
    const b = measure({
      "a.mjml": wrap(
        `<mj-section><mj-column><mj-text>only one</mj-text></mj-column></mj-section>`
      ),
    }).experimentB;
    // Every shape here has exactly one instance, so nothing is comparable.
    expect(b.shapes.every((s) => s.instances >= 2)).toBe(true);
  });

  it("counts a differing ROOT attribute", () => {
    const a = `<mj-button href="#" background-color="#111">Go</mj-button>`;
    const c = `<mj-button href="#" background-color="#222">Go</mj-button>`;
    const b = measure({
      "a.mjml": wrap(`<mj-section><mj-column>${a}${c}</mj-column></mj-section>`),
    }).experimentB;
    const btn = b.shapes.find((s) => s.shape === "mj-button")!;
    expect(btn.instances).toBe(2);
    expect(btn.meanDiffering).toBeGreaterThan(0);
  });

  it("re-opens D-2 when root variance is high", () => {
    // Eight attributes differing across two instances. Note the arithmetic:
    // with two instances the modal value is whichever came first, so ONE
    // instance matches it and the other differs on all eight — mean 4.0.
    // Six differing attributes would land on exactly 3.0, which is the
    // threshold itself and would make this test depend on the comparison being
    // `>=` rather than `>`.
    const a = `<mj-button href="#" background-color="#1" color="#2" padding="1px" width="1px" align="left" border-radius="1px" font-size="1px" line-height="1px">Go</mj-button>`;
    const c = `<mj-button href="#" background-color="#9" color="#8" padding="9px" width="9px" align="right" border-radius="9px" font-size="9px" line-height="9px">Go</mj-button>`;
    const b = measure({
      "a.mjml": wrap(`<mj-section><mj-column>${a}${c}</mj-column></mj-section>`),
    }).experimentB;
    expect(b.meanDifferingAttrsPerInstance).toBeGreaterThan(3);
    expect(b.reopensD2).toBe(true);
  });

  it("re-opens D-2 when differences are mostly BELOW the root", () => {
    // This is the case the average alone cannot catch, and the reason the
    // second measurement exists: the roots are identical, so a root-only
    // metric reports zero variance while flat ov-* still cannot express it.
    const s1 = `<mj-section><mj-column><mj-button href="https://a.test">Go</mj-button></mj-column></mj-section>`;
    const s2 = `<mj-section><mj-column><mj-button href="https://b.test">Go</mj-button></mj-column></mj-section>`;
    const b = measure({ "a.mjml": wrap(s1 + s2) }).experimentB;
    expect(b.belowRootShare).toBeGreaterThan(0.5);
    expect(b.reopensD2).toBe(true);
  });

  it("does NOT re-open D-2 for low root-level variance only", () => {
    const s1 = `<mj-section background-color="#111"><mj-column><mj-text>x</mj-text></mj-column></mj-section>`;
    const s2 = `<mj-section background-color="#222"><mj-column><mj-text>x</mj-text></mj-column></mj-section>`;
    const b = measure({ "a.mjml": wrap(s1 + s2) }).experimentB;
    expect(b.meanDifferingAttrsPerInstance).toBeLessThanOrEqual(3);
    expect(b.belowRootShare).toBeLessThanOrEqual(0.5);
    expect(b.reopensD2).toBe(false);
  });
});

describe("harness behaviour", () => {
  it("reports the number of files measured", () => {
    const r = measure({
      "a.mjml": wrap(`<mj-section><mj-column><mj-text>a</mj-text></mj-column></mj-section>`),
      "b.mjml": wrap(`<mj-section><mj-column><mj-text>b</mj-text></mj-column></mj-section>`),
    });
    expect(r.files).toBe(2);
  });

  it("measures ACROSS files, not just within one", () => {
    // Components are shared between templates, so variance has to be measured
    // across the corpus or the experiment answers the wrong question.
    const block = (color: string) =>
      `<mj-section background-color="${color}"><mj-column><mj-text>x</mj-text></mj-column></mj-section>`;
    const b = measure({
      "a.mjml": wrap(block("#111")),
      "b.mjml": wrap(block("#222")),
    }).experimentB;
    const sec = b.shapes.find((s) => s.shape.startsWith("mj-section"))!;
    expect(sec.instances).toBe(2);
  });
});
