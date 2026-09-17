import { XMLParser } from "fast-xml-parser";
import {
  BLOCK_REGISTRY,
  isModeledType,
} from "./registry.js";
import type {
  BlockNode,
  BlockType,
  CustomPassthroughNode,
  MjmlDocument,
  TreeNode,
  UnknownNode,
} from "./types.js";

let __id = 0;
function nid(): string {
  __id += 1;
  return `n_${__id.toString(36)}`;
}

interface RawTag {
  name: string;
  start: number;
  /** Exclusive end of the whole element, children and close tag included. */
  end: number;
  selfClosing: boolean;
}

const TAG_OPEN_RE = /<\s*([A-Za-z][\w-]*)\b/g;

/**
 * The byte slice of the element starting at `from`. fast-xml-parser exposes no
 * offsets, so unmodeled subtrees are captured by walking the raw string here —
 * that verbatim slice is what makes the round trip lossless.
 */
function readElement(src: string, from: number): RawTag | null {
  TAG_OPEN_RE.lastIndex = from;
  const m = TAG_OPEN_RE.exec(src);
  if (!m) return null;
  // Non-whitespace before the next tag is text, not an element.
  if (m.index !== from && /\S/.test(src.slice(from, m.index))) return null;
  const name = m[1]!;
  const tagOpenStart = m.index;

  // The first '>' that isn't inside a quoted attribute value.
  let i = TAG_OPEN_RE.lastIndex;
  let inSingle = false;
  let inDouble = false;
  let openEnd = -1;
  let isSelfClose = false;
  while (i < src.length) {
    const c = src[i]!;
    if (inSingle) {
      if (c === "'") inSingle = false;
    } else if (inDouble) {
      if (c === '"') inDouble = false;
    } else if (c === "'") inSingle = true;
    else if (c === '"') inDouble = true;
    else if (c === "/" && src[i + 1] === ">") {
      openEnd = i + 2;
      isSelfClose = true;
      break;
    } else if (c === ">") {
      openEnd = i + 1;
      break;
    }
    i++;
  }
  if (openEnd === -1) return null;

  if (isSelfClose) {
    return { name, start: tagOpenStart, end: openEnd, selfClosing: true };
  }

  let depth = 1;
  let cursor = openEnd;
  // `(?![\w-])` rather than `\b`, which matches between a word char and `-`:
  // `<mj-social\b` would otherwise match `<mj-social-element` and over-count.
  const openRe = new RegExp(`<\\s*${escapeRe(name)}(?![\\w-])`, "g");
  const closeRe = new RegExp(`<\\s*\\/\\s*${escapeRe(name)}\\s*>`, "g");
  while (cursor < src.length) {
    const nextComment = src.indexOf("<!--", cursor);
    const nextOpen = ((): number => {
      openRe.lastIndex = cursor;
      const r = openRe.exec(src);
      return r ? r.index : -1;
    })();
    const nextClose = ((): number => {
      closeRe.lastIndex = cursor;
      const r = closeRe.exec(src);
      return r ? r.index : -1;
    })();

    // A tag inside `<!-- ... -->` must not move the depth counter.
    if (
      nextComment !== -1 &&
      (nextOpen === -1 || nextComment < nextOpen) &&
      (nextClose === -1 || nextComment < nextClose)
    ) {
      const commentEnd = src.indexOf("-->", nextComment + 4);
      if (commentEnd === -1) return null;
      cursor = commentEnd + 3;
      continue;
    }

    if (nextClose === -1) return null; // unbalanced
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      cursor = nextOpen + 1;
      continue;
    }
    depth--;
    if (depth === 0) {
      // Find the matching '>' of the close tag.
      const closeEnd = src.indexOf(">", nextClose) + 1;
      return { name, start: tagOpenStart, end: closeEnd, selfClosing: false };
    }
    cursor = nextClose + 1;
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readComment(src: string, from: number): { start: number; end: number } | null {
  let i = from;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  if (src.slice(i, i + 4) !== "<!--") return null;
  const end = src.indexOf("-->", i + 4);
  if (end === -1) return null;
  return { start: i, end: end + 3 };
}

const xmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  commentPropName: "#comment",
  trimValues: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
});

type FxpAttrMap = { [attr: string]: string };
/** fast-xml-parser's `preserveOrder` shape; the `:@` key holds attributes. */
type FxpNode = {
  [tag: string]: FxpNode[] | string | FxpAttrMap | undefined;
  ":@"?: FxpAttrMap;
};

function getTagName(node: FxpNode): string | null {
  for (const k of Object.keys(node)) {
    if (k === ":@") continue;
    return k;
  }
  return null;
}

