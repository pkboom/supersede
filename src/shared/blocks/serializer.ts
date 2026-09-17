import type {
  BlockNode,
  CustomPassthroughNode,
  MjmlDocument,
  TreeNode,
  UnknownNode,
} from "./types.js";
import { BLOCK_REGISTRY } from "./registry.js";

/**
 * An `&` that does not already open a character reference.
 *
 * Escaping here has to be IDEMPOTENT, because two kinds of value flow through
 * it. A value parsed from source holds its entities as literal characters
 * (`processEntities: false`), so re-escaping its `&` would compound it by four
 * characters per save, forever. A value written programmatically holds a raw
 * `&` and a raw `<`, and leaving those alone truncates the document at the
 * `<` on the next parse. Skipping the `&` that is already an entity satisfies
 * both: each reaches a fixpoint after one pass.
 *
 * Do not unify with `escapeHtml` in `headEdit.ts`, which double-escapes
 * deliberately under the opposite contract.
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
 * `>` is deliberately left alone: harmless in text content, and escaping it
 * would rewrite every source document that legitimately contains one.
 */
function escapeText(v: string): string {
  return v.replace(BARE_AMPERSAND, "&amp;").replace(/</g, "&lt;");
}

function indent(level: number): string {
  return "  ".repeat(level);
}

function serializeAttrs(attrs: Map<string, string>): string {
  if (attrs.size === 0) return "";
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

  if (def.contentField === "text" && node.text != null) {
    return `${ind}<${node.type}${attrsStr}>${escapeText(node.text)}</${node.type}>`;
  }

  return `${ind}<${node.type}${attrsStr} />`;
}

/** Verbatim re-emission — the round-trip guarantee for unmodeled MJML. */
function serializeRaw(
  node: UnknownNode | CustomPassthroughNode,
  level: number
): string {
  return `${indent(level)}${node.rawXml}`;
}

function serializeNode(node: TreeNode, level: number): string {
  if (node.type === "__unknown__" || node.type === "mj-custom-passthrough") {
    return serializeRaw(node, level);
  }
  return serializeBlock(node, level);
}

export function serializeMjml(doc: MjmlDocument): string {
  const lines: string[] = [];
  if (doc.docPreamble) lines.push(doc.docPreamble.replace(/\n+$/, ""));

  const wrapperAttrs = doc.rawWrapper ? ` ${doc.rawWrapper}` : "";
  lines.push(`<mjml${wrapperAttrs}>`);

  if (doc.head) {
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
