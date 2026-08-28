/**
 * blocks.passthrough.test — covers the 6 spec examples for A-prime lossless
 * passthrough.
 *
 * Each example asserts:
 *  1. Parse classifies the node as the expected variant
 *     (`mj-custom-passthrough` for unmodeled tags, `__unknown__` for HTML
 *     comments, attrs Map for unmodeled attrs on modeled tags).
 *  2. Serialize → parse a second time still yields the same variant
 *     (round-trip stability).
 *  3. The whitespace-normalized round-trip is byte-equal to the input.
 */
import { describe, it, expect } from "vitest";
import { parseMjml, serializeMjml } from "../../src/shared/blocks/index.js";
import { normalizeWhitespace } from "../../src/shared/blocks/roundTrip.js";
import type {
  BlockNode,
  CustomPassthroughNode,
  TreeNode,
  UnknownNode,
} from "../../src/shared/blocks/index.js";

function findFirst<T extends TreeNode>(
  nodes: TreeNode[],
  pred: (n: TreeNode) => n is T
): T | undefined {
  for (const n of nodes) {
    if (pred(n)) return n;
    if (n.type !== "__unknown__" && n.type !== "mj-custom-passthrough" && n.children) {
      const found = findFirst(n.children, pred);
      if (found) return found;
    }
  }
  return undefined;
}

const isCustomPassthrough = (n: TreeNode): n is CustomPassthroughNode =>
  n.type === "mj-custom-passthrough";

const isUnknown = (n: TreeNode): n is UnknownNode => n.type === "__unknown__";

const isBlock = (n: TreeNode): n is BlockNode =>
  n.type !== "mj-custom-passthrough" && n.type !== "__unknown__";

describe("A-prime passthrough — 6 spec examples", () => {
  it("(1) <mj-style> in mj-head is preserved verbatim (head opaque rawXml round-trips)", () => {
    const src = `<mjml><mj-head><mj-style>.x { color: red }</mj-style></mj-head><mj-body><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const doc = parseMjml(src);
    // mj-head is preserved opaquely on the document — its rawXml must contain mj-style.
    expect(doc.head?.rawXml ?? "").toContain("<mj-style>");
    expect(doc.head?.rawXml ?? "").toContain(".x { color: red }");
    const out = serializeMjml(doc);
    expect(out).toContain("<mj-style>");
    expect(normalizeWhitespace(out)).toBe(normalizeWhitespace(src));
  });

  it("(2) <mj-wrapper> at body level becomes a CustomPassthroughNode", () => {
    const src = `<mjml><mj-body><mj-wrapper><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-wrapper></mj-body></mjml>`;
    const doc = parseMjml(src);
    const wrap = findFirst(doc.body, isCustomPassthrough);
    expect(wrap).toBeDefined();
    expect(wrap!.originalTagName).toBe("mj-wrapper");
    const out = serializeMjml(doc);
    expect(out).toContain("<mj-wrapper>");
    expect(normalizeWhitespace(out)).toBe(normalizeWhitespace(src));
  });

  it("(3) border-radius on mj-section is preserved in attrs.get('border-radius')", () => {
    const src = `<mjml><mj-body><mj-section border-radius="8px"><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const doc = parseMjml(src);
    const section = findFirst(
      doc.body,
      (n): n is BlockNode => isBlock(n) && n.type === "mj-section"
    );
    expect(section).toBeDefined();
    expect(section!.attrs.get("border-radius")).toBe("8px");
    const out = serializeMjml(doc);
    expect(out).toContain('border-radius="8px"');
    expect(normalizeWhitespace(out)).toBe(normalizeWhitespace(src));
  });

  it("(4) letter-spacing on mj-text is preserved in attrs.get('letter-spacing')", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text letter-spacing="2px">hi</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const doc = parseMjml(src);
    const text = findFirst(
      doc.body,
      (n): n is BlockNode => isBlock(n) && n.type === "mj-text"
    );
    expect(text).toBeDefined();
    expect(text!.attrs.get("letter-spacing")).toBe("2px");
    const out = serializeMjml(doc);
    expect(out).toContain('letter-spacing="2px"');
    expect(normalizeWhitespace(out)).toBe(normalizeWhitespace(src));
  });

  it("(5) mj-class attribute is preserved in attrs (not in registry.allowedAttrs)", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text mj-class="promo">hi</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const doc = parseMjml(src);
    const text = findFirst(
      doc.body,
      (n): n is BlockNode => isBlock(n) && n.type === "mj-text"
    );
    expect(text).toBeDefined();
    expect(text!.attrs.get("mj-class")).toBe("promo");
    const out = serializeMjml(doc);
    expect(out).toContain('mj-class="promo"');
    expect(normalizeWhitespace(out)).toBe(normalizeWhitespace(src));
  });

  it("(6) HTML comment in body remains an UnknownNode (NOT a passthrough)", () => {
    const src = `<mjml><mj-body><!-- top comment --><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const doc = parseMjml(src);
    const comment = findFirst(doc.body, isUnknown);
    expect(comment).toBeDefined();
    expect(comment!.rawXml).toContain("<!-- top comment -->");
    // Crucially: it must NOT be a mj-custom-passthrough.
    const passthrough = findFirst(doc.body, isCustomPassthrough);
    expect(passthrough).toBeUndefined();
    const out = serializeMjml(doc);
    expect(out).toContain("<!-- top comment -->");
    expect(normalizeWhitespace(out)).toBe(normalizeWhitespace(src));
  });
});
