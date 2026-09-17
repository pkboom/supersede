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
  /** Local-only; never serialized. */
  id: string;
  type: Exclude<BlockType, "mj-custom-passthrough">;
  /**
   * Every attr the parser saw, in source order. The serializer emits this
   * order verbatim, so mutate through `attrsHelpers` to keep it intact.
   */
  attrs: Map<string, string>;
  children?: TreeNode[];
  text?: string;
}

/** Comments and stray text — preserved verbatim, not block-shaped. */
export interface UnknownNode {
  id: string;
  type: "__unknown__";
  rawXml: string;
  /** e.g. "mj-body/mj-section[0]/mj-column[0]". */
  parentPath: string;
}

/** A tag the parser cannot model; `rawXml` is re-emitted byte-for-byte. */
export interface CustomPassthroughNode {
  id: string;
  type: "mj-custom-passthrough";
  rawXml: string;
  originalTagName: string;
}

export type TreeNode = BlockNode | UnknownNode | CustomPassthroughNode;

export interface MjmlDocument {
  /**
   * Opaque apart from the slices `headEdit` and `mjAttributes` rewrite.
   * `__synthetic` marks a head built for a source that had none; it is a
   * tree-internal flag and is never emitted.
   */
  head?: { rawXml: string; __synthetic?: boolean };
  /**
   * Attrs on `<mj-body>` itself. `undefined` means the source had no
   * `<mj-body>` at all; an empty Map means it had none.
   */
  bodyAttrs?: Map<string, string>;
  body: TreeNode[];
  /** Anything before `<mjml>` — XML decl, comments, whitespace. */
  docPreamble?: string;
  /** Attrs on the `<mjml>` tag itself, verbatim. */
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
