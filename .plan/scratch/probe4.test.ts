import { describe, it } from "vitest";
import { parseMjml, serializeMjml } from "../../src/shared/blocks/index.js";
import type { TreeNode } from "../../src/shared/blocks/index.js";
// @ts-expect-error
import mjml2html from "mjml";

function shape(nodes: TreeNode[], d = 0): string[] {
  const o: string[] = [];
  for (const n of nodes) {
    o.push("  ".repeat(d) + n.type + (n.type === "mj-custom-passthrough" ? ` (${(n as any).originalTagName})` : ""));
    if (n.type !== "__unknown__" && n.type !== "mj-custom-passthrough" && n.children) o.push(...shape(n.children, d + 1));
  }
  return o;
}
function mjmlVerdict(src: string): string {
  try {
    const r = mjml2html(src, { validationLevel: "soft" }) as { html: string; errors?: any[] };
    return `soft-ok errors=${JSON.stringify((r.errors ?? []).map((e) => e.message))}`;
  } catch (e) { return "THREW: " + String(e).slice(0, 120); }
}

describe("Q1 — is <mj-section><mj-text> actually legal MJML?", () => {
  const cases: Array<[string, string]> = [
    ["mj-section > mj-text (no column)", `<mjml><mj-body><mj-section><mj-text>hi</mj-text></mj-section></mj-body></mjml>`],
    ["mj-body > mj-text (no section)",  `<mjml><mj-body><mj-text>hi</mj-text></mj-body></mjml>`],
    ["mj-column > mj-column (nested)",  `<mjml><mj-body><mj-section><mj-column><mj-column><mj-text>hi</mj-text></mj-column></mj-column></mj-section></mj-body></mjml>`],
    ["control: valid",                  `<mjml><mj-body><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>`],
  ];
  for (const [label, src] of cases) {
    it(label, () => {
      console.log(`\n### ${label}`);
      console.log("  parser shape:", shape(parseMjml(src).body).join(" | "));
      console.log("  mjml says   :", mjmlVerdict(src));
    });
  }
});

describe("Q2 — mj-wrapper: how common-shaped, and does the raw walker handle nesting?", () => {
  it("nested wrappers + siblings", () => {
    const src = `<mjml><mj-body>
  <mj-wrapper background-url="https://c/bg.png" full-width="full-width" data-cmp="b/wrap">
    <mj-section><mj-column><mj-button data-cmp="b/btn" data-cmp-v="3" href="#">Go</mj-button></mj-column></mj-section>
    <mj-wrapper padding="0"><mj-section><mj-column><mj-text>inner</mj-text></mj-column></mj-section></mj-wrapper>
  </mj-wrapper>
  <mj-section><mj-column><mj-button data-cmp="b/btn" data-cmp-v="3" href="#">Reachable</mj-button></mj-column></mj-section>
</mj-body></mjml>`;
    console.log("shape:\n" + shape(parseMjml(src).body).join("\n"));
    const out = serializeMjml(parseMjml(src));
    console.log("stamps in stored source:", (src.match(/data-cmp="b\/btn"/g) ?? []).length);
    console.log("stamps reachable as BlockNodes: 1 (the non-wrapped one)");
    console.log("round-trips?", out.includes('data-cmp="b/btn"'));
    console.log("mjml verdict:", mjmlVerdict(src));
  });
  it("what BLOCK_REGISTRY would need for mj-wrapper — raw-walker nesting sanity", () => {
    // The raw walker is generic; the only registry-driven behavior is
    // isModeledType + allowedChildren. Confirm nested same-name depth tracking
    // works on a tag the walker already sees (mj-section nested in mj-section).
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text>a</mj-text></mj-column></mj-section><mj-section><mj-column><mj-text>b</mj-text></mj-column></mj-section></mj-body></mjml>`;
    console.log("sibling same-name shape:", shape(parseMjml(src).body).join(" | "));
  });
});

describe("Q3 — first-run reformat: how big is the diff on realistic hand-authored MJML?", () => {
  it("measure", () => {
    const src = `<mjml>\n  <mj-body width="600px">\n    <mj-section background-color='#ffffff'>\n      <mj-column>\n        <mj-button href="/x?a=1&amp;b=2" disabled>Shop &amp; Save</mj-button>\n      </mj-column>\n    </mj-section>\n  </mj-body>\n</mjml>\n`;
    const out = serializeMjml(parseMjml(src));
    console.log("BEFORE:\n" + src);
    console.log("AFTER:\n" + out);
    const bl = src.split("\n"), al = out.split("\n");
    let diff = 0;
    for (let i = 0; i < Math.max(bl.length, al.length); i++) if (bl[i] !== al[i]) diff++;
    console.log(`lines differing: ${diff}/${Math.max(bl.length, al.length)}`);
    console.log("canonical is idempotent?", serializeMjml(parseMjml(out)) === out);
  });
});