/**
 * A Map rather than the plain object, because V8 sorts numeric-like object
 * keys (`data-1="x"`) to the front and the serializer emits this order.
 */
function getAttrs(node: FxpNode): Map<string, string> {
  const out = new Map<string, string>();
  const at = node[":@"];
  if (!at || typeof at !== "object") return out;
  for (const k of Object.keys(at)) {
    const name = k.startsWith("@_") ? k.slice(2) : k;
    const v = (at as FxpAttrMap)[k];
    out.set(name, String(v));
  }
  return out;
}

function passthrough(rawXml: string, originalTagName: string): CustomPassthroughNode {
  return { id: nid(), type: "mj-custom-passthrough", rawXml, originalTagName };
}

function getChildren(node: FxpNode, tag: string): FxpNode[] {
  const v = node[tag];
  if (Array.isArray(v)) return v as FxpNode[];
  return [];
}

interface ParseContext {
  src: string;
}

function parseBodyChildren(
  ctx: ParseContext,
  bodyInnerStart: number,
  bodyInnerEnd: number,
  parentPath: string
): TreeNode[] {
  const out: TreeNode[] = [];
  let cursor = bodyInnerStart;
  const src = ctx.src;

  while (cursor < bodyInnerEnd) {
    while (cursor < bodyInnerEnd && /\s/.test(src[cursor]!)) cursor++;
    if (cursor >= bodyInnerEnd) break;

    const cm = readComment(src, cursor);
    if (cm && cm.end <= bodyInnerEnd) {
      out.push({
        id: nid(),
        type: "__unknown__",
        rawXml: src.slice(cm.start, cm.end),
        parentPath,
      } satisfies UnknownNode);
      cursor = cm.end;
      continue;
    }

    const el = readElement(src, cursor);
    if (!el || el.end > bodyInnerEnd) {
      // Stray text — opaque, so it still round-trips.
      const rest = src.slice(cursor, bodyInnerEnd);
      if (/\S/.test(rest)) {
        out.push({
          id: nid(),
          type: "__unknown__",
          rawXml: rest,
          parentPath,
        } satisfies UnknownNode);
      }
      cursor = bodyInnerEnd;
      break;
    }

    const node = parseElement(ctx, el, parentPath, out.length);
    out.push(node);
    cursor = el.end;
  }

  return out;
}

function parseElement(
  ctx: ParseContext,
  el: RawTag,
  parentPath: string,
  indexInParent: number
): TreeNode {
  const tag = el.name;
  const src = ctx.src;
  const elementSlice = src.slice(el.start, el.end);

  if (!isModeledType(tag)) {
    return passthrough(elementSlice, tag);
  }

  const def = BLOCK_REGISTRY[tag as BlockType];

  let parsed: FxpNode[];
  try {
    parsed = xmlParser.parse(elementSlice) as FxpNode[];
  } catch {
    return passthrough(elementSlice, tag);
  }

  if (!Array.isArray(parsed) || parsed.length !== 1) {
    return passthrough(elementSlice, tag);
  }

  const fnode = parsed[0]!;
  const fname = getTagName(fnode);
  if (fname !== tag) {
    return passthrough(elementSlice, tag);
  }

  const attrs = getAttrs(fnode);
  const childrenFx = getChildren(fnode, tag);

  const path = `${parentPath}/${tag}[${indexInParent}]`;

  // Walked here rather than through `parseBodyChildren` so a child whose type
  // is not in `allowedChildren` can be demoted individually.
  if (def.isContainer) {
    const openTagEnd = src.indexOf(">", el.start) + 1;
    // Strictly before `el.end`, which is one past the close tag's `>`:
    // otherwise tightly-packed siblings (`</a></b>`) match the outer `</`.
    const closeTagStart = el.selfClosing
      ? openTagEnd
      : src.lastIndexOf(`</`, el.end - 2);

    const allowed = new Set(def.allowedChildren ?? []);
    const children: TreeNode[] = [];
    let cursor = openTagEnd;

    while (cursor < closeTagStart) {
      while (cursor < closeTagStart && /\s/.test(src[cursor]!)) cursor++;
      if (cursor >= closeTagStart) break;

      const cm = readComment(src, cursor);
      if (cm && cm.end <= closeTagStart) {
        children.push({
          id: nid(),
          type: "__unknown__",
          rawXml: src.slice(cm.start, cm.end),
          parentPath: path,
        } satisfies UnknownNode);
        cursor = cm.end;
        continue;
      }

      const childEl = readElement(src, cursor);
      if (!childEl || childEl.end > closeTagStart) {
        const rest = src.slice(cursor, closeTagStart);
        if (/\S/.test(rest)) {
          children.push({
            id: nid(),
            type: "__unknown__",
            rawXml: rest,
            parentPath: path,
          } satisfies UnknownNode);
        }
        cursor = closeTagStart;
        break;
      }

      const childSlice = src.slice(childEl.start, childEl.end);
      if (
        isModeledType(childEl.name) &&
        !allowed.has(childEl.name as BlockType)
      ) {
        children.push(passthrough(childSlice, childEl.name));
      } else {
        const childNode = parseElement(ctx, childEl, path, children.length);
        children.push(childNode);
      }
      cursor = childEl.end;
    }

    return {
      id: nid(),
      type: tag as Exclude<BlockType, "mj-custom-passthrough">,
      attrs,
      children,
    } satisfies BlockNode;
  }

  // A leaf with element children is not something we model; keep it verbatim.
  const hasElementChild = childrenFx.some((c) => {
    const k = getTagName(c);
    return k && k !== "#text" && k !== "#comment";
  });
  if (hasElementChild) {
    return passthrough(elementSlice, tag);
  }

  let text: string | undefined;
  if (def.contentField === "text") {
    const textParts: string[] = [];
    for (const c of childrenFx) {
      if (typeof c["#text"] === "string") {
        textParts.push(c["#text"] as string);
      }
    }
    text = textParts.join("");
  }

  return {
    id: nid(),
    type: tag as Exclude<BlockType, "mj-custom-passthrough">,
    attrs,
    text,
  } satisfies BlockNode;
}

