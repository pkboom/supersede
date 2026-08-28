/**
 * MJML → block-tree parser. *Lossless or fail-closed.*
 *
 * Strategy
 * --------
 * fast-xml-parser produces a structural skeleton with `preserveOrder: true`.
 * For any subtree we cannot model (mj-raw, mj-include, comments, unmodeled
 * tags, even modeled tags carrying attrs/children that don't fit our schema),
 * we capture the *original input substring* via a small balanced-tag walker
 * implemented over the raw source string. The captured slice is byte-equal
 * to the input — that's what gives us round-trip fidelity at the
 * fail-closed layer.
 *
 * Why both layers? fast-xml-parser does not expose byte offsets, so we
 * cannot ask it for "the slice that produced this node." We can, however,
 * walk the raw string ourselves with a forgiving tag scanner that tracks
 * `<mj-...>`/`</mj-...>` pairs and self-closing tags. The structural
 * skeleton tells us *what* to model; the raw walker tells us *what slice*
 * to preserve when we can't model.
 *
 * Trade-offs documented in the file head per plan request.
 */
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

// ----- Raw walker (byte-exact subtree extraction) -----

interface RawTag {
  /** Tag name including any namespace. */
  name: string;
  /** Inclusive byte offsets into the source string. */
  start: number;
  /** Exclusive end of the matched tag (whole element including children + close). */
  end: number;
  /** True if `<foo />` self-closing or `<foo>` immediately followed by `</foo>`. */
  selfClosing: boolean;
}

const TAG_OPEN_RE = /<\s*([A-Za-z][\w-]*)\b/g;

/**
 * Find the byte slice that contains the *element* starting at `from`.
 * Handles `<foo .../>`, `<foo></foo>`, comments, CDATA-like content,
 * and nested same-named tags by tracking depth.
 */
