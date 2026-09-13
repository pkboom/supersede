import { describe, it, expect } from "vitest";
import { parseMjml } from "../../src/shared/blocks/index.js";
import { normalizeWhitespace } from "../../src/shared/blocks/roundTrip.js";
import { BLOCK_REGISTRY } from "../../src/shared/blocks/registry.js";
import type { BlockNode, MjmlDocument, TreeNode } from "../../src/shared/blocks/index.js";

// serializer variant with escaping REMOVED — verifying the proposed fix.
const ind = (l: number) => "  ".repeat(l);
function sAttrs(a: Map<string, string>): string {
  if (a.size === 0) return "";
  return " " + [...a].map(([k, v]) => `${k}="${v.replace(/"/g, "&quot;")}"`).join(" ");
}
function sNode(n: TreeNode, l: number): string {
  if (n.type === "__unknown__" || n.type === "mj-custom-passthrough") return ind(l) + (n as any).rawXml;
  const b = n as BlockNode, def = BLOCK_REGISTRY[b.type], at = sAttrs(b.attrs);
  if (def.isContainer) {
    const ch = b.children ?? [];
    if (!ch.length) return `${ind(l)}<${b.type}${at} />`;
    return `${ind(l)}<${b.type}${at}>\n${ch.map((c) => sNode(c, l + 1)).join("\n")}\n${ind(l)}</${b.type}>`;
  }
  if (def.contentField === "text" && b.text != null) return `${ind(l)}<${b.type}${at}>${b.text}</${b.type}>`;
  return `${ind(l)}<${b.type}${at} />`;
}
function serializeNoEscape(d: MjmlDocument): string {
  const out: string[] = [];
  if (d.docPreamble) out.push(d.docPreamble.replace(/\n+$/, ""));
  out.push(`<mjml${d.rawWrapper ? " " + d.rawWrapper : ""}>`);
  if (d.head) out.push(ind(1) + d.head.rawXml);
  const ba = d.bodyAttrs ? sAttrs(d.bodyAttrs) : "";
  if (!d.body.length) out.push(`${ind(1)}<mj-body${ba} />`);
  else { out.push(`${ind(1)}<mj-body${ba}>`); for (const c of d.body) out.push(sNode(c, 2)); out.push(`${ind(1)}</mj-body>`); }
  out.push("</mjml>");
  return out.join("\n") + "\n";
}

describe("proposed fix: serializer must NOT re-escape (parser has processEntities:false)", () => {
  const cases = [
    `<mjml><mj-body><mj-section><mj-column><mj-button href="https://x.test/?a=1&amp;b=2">Buy &amp; save</mj-button></mj-column></mj-section></mj-body></mjml>`,
    `<mjml><mj-body><mj-section><mj-column><mj-text data-cmp-lock='{"attrs":["color"]}'>Caf&eacute; &mdash; 5 &lt; 10</mj-text></mj-column></mj-section></mj-body></mjml>`,
    `<mjml><mj-body><mj-section data-cmp="b/s"><mj-column><mj-image src="https://c.test/i.png?w=1&amp;h=2" alt="A &quot;quoted&quot; alt" /></mj-column></mj-section></mj-body></mjml>`,
  ];
  for (const [i, src] of cases.entries()) {
    it(`case ${i}: stable across 5 cycles + normalized-equal to source`, () => {
      let s = serializeNoEscape(parseMjml(src));
      const first = s;
      for (let k = 0; k < 5; k++) s = serializeNoEscape(parseMjml(s));
      console.log(`case ${i} emitted:`, s.replace(/\n\s*/g, " "));
      expect(s).toBe(first);
      expect(normalizeWhitespace(s)).toBe(normalizeWhitespace(src));
    });
  }
  it("bare & (not an entity) — the one regression the fix introduces", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text>A & B</mj-text></mj-column></mj-section></mj-body></mjml>`;
    let s = serializeNoEscape(parseMjml(src));
    console.log("bare-& out:", s.replace(/\n\s*/g, " "));
    expect(s).toBe(serializeNoEscape(parseMjml(s))); // stable, echoes source
  });
});