/** Lossless: anything not modeled is kept as a verbatim source slice. */
export function parseMjml(source: string): MjmlDocument {
  const mjmlOpenIdx = source.search(/<\s*mjml\b/i);
  // No `<mjml>` root: the whole input is opaque.
  if (mjmlOpenIdx === -1) {
    return { body: [passthrough(source, "")] };
  }

  const docPreamble = source.slice(0, mjmlOpenIdx);

  const mjmlEl = readElement(source, mjmlOpenIdx);
  if (!mjmlEl) {
    return {
      docPreamble,
      body: [passthrough(source.slice(mjmlOpenIdx), "mjml")],
    };
  }

  const mjmlOpenEnd = source.indexOf(">", mjmlEl.start) + 1;
  const wrapperRaw = source.slice(mjmlEl.start, mjmlOpenEnd);
  const rawWrapper = wrapperRaw.replace(/^<\s*mjml/i, "").replace(/>$/, "").trim();

  let head: { rawXml: string } | undefined;
  let bodyAttrs: Map<string, string> | undefined;
  const body: TreeNode[] = [];
  let cursor = mjmlOpenEnd;
  const innerEnd = source.lastIndexOf("</", mjmlEl.end);

  while (cursor < innerEnd) {
    while (cursor < innerEnd && /\s/.test(source[cursor]!)) cursor++;
    if (cursor >= innerEnd) break;

    const cm = readComment(source, cursor);
    // Comments between head and body have no home of their own; body keeps them.
    if (cm && cm.end <= innerEnd) {
      body.push({
        id: nid(),
        type: "__unknown__",
        rawXml: source.slice(cm.start, cm.end),
        parentPath: "mjml",
      });
      cursor = cm.end;
      continue;
    }

    const el = readElement(source, cursor);
    if (!el || el.end > innerEnd) break;

    if (el.name === "mj-head") {
      head = { rawXml: source.slice(el.start, el.end) };
    } else if (el.name === "mj-body") {
      const openTagEnd = source.indexOf(">", el.start) + 1;
      // Parsed as a synthetic self-closed tag, so mj-body's own attrs come out
      // through the same path — and the same ordering — as every other block.
      const openTagSlice = source.slice(el.start, openTagEnd);
      const synthOpen = el.selfClosing
        ? openTagSlice
        : openTagSlice.replace(/>$/, " />");
      try {
        const parsedOpen = xmlParser.parse(synthOpen) as FxpNode[];
        if (Array.isArray(parsedOpen) && parsedOpen.length === 1) {
          bodyAttrs = getAttrs(parsedOpen[0]!);
        } else {
          bodyAttrs = new Map();
        }
      } catch {
        bodyAttrs = new Map();
      }

      const closeTagStart = el.selfClosing
        ? openTagEnd
        : source.lastIndexOf("</", el.end - 2);
      const children = el.selfClosing
        ? []
        : parseBodyChildren(
            { src: source },
            openTagEnd,
            closeTagStart,
            "mj-body"
          );
      body.push(...children);
    } else {
      body.push(passthrough(source.slice(el.start, el.end), el.name));
    }
    cursor = el.end;
  }

  return {
    docPreamble: docPreamble || undefined,
    rawWrapper: rawWrapper || undefined,
    head,
    bodyAttrs,
    body,
  };
}
