import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function measure(files: Record<string, string>): {
  overrideVariance: {
    meanDifferingAttrsPerInstance: number;
    belowRootShare: number;
    overridesInsufficient: boolean;
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
      ["tsx", "src/cli/measure-templates.ts", dir, "--json"],
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
    expect(r.modeled).toBe(3);
    expect(r.opaque).toBe(0);
  });

  it("attributes an mj-wrapper to its construct", () => {
    const r = measure({
      "a.mjml": wrap(
        `<mj-wrapper><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-wrapper>`
      ),
    }).reachability;
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
    const b = measure({ "a.mjml": wrap(block + block) }).overrideVariance;
    expect(b.meanDifferingAttrsPerInstance).toBe(0);
    expect(b.overridesInsufficient).toBe(false);
  });

  it("ignores a shape that occurs only once — it cannot vary", () => {
    const b = measure({
      "a.mjml": wrap(
        `<mj-section><mj-column><mj-text>only one</mj-text></mj-column></mj-section>`
      ),
    }).overrideVariance;
    expect(b.shapes.every((s) => s.instances >= 2)).toBe(true);
  });

  it("counts a differing ROOT attribute", () => {
    const a = `<mj-button href="#" background-color="#111">Go</mj-button>`;
    const c = `<mj-button href="#" background-color="#222">Go</mj-button>`;
    const b = measure({
      "a.mjml": wrap(`<mj-section><mj-column>${a}${c}</mj-column></mj-section>`),
    }).overrideVariance;
    const btn = b.shapes.find((s) => s.shape === "mj-button")!;
    expect(btn.instances).toBe(2);
    expect(btn.meanDiffering).toBeGreaterThan(0);
  });

  it("re-opens D-2 when root variance is high", () => {
    const a = `<mj-button href="#" background-color="#1" color="#2" padding="1px" width="1px" align="left" border-radius="1px" font-size="1px" line-height="1px">Go</mj-button>`;
    const c = `<mj-button href="#" background-color="#9" color="#8" padding="9px" width="9px" align="right" border-radius="9px" font-size="9px" line-height="9px">Go</mj-button>`;
    const b = measure({
      "a.mjml": wrap(`<mj-section><mj-column>${a}${c}</mj-column></mj-section>`),
    }).overrideVariance;
    expect(b.meanDifferingAttrsPerInstance).toBeGreaterThan(3);
    expect(b.overridesInsufficient).toBe(true);
  });

  it("re-opens D-2 when differences are mostly BELOW the root", () => {
    const s1 = `<mj-section><mj-column><mj-button href="https://a.test">Go</mj-button></mj-column></mj-section>`;
    const s2 = `<mj-section><mj-column><mj-button href="https://b.test">Go</mj-button></mj-column></mj-section>`;
    const b = measure({ "a.mjml": wrap(s1 + s2) }).overrideVariance;
    expect(b.belowRootShare).toBeGreaterThan(0.5);
    expect(b.overridesInsufficient).toBe(true);
  });

  it("does NOT re-open D-2 for low root-level variance only", () => {
    const s1 = `<mj-section background-color="#111"><mj-column><mj-text>x</mj-text></mj-column></mj-section>`;
    const s2 = `<mj-section background-color="#222"><mj-column><mj-text>x</mj-text></mj-column></mj-section>`;
    const b = measure({ "a.mjml": wrap(s1 + s2) }).overrideVariance;
    expect(b.meanDifferingAttrsPerInstance).toBeLessThanOrEqual(3);
    expect(b.belowRootShare).toBeLessThanOrEqual(0.5);
    expect(b.overridesInsufficient).toBe(false);
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
    const block = (color: string) =>
      `<mj-section background-color="${color}"><mj-column><mj-text>x</mj-text></mj-column></mj-section>`;
    const b = measure({
      "a.mjml": wrap(block("#111")),
      "b.mjml": wrap(block("#222")),
    }).overrideVariance;
    const sec = b.shapes.find((s) => s.shape.startsWith("mj-section"))!;
    expect(sec.instances).toBe(2);
  });
});