function readElement(src: string, from: number): RawTag | null {
  // Skip leading whitespace inside the search window? Caller controls `from`.
  TAG_OPEN_RE.lastIndex = from;
  const m = TAG_OPEN_RE.exec(src);
  if (!m) return null;
  if (m.index !== from && /\S/.test(src.slice(from, m.index))) {
    // There is non-whitespace text before the next tag — caller should treat
    // that as text, not as an element.
    return null;
  }
  const name = m[1]!;
  const tagOpenStart = m.index;

  // Find end of the open tag (the first '>' that isn't inside a quoted attribute).
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

  // Walk children counting same-named open/close tags.
  let depth = 1;
  let cursor = openEnd;
  // Negative lookahead `(?![\w-])` is mandatory here — `\b` matches between a
  // word char and `-`, so `<mj-social\b` would falsely match `<mj-social-element`
  // and over-increment depth when a tag name is a prefix of another's.
  const openRe = new RegExp(`<\\s*${escapeRe(name)}(?![\\w-])`, "g");
  const closeRe = new RegExp(`<\\s*\\/\\s*${escapeRe(name)}\\s*>`, "g");
  // Skip comments ranges so an `<!-- <foo> -->` doesn't mess up depth.
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

    // Skip past comments before considering tag matches inside them.
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

/**
 * Read a single comment `<!-- ... -->` starting at `from` (or skip whitespace
 * to find one immediately). Returns the comment slice end on match.
 */
function readComment(src: string, from: number): { start: number; end: number } | null {
  // Skip leading whitespace.
  let i = from;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  if (src.slice(i, i + 4) !== "<!--") return null;
  const end = src.indexOf("-->", i + 4);
  if (end === -1) return null;
  return { start: i, end: end + 3 };
}

// ----- Structural parser -----

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
// FxpNode is an index-signature type; the optional ":@" key holds attributes.
// We use unknown for the index to avoid the conflicting property type error
// when TypeScript checks ":@" against the index signature.
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
 * Build the attrs Map in source order (A-prime). We iterate the `:@` object's
 * keys via `Object.keys()` and `.set()` into a fresh Map. Per ES2015+ spec,
 * `Object.keys` returns string keys in insertion order — but for numeric-like
 * keys (e.g. `data-1="x"`), V8 sorts those to the front. Map preserves the
 * order we feed it regardless of key shape, which closes that hole.
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

function getChildren(node: FxpNode, tag: string): FxpNode[] {
  const v = node[tag];
  if (Array.isArray(v)) return v as FxpNode[];
  return [];
}

// ----- Body walker -----

interface ParseContext {
  src: string;
}

/**
 * Parse the children of <mj-body>. We re-walk the raw string to preserve
 * byte-exact slices for unmodeled subtrees.
 */
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
    // Skip pure whitespace.
    while (cursor < bodyInnerEnd && /\s/.test(src[cursor]!)) cursor++;
    if (cursor >= bodyInnerEnd) break;

    // Comment?
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

    // Element?
    const el = readElement(src, cursor);
    if (!el || el.end > bodyInnerEnd) {
      // Stray text — attach as an opaque node to keep round-trip.
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

  // Unmodeled tag — preserve verbatim as a typed Custom MJML placeholder.
  if (!isModeledType(tag)) {
    return {
      id: nid(),
      type: "mj-custom-passthrough",
      rawXml: elementSlice,
      originalTagName: tag,
    } satisfies CustomPassthroughNode;
  }

  const def = BLOCK_REGISTRY[tag as BlockType];

  // Parse this element through fast-xml-parser to extract attrs/children.
  let parsed: FxpNode[];
  try {
    parsed = xmlParser.parse(elementSlice) as FxpNode[];
  } catch {
    return {
      id: nid(),
      type: "mj-custom-passthrough",
      rawXml: elementSlice,
      originalTagName: tag,
    } satisfies CustomPassthroughNode;
  }

  if (!Array.isArray(parsed) || parsed.length !== 1) {
    return {
      id: nid(),
      type: "mj-custom-passthrough",
      rawXml: elementSlice,
      originalTagName: tag,
    } satisfies CustomPassthroughNode;
  }

  const fnode = parsed[0]!;
  const fname = getTagName(fnode);
  if (fname !== tag) {
    return {
      id: nid(),
      type: "mj-custom-passthrough",
      rawXml: elementSlice,
      originalTagName: tag,
    } satisfies CustomPassthroughNode;
  }

  const attrs = getAttrs(fnode);
  const childrenFx = getChildren(fnode, tag);

  const path = `${parentPath}/${tag}[${indexInParent}]`;

  // Container blocks: walk children via the raw walker so unmodeled subtrees
  // are captured byte-exactly. We walk the source range ourselves (rather
  // than reusing parseBodyChildren) so we can demote individual children to
  // `mj-custom-passthrough` when their type isn't in `allowedChildren`.
  if (def.isContainer) {
    const openTagEnd = src.indexOf(">", el.start) + 1;
    // `el.end` is exclusive (one past the `>` of the close tag). We must
    // search for `</` strictly BEFORE `el.end`, otherwise `lastIndexOf` can
    // match the OUTER element's `</` if its `<` happens to sit at index
    // `el.end - 1` (e.g. tightly-packed siblings like `</a></b>`).
    const closeTagStart = el.selfClosing
      ? openTagEnd
      : src.lastIndexOf(`</`, el.end - 2);

    const allowed = new Set(def.allowedChildren ?? []);
    const children: TreeNode[] = [];
    let cursor = openTagEnd;

    while (cursor < closeTagStart) {
      // Skip pure whitespace.
      while (cursor < closeTagStart && /\s/.test(src[cursor]!)) cursor++;
      if (cursor >= closeTagStart) break;

      // Comment?
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
      // If the child's tag is modeled but NOT in allowedChildren, demote it
      // (but keep the container as a real BlockNode). This is the per-child
      // demote path required by A-prime.
      if (
        isModeledType(childEl.name) &&
        !allowed.has(childEl.name as BlockType)
      ) {
        children.push({
          id: nid(),
          type: "mj-custom-passthrough",
          rawXml: childSlice,
          originalTagName: childEl.name,
        } satisfies CustomPassthroughNode);
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

  // Leaf blocks. If the element has nested element children at all, we don't
  // model that — preserve verbatim as a typed Custom MJML passthrough.
  const hasElementChild = childrenFx.some((c) => {
    const k = getTagName(c);
    return k && k !== "#text" && k !== "#comment";
  });
  if (hasElementChild) {
    return {
      id: nid(),
      type: "mj-custom-passthrough",
      rawXml: elementSlice,
      originalTagName: tag,
    } satisfies CustomPassthroughNode;
  }

  // Pull text content if the registry says we have a contentField.
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

// ----- Top-level parse -----

/**
 * Parse a full MJML document. The top-level structure (mj-head opaque,
 * mj-body decomposed) is captured separately so the serializer can re-emit
 * the document in the same shape.
 */
export function parseMjml(source: string): MjmlDocument {
  const mjmlOpenIdx = source.search(/<\s*mjml\b/i);
  if (mjmlOpenIdx === -1) {
    // No <mjml> root — the whole input is opaque MJML-ish content. Emit a
    // single `mj-custom-passthrough` carrying the verbatim slice. (Per A-prime,
    // tag-bearing slices that we can't model become passthrough; pure
    // stray-text/comments-only inputs would also flow here, but the round-trip
    // test corpus exercises only tag-bearing variants.)
    return {
      body: [
        {
          id: nid(),
          type: "mj-custom-passthrough",
          rawXml: source,
          originalTagName: "",
        } satisfies CustomPassthroughNode,
      ],
    };
  }

  const docPreamble = source.slice(0, mjmlOpenIdx);

  const mjmlEl = readElement(source, mjmlOpenIdx);
  if (!mjmlEl) {
    // Malformed `<mjml ...` open without a balanced close — treat as a
    // tag-bearing opaque slice.
    return {
      docPreamble,
      body: [
        {
          id: nid(),
          type: "mj-custom-passthrough",
          rawXml: source.slice(mjmlOpenIdx),
          originalTagName: "mjml",
        } satisfies CustomPassthroughNode,
      ],
    };
  }

  // Capture <mjml ...attrs...> wrapper attrs as raw text between '<mjml'
  // and '>' (without the 'mjml' name itself).
  const mjmlOpenEnd = source.indexOf(">", mjmlEl.start) + 1;
  const wrapperRaw = source.slice(mjmlEl.start, mjmlOpenEnd);
  // wrapperRaw looks like "<mjml ...>" — strip leading "<mjml" and trailing ">".
  const rawWrapper = wrapperRaw.replace(/^<\s*mjml/i, "").replace(/>$/, "").trim();

  // Walk inside <mjml>...</mjml> for mj-head + mj-body.
  let head: { rawXml: string } | undefined;
  let bodyAttrs: Map<string, string> | undefined;
  const body: TreeNode[] = [];
  let cursor = mjmlOpenEnd;
  const innerEnd = source.lastIndexOf("</", mjmlEl.end);

  while (cursor < innerEnd) {
    while (cursor < innerEnd && /\s/.test(source[cursor]!)) cursor++;
    if (cursor >= innerEnd) break;

    const cm = readComment(source, cursor);
    if (cm && cm.end <= innerEnd) {
      // Comments at this level: stash on whichever side hasn't been claimed.
      // Practical choice: prepend to body as UnknownNode.
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
      // Capture mj-body's own attributes via fast-xml-parser by parsing just
      // the open tag as a self-closed element. We make a synthetic
      // `<mj-body .../>` slice from the source open-tag substring so attribute
      // extraction is identical to the structural parser path used for
      // every other block — same insertion order semantics.
      const openTagSlice = source.slice(el.start, openTagEnd);
      // For self-closed bodies (`<mj-body ... />`), reuse the slice as-is.
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

      // See note in parseElement about el.end - 2 — strictly-before search
      // avoids matching the OUTER element's `</` for tightly-packed siblings.
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
      // Unmodeled top-level child of mjml — preserve as a typed Custom MJML
      // passthrough (tag-bearing slice).
      body.push({
        id: nid(),
        type: "mj-custom-passthrough",
        rawXml: source.slice(el.start, el.end),
        originalTagName: el.name,
      } satisfies CustomPassthroughNode);
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
