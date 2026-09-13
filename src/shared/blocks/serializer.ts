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
 * **Escaping is IDEMPOTENT, not absent (plan §0.2, as corrected).** The parser runs
 * fast-xml-parser with `processEntities: false`, so a value arrives holding the
 * LITERAL SOURCE CHARACTERS — source `&amp;` is five characters in the Map, not
 * one `&`. Re-escaping `&` here therefore had no inverse anywhere and compounded
 * once per save, +4 characters per generation, forever:
 *
 *     gen 0: href="/x?a=1&amp;b=2"
 *     gen 1: href="/x?a=1&amp;amp;b=2"
 *     gen 2: href="/x?a=1&amp;amp;amp;b=2"
 *
 * The trigger was every UTM tracking URL and every `&` in body copy.
 *
 * **The first fix for this went too far and opened a worse hole.** It dropped
 * escaping entirely, on evidence gathered from source round-trips alone. But
 * `node.text` and `attrs` are ALSO written programmatically — the inline canvas
 * editor assigns raw `textContent`, and the properties form assigns raw input
 * values. With escaping removed, typing `a < b` into a text block serialized to
 * `<mj-text>a < b</mj-text>`, which re-parses to `"a "` — everything after the
 * `<` silently destroyed and then persisted. Typing `</mj-text><script>` broke
 * the document structure outright. That is strictly worse than the entity bug
 * it replaced: the entity bug was linear and reversible; this was immediate and
 * unrecoverable.
 *
 * The correct fix escapes what must be escaped, but does so IDEMPOTENTLY, so
 * both the source path and the write path reach a fixpoint. See
 * BARE_AMPERSAND.
 *
 * NOT to be unified with `escapeHtml` in `headEdit.ts:59-61`, which
 * double-escapes DELIBERATELY under a different contract and is asserted at
 * `blocks.headEdit.test.ts:70`. Identical-looking code, opposite requirement.
 */
/**
 * Matches an `&` that does NOT already begin a character reference. This is
 * what makes escaping IDEMPOTENT, which is the property the whole round-trip
 * gate rests on:
 *
 *   - a value parsed from source holds `&amp;` as five literal characters
 *     (processEntities:false). The `&` is followed by `amp;`, so it is left
 *     alone and the value round-trips byte-equal.
 *   - a value written programmatically — the inline editor, the properties
 *     form, the component expander — holds a raw `&`. Nothing follows it that
 *     looks like an entity, so it IS escaped, and the NEXT pass leaves the
 *     result alone.
 *
 * Both paths reach a fixpoint at generation 1.
 */
const BARE_AMPERSAND =
  /&(?!(?:[A-Za-z][A-Za-z0-9]{1,31}|#\d{1,7}|#[xX][0-9A-Fa-f]{1,6});)/g;

function escapeAttrValue(v: string): string {
  return v
    .replace(BARE_AMPERSAND, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

/**
 * Escape text content, idempotently (see BARE_AMPERSAND).
 *
 * `<` must always be escaped: a raw `<` cannot occur in text parsed from source
 * (it would have opened a tag), so escaping it only ever affects the write path
 * — where leaving it raw silently truncates the document at that character.
 *
 * `>` is deliberately NOT escaped. It is harmless in text content, and escaping
 * it would rewrite every source document that legitimately contains one,
 * breaking the byte-equal round-trip for no safety gain.
 */
function escapeText(v: string): string {
  return v.replace(BARE_AMPERSAND, "&amp;").replace(/</g, "&lt;");
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
    return `${ind}<${node.type}${attrsStr}>${escapeText(node.text)}</${node.type}>`;
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
