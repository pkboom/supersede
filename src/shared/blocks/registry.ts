/**
 * Block registry — modeled-block metadata.
 *
 * **A-prime contract:** `allowedAttrs` is a UI-form view filter consumed by
 * `PropertiesForm.tsx` at form-render time. The parser is policy-free and
 * admits every attr it sees into the block's insertion-ordered `attrs:
 * Map<string, string>`; attrs not listed here round-trip silently and are
 * simply not surfaced in the right-panel form. The registry is NOT a
 * parse-time gate.
 *
 * `defaults` populates `attrs` for newly-created blocks (DnD from the icon
 * rail) — keys are inserted into the new Map in declaration order.
 */
import type { BlockType } from "./types.js";

export interface BlockDef {
  type: BlockType;
  label: string;
  defaults: Record<string, string>;
  /**
   * The set of attributes the canvas surfaces in its property panel.
   * Attributes outside this list are still preserved verbatim if the source
   * MJML carries them — see parser.ts and the A-prime contract above.
   */
  allowedAttrs: string[];
  /** null means "this block is a leaf and accepts no children". */
  allowedChildren: BlockType[] | null;
  isContainer: boolean;
  /** If set, the block's inner text lives in `node.text`. */
  contentField?: "text";
}

export const BLOCK_REGISTRY: Record<BlockType, BlockDef> = {
  "mj-section": {
    type: "mj-section",
    label: "Section",
    defaults: { "background-color": "#ffffff", padding: "20px 0" },
    allowedAttrs: ["background-color", "padding", "background-url", "border"],
    allowedChildren: ["mj-column"],
    isContainer: true,
  },
  "mj-column": {
    type: "mj-column",
    label: "Column",
    defaults: {},
    allowedAttrs: ["width", "background-color", "padding", "border"],
    allowedChildren: [
      "mj-image",
      "mj-text",
      "mj-button",
      "mj-divider",
      "mj-spacer",
      "mj-social",
    ],
    isContainer: true,
  },
  "mj-social-element": {
    type: "mj-social-element",
    label: "Social icon",
    defaults: { name: "facebook", href: "#" },
    allowedAttrs: [
      "name",
      "href",
      "src",
      "alt",
      "background-color",
      "color",
      "icon-size",
      "padding",
    ],
    allowedChildren: null,
    isContainer: false,
    contentField: "text",
  },
  "mj-image": {
    type: "mj-image",
    label: "Image",
    defaults: { src: "https://placehold.co/600x300", alt: "" },
    allowedAttrs: ["src", "alt", "width", "align", "padding", "href"],
    allowedChildren: null,
    isContainer: false,
  },
  "mj-text": {
    type: "mj-text",
    label: "Text",
    defaults: {},
    allowedAttrs: [
      "font-size",
      "font-weight",
      "color",
      "align",
      "padding",
      "line-height",
      "font-family",
    ],
    allowedChildren: null,
    isContainer: false,
    contentField: "text",
  },
  "mj-button": {
    type: "mj-button",
    label: "Button",
    defaults: {
      href: "#",
      "background-color": "#1f6feb",
      color: "#ffffff",
    },
    allowedAttrs: [
      "href",
      "background-color",
      "color",
      "font-size",
      "padding",
      "align",
      "border-radius",
    ],
    allowedChildren: null,
    isContainer: false,
    contentField: "text",
  },
  "mj-divider": {
    type: "mj-divider",
    label: "Divider",
    defaults: { "border-color": "#dddddd", "border-width": "1px" },
    allowedAttrs: ["border-color", "border-width", "padding", "width"],
    allowedChildren: null,
    isContainer: false,
  },
  "mj-spacer": {
    type: "mj-spacer",
    label: "Spacer",
    defaults: { height: "20px" },
    allowedAttrs: ["height", "padding"],
    allowedChildren: null,
    isContainer: false,
  },
  "mj-social": {
    type: "mj-social",
    label: "Social",
    defaults: { mode: "horizontal" },
    allowedAttrs: ["mode", "align", "padding", "icon-size"],
    allowedChildren: ["mj-social-element"],
    isContainer: true,
  },
  "mj-custom-passthrough": {
    type: "mj-custom-passthrough",
    label: "Custom MJML",
    defaults: {},
    allowedAttrs: [],
    allowedChildren: null,
    isContainer: false,
  },
};

export const MODELED_TYPES: ReadonlySet<string> = new Set(
  Object.keys(BLOCK_REGISTRY).filter((t) => t !== "mj-custom-passthrough")
);

export function isModeledType(tag: string): tag is BlockType {
  return MODELED_TYPES.has(tag);
}

export interface BlockTemplate {
  attrs: Map<string, string>;
  text?: string;
  children?: never[];
}

export function defaultBlockNode(type: BlockType): BlockTemplate {
  const def = BLOCK_REGISTRY[type];
  const out: BlockTemplate = {
    attrs: new Map(Object.entries(def.defaults)),
  };
  if (def.contentField === "text") {
    out.text = type === "mj-button" ? "Click me" : "Lorem ipsum";
  }
  if (def.isContainer) {
    out.children = [];
  }
  return out;
}
