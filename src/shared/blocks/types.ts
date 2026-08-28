/**
 * Block-tree types — shared between the React canvas and the server-side
 * round-trip property test (formerly the runtime fidelity gate).
 *
 * **A-prime data model (lossless passthrough):**
 *   - Every modeled `BlockNode` carries ONE attr container: `attrs:
 *     Map<string, string>`, in source insertion order. The parser writes
 *     EVERY attr it sees — modeled-by-the-registry or not — into this single
 *     Map. There is **no `passthroughAttrs` partition**: known and unknown
 *     attrs share one container so the round-trip serializer iterates exactly
 *     one ordered list and re-emits source-byte-equal output (modulo
 *     whitespace).
 *   - `BLOCK_REGISTRY[type].allowedAttrs` is consumed only at form-render
 *     time (`PropertiesForm.tsx`) as a UI VIEW filter. It is NOT a parser
 *     gate; the parser is policy-free.
 *   - Tags the parser cannot model deterministically (e.g. `<mj-style>`,
 *     `<mj-wrapper>`) become `CustomPassthroughNode` carrying the verbatim
 *     `rawXml` slice; the serializer re-emits that slice unchanged. Comments
 *     and stray text continue to live as `UnknownNode` (they are not
 *     block-shaped).
 *
 * **Synthetic mj-head sentinel (Step 6 / R9-prime):**
 *   - When the parser produces a tree with no `head` node and the right-panel
 *     `setTitle` / `setPreheader` is invoked, `headEdit.ts` materializes a
 *     head node with sentinel `__synthetic: true` carrying staged
 *     title/preheader values. The serializer (Lane B) MUST emit that head
 *     identically to a real head — the sentinel is a tree-internal flag and
 *     is NOT written to MJML output. See `src/shared/blocks/headEdit.ts`
 *     header for the full mechanism. TODO(serializer): Lane B's
 *     `serializeMjml` must skip the sentinel field when emitting; emit a head
 *     iff `head` is present (real OR synthetic).
 *
 * Source-of-truth lives at src/shared/blocks/. The web bundle imports it via
 * a relative path (configured in web/vite.config.ts and web/tsconfig.json).
 */
export type BlockType =
  | "mj-section"
  | "mj-column"
  | "mj-image"
  | "mj-text"
  | "mj-button"
  | "mj-divider"
  | "mj-spacer"
  | "mj-social"
  | "mj-social-element"
  | "mj-custom-passthrough";

export interface BlockNode {
  /** Local-only id for React keys / dnd-kit. Not serialized. */
  id: string;
  type: Exclude<BlockType, "mj-custom-passthrough">;
  /**
   * MJML attribute values are always strings. Insertion-ordered Map (A-prime)
   * — the parser writes every attr it sees here in source order, the
   * serializer iterates this Map in insertion order. Use `setAttr` /
   * `deleteAttr` from `attrsHelpers.ts` to mutate while preserving the
   * insertion-order invariant.
   */
  attrs: Map<string, string>;
  /** Children present only on container blocks (section/column). */
  children?: TreeNode[];
  /** Inner text content (mj-text / mj-button). */
  text?: string;
}

export interface UnknownNode {
  id: string;
  type: "__unknown__";
  /** Verbatim source slice — including tag, attrs, children, comments, whitespace. */
  rawXml: string;
  /** Path of the parent for placement context, e.g. "mj-body/mj-section[0]/mj-column[0]". */
  parentPath: string;
}

/**
 * Opaque verbatim-preserved MJML node — used when the parser encounters a
 * tag/attr combination it cannot model deterministically. Re-emitted
 * byte-for-byte by the serializer.
 */
export interface CustomPassthroughNode {
  id: string;
  type: "mj-custom-passthrough";
  rawXml: string;
  originalTagName: string;
}

export type TreeNode = BlockNode | UnknownNode | CustomPassthroughNode;

export interface MjmlDocument {
  /**
   * mj-head preserved opaquely; we don't model its inner structure in v1
   * (apart from `<mj-title>` / `<mj-preview>` text which `headEdit.ts`
   * slices via indexOf, and `<mj-attributes>` defaults which
   * `mjAttributes.ts` slices similarly).
   *
   * `__synthetic: true` marks a head node that the right-panel global
   * settings UI created on a tree the parser produced without a head (i.e.
   * the source MJML had no `<mj-head>` tag at all). The serializer treats
   * synthetic heads identically to real heads when emitting; the flag is a
   * tree-internal sentinel and is never written to MJML output. See
   * `headEdit.ts` for the materialization rules.
   */
  head?: { rawXml: string; __synthetic?: boolean };
  /**
   * Attributes on `<mj-body>` itself (e.g. `width`, `background-color`),
   * insertion-ordered so the serializer round-trips them in source order.
   * `undefined` means the source carried no `<mj-body>` at all (rare —
   * implies an empty document); a present-but-empty Map means
   * `<mj-body>` had no attrs.
   */
  bodyAttrs?: Map<string, string>;
  /** Children of mj-body. */
  body: TreeNode[];
  /** Anything before <mjml> (XML decl, comments, whitespace). */
  docPreamble?: string;
  /** Attributes on the <mjml> tag itself, preserved verbatim. */
  rawWrapper?: string;
}

export function isUnknownNode(n: TreeNode): n is UnknownNode {
  return n.type === "__unknown__";
}

export function isCustomPassthroughNode(
  n: TreeNode
): n is CustomPassthroughNode {
  return n.type === "mj-custom-passthrough";
}

export function isBlockNode(n: TreeNode): n is BlockNode {
  return n.type !== "__unknown__" && n.type !== "mj-custom-passthrough";
}
