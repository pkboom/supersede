import { describe, it, expect } from "vitest";
import { parseMjml, serializeMjml } from "../../src/shared/blocks/index.js";
import { assertRoundTrip, normalizeWhitespace } from "../../src/shared/blocks/roundTrip.js";
import type { TreeNode } from "../../src/shared/blocks/index.js";

function walk(nodes: TreeNode[], fn: (n: TreeNode, depth: number) => void, d = 0): void {
  for (const n of nodes) {
    fn(n, d);
    if (n.type !== "__unknown__" && n.type !== "mj-custom-passthrough" && n.children) walk(n.children, fn, d + 1);
  }
}
const dump = (s: string) => { const d = parseMjml(s); const out: string[] = []; walk(d.body, (n, dep) => out.push("  ".repeat(dep) + n.type)); return out.join("\n"); };

describe("A. entity double-escape — is it pre-existing (no data-* involved)?", () => {
  it("href with &amp; in a VANILLA template", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-button href="https://x.test/?a=1&amp;b=2">Buy &amp; save</mj-button></mj-column></mj-section></mj-body></mjml>`;
    let s = src;
    for (let i = 1; i <= 4; i++) { s = serializeMjml(parseMjml(s)); console.log(`cycle ${i}:`, s.match(/<mj-button[^\n]*/)![0]); }
  });
  it("assertRoundTrip on that vanilla source", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-button href="https://x.test/?a=1&amp;b=2">Buy &amp; save</mj-button></mj-column></mj-section></mj-body></mjml>`;
    let threw: string | null = null;
    try { assertRoundTrip(src); } catch (e) { threw = (e as Error).message.slice(0, 300); }
    console.log("assertRoundTrip:", threw ?? "PASSED (no mismatch detected)");
  });
  it("bare & (unescaped) in text", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text>A & B</mj-text></mj-column></mj-section></mj-body></mjml>`;
    let s = src;
    for (let i = 1; i <= 3; i++) { s = serializeMjml(parseMjml(s)); console.log(`bare-& cycle ${i}:`, s.match(/<mj-text[^\n]*/)![0]); }
  });
});

describe("B. mj-wrapper swallows the subtree", () => {
  it("tree shape with a wrapper", () => {
    console.log(dump(`<mjml><mj-body><mj-wrapper><mj-section><mj-column><mj-button>a</mj-button></mj-column></mj-section><mj-section><mj-column><mj-button>b</mj-button></mj-column></mj-section></mj-wrapper></mj-body></mjml>`));
  });
  it("tree shape without a wrapper (control)", () => {
    console.log(dump(`<mjml><mj-body><mj-section><mj-column><mj-button>a</mj-button></mj-column></mj-section></mj-body></mjml>`));
  });
  it("mj-hero, mj-navbar, mj-raw, mj-include", () => {
    for (const tag of ["mj-hero", "mj-navbar", "mj-raw", "mj-group", "mj-carousel", "mj-table", "mj-accordion"]) {
      const src = `<mjml><mj-body><mj-section><mj-column><${tag}>x</${tag}></mj-column></mj-section></mj-body></mjml>`;
      const kinds: string[] = [];
      walk(parseMjml(src).body, (n) => kinds.push(n.type));
      console.log(tag.padEnd(14), "->", kinds.join(" > "));
    }
  });
});

describe("C. rich mj-text — the common real-world case", () => {
  it("how much of a real template is opaque", () => {
    const src = `<mjml><mj-body>
  <mj-section data-cmp="b/header"><mj-column><mj-image src="logo.png" /></mj-column></mj-section>
  <mj-section><mj-column>
    <mj-text data-cmp="b/copy"><h1>Big news</h1><p>Read <a href="#">more</a>.</p></mj-text>
    <mj-button data-cmp="b/btn" href="#">Go</mj-button>
  </mj-column></mj-section>
</mj-body></mjml>`;
    console.log(dump(src));
    const d = parseMjml(src);
    let opaque = 0, modeled = 0;
    walk(d.body, (n) => { if (n.type === "mj-custom-passthrough") opaque++; else if (n.type !== "__unknown__") modeled++; });
    console.log(`modeled=${modeled} opaque=${opaque}`);
  });
});

describe("D. stamp survival under mutation", () => {
  it("setAttr on a node keeps stamp position", async () => {
    const { setAttr } = await import("../../src/shared/blocks/attrsHelpers.js");
    const src = `<mjml><mj-body><mj-section><mj-column><mj-button data-cmp="b/btn" data-cmp-v="1" href="#" color="#fff">Go</mj-button></mj-column></mj-section></mj-body></mjml>`;
    const d = parseMjml(src);
    let btn: any; walk(d.body, (n) => { if (n.type === "mj-button") btn = n; });
    setAttr(btn.attrs, "color", "#000");
    setAttr(btn.attrs, "background-color", "#f00");
    console.log("after mutation:", serializeMjml(d).match(/<mj-button[^\n]*/)![0]);
  });
});

describe("E. whitespace/indent cost of a full re-serialize", () => {
  it("hand-authored MJML is reformatted wholesale", () => {
    const src = `<mjml>\n<mj-body>\n\t<mj-section>\n\t\t<mj-column>\n\t\t\t<mj-text>hi</mj-text>\n\t\t</mj-column>\n\t</mj-section>\n</mj-body>\n</mjml>`;
    const out = serializeMjml(parseMjml(src));
    console.log("BYTE-EQUAL to source?", out === src);
    console.log(JSON.stringify(out));
  });
});
