/**
 * Block-tree → MJML serializer.
 *
 * BlockNodes are emitted as clean `<mj-foo attr="val">…</mj-foo>` with
 * 2-space indentation. UnknownNodes emit their `rawXml` verbatim, which is
 * what guarantees byte-equality round-trip for unmodeled constructs.
 */
import type {
  BlockNode,
  CustomPassthroughNode,
  MjmlDocument,
  TreeNode,
  UnknownNode,
} from "./types.js";
import { BLOCK_REGISTRY } from "./registry.js";

/**
 * Escape an attribute value for emission.
 *
 * **Only `"` is escaped, deliberately (plan §0.2).** The parser runs
 * fast-xml-parser with `processEntities: false`, so a value arrives holding the
 * LITERAL SOURCE CHARACTERS — source `&amp;` is five characters in the Map, not
 * one `&`. Re-escaping `&` here therefore had no inverse anywhere and compounded
 * once per save, +4 characters per generation, forever:
 *
 *     gen 0: href="/x?a=1&amp;b=2"
 *     gen 1: href="/x?a=1&amp;amp;b=2"
 *     gen 2: href="/x?a=1&amp;amp;amp;b=2"
 *
 * The trigger was every UTM tracking URL and every `&` in body copy. Because
 * values round-trip as source text, emitting them unchanged is what makes
 * parse->serialize reach a fixpoint.
 *
 * `"` IS still escaped, and must be: a value set programmatically (e.g. by the
 * properties form or the component expander) can legitimately contain a literal
 * quote, which would otherwise terminate the attribute and produce invalid MJML.
 * That escape is idempotent in practice because a value parsed from source
 * carries `&quot;`, never a bare `"`.
 *
 * NOT to be unified with `escapeHtml` in `headEdit.ts:59-61`, which
 * double-escapes DELIBERATELY under a different contract and is asserted at
 * `blocks.headEdit.test.ts:70`. Identical-looking code, opposite requirement.
 */
function escapeAttrValue(v: string): string {
  return v.replace(/"/g, "&quot;");
}

function indent(level: number): string {
  return "  ".repeat(level);
}

function serializeAttrs(attrs: Map<string, string>): string {
  if (attrs.size === 0) return "";
  // Iterate in insertion order (Map iteration is insertion-ordered per spec).
  // Per A-prime, this order IS the source order — no two-phase
  // "known-then-unknown" emission.
  const parts: string[] = [];
  for (const [k, v] of attrs) {
    parts.push(`${k}="${escapeAttrValue(v)}"`);
  }
  return " " + parts.join(" ");
}

function serializeBlock(node: BlockNode, level: number): string {
  const def = BLOCK_REGISTRY[node.type];
  const ind = indent(level);
  const attrsStr = serializeAttrs(node.attrs);

  // Container with children
  if (def.isContainer) {
    const children = node.children ?? [];
    if (children.length === 0) {
      return `${ind}<${node.type}${attrsStr} />`;
    }
    const inner = children
      .map((c) => serializeNode(c, level + 1))
      .join("\n");
    return `${ind}<${node.type}${attrsStr}>\n${inner}\n${ind}</${node.type}>`;
  }

  // Leaf with text content
  if (def.contentField === "text" && node.text != null) {
    // Text is NOT escaped — see escapeAttrValue's note. `node.text` holds the
    // literal source slice (processEntities:false), so re-escaping `&` here was
    // the text-content half of the same compounding corruption.
    return `${ind}<${node.type}${attrsStr}>${node.text}</${node.type}>`;
  }

  // Leaf without text
  return `${ind}<${node.type}${attrsStr} />`;
}

function serializeUnknown(node: UnknownNode, level: number): string {
  // Prepend the requested indent on the first line; preserve internal lines as-is.
  return `${indent(level)}${node.rawXml}`;
}

function serializePassthrough(
  node: CustomPassthroughNode,
  level: number
): string {
  // Verbatim re-emission of the captured slice — this is the round-trip
  // guarantee for unmodeled MJML constructs.
  return `${indent(level)}${node.rawXml}`;
}

function serializeNode(node: TreeNode, level: number): string {
  if (node.type === "__unknown__") {
    return serializeUnknown(node, level);
  }
  if (node.type === "mj-custom-passthrough") {
    return serializePassthrough(node, level);
  }
  return serializeBlock(node, level);
}

export function serializeMjml(doc: MjmlDocument): string {
  const lines: string[] = [];
  if (doc.docPreamble) lines.push(doc.docPreamble.replace(/\n+$/, ""));

  const wrapperAttrs = doc.rawWrapper ? ` ${doc.rawWrapper}` : "";
  lines.push(`<mjml${wrapperAttrs}>`);

  if (doc.head) {
    // Preserve mj-head verbatim, indented one level. Round-trip fidelity is
    // what matters — we don't try to re-indent inner head lines.
    lines.push(`${indent(1)}${doc.head.rawXml}`);
  }

  const body = doc.body;
  const bodyAttrsStr = doc.bodyAttrs ? serializeAttrs(doc.bodyAttrs) : "";
  if (body.length === 0) {
    lines.push(`${indent(1)}<mj-body${bodyAttrsStr} />`);
  } else {
    lines.push(`${indent(1)}<mj-body${bodyAttrsStr}>`);
    for (const child of body) {
      lines.push(serializeNode(child, 2));
    }
    lines.push(`${indent(1)}</mj-body>`);
  }

  lines.push(`</mjml>`);
  return lines.join("\n") + "\n";
}
