import { ExpansionError } from "./types.js";

/**
 * Quote-aware tag scanning. Deliberately not a regex: `/<mj-component[^>]*\/>/`
 * stops at a `>` inside an attribute value —
 *
 *     <mj-component component-id="x" ov-content="a > b" />
 *
 * — and produces a truncated match. The expander's exit guard would catch the
 * fallout, but a correct scanner should not be leaning on it.
 */

/** Raised when a source carries an unterminated `<!--` that could hide a reference. */
export class UnterminatedCommentError extends ExpansionError {
  constructor(readonly at: number) {
    super(
      `Unterminated <!-- comment at offset ${at}. Refusing to scan: mjml treats ` +
        `everything after it as comment content, so a reference inside would be ` +
        `silently absent from the output.`
    );
    this.name = "UnterminatedCommentError";
  }
}

export interface Range {
  start: number;
  end: number;
}

export interface CommentScan {
  ranges: Range[];
  /** Offset of an unterminated `<!--`, if the source carries one. */
  unterminatedAt?: number;
}

/**
 * Inside these, `<!--` is ordinary text and opens no comment. `textarea` is
 * deliberately absent: htmlparser2 treats it as raw text only in HTML mode, and
 * mjml parses as XML — skipping its content here would call live what the real
 * parser comments out.
 */
const RAW_TEXT_ELEMENTS = ["script", "style", "title"];

/**
 * Byte ranges covered by XML comments. This must agree with htmlparser2, the
 * parser mjml actually uses: a disagreement is a leak in one direction or a
 * false rejection in the other.
 *
 * An unterminated comment is reported rather than thrown, because it only
 * matters when a reference could be hidden by it — a template with a stray
 * `<!--` and no components renders fine in mjml.
 */
export function scanComments(src: string): CommentScan {
  const ranges: Range[] = [];
  let unterminatedAt: number | undefined;
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) break;

    // CDATA is not markup, and mjml enables it. Without this the tag-skip below
    // stops at the first `>` inside it and leaks a phantom comment opener.
    if (src.startsWith("<![CDATA[", lt)) {
      const close = src.indexOf("]]>", lt + 9);
      i = close === -1 ? src.length : close + 3;
      continue;
    }

    if (src.startsWith("<!--", lt)) {
      // From lt + 2, so the opener's own `--` can close a short comment, which
      // is what htmlparser2 does for `<!-->` and `<!--->`. Searching from lt + 4
      // would run the comment on to the next `-->` anywhere in the document.
      const close = src.indexOf("-->", lt + 2);
      if (close === -1) {
        unterminatedAt = lt;
        ranges.push({ start: lt, end: src.length });
        break;
      }
      ranges.push({ start: lt, end: close + 3 });
      i = close + 3;
      continue;
    }

    // Quote-aware, so a `<!--` inside an attribute value is not a comment opener.
    let j = lt + 1;
    let inSingle = false;
    let inDouble = false;
    while (j < src.length) {
      const ch = src[j]!;
      if (inSingle) {
        if (ch === "'") inSingle = false;
      } else if (inDouble) {
        if (ch === '"') inDouble = false;
      } else if (ch === "'") inSingle = true;
      else if (ch === '"') inDouble = true;
      else if (ch === ">") break;
      j++;
    }

    const nameMatch = /^<\s*([A-Za-z][\w-]*)/.exec(src.slice(lt, j + 1));
    const name = nameMatch?.[1]?.toLowerCase();
    const selfClosed = src[j - 1] === "/";
    if (name && !selfClosed && RAW_TEXT_ELEMENTS.includes(name)) {
      const closeTag = src.toLowerCase().indexOf(`</${name}`, j);
      i = closeTag === -1 ? src.length : closeTag;
      continue;
    }

    i = j + 1;
  }

  return { ranges, unterminatedAt };
}

/** Ranges only. Retained for call sites that do not care about termination. */
export function commentRanges(src: string): Range[] {
  return scanComments(src).ranges;
}

export function isInRanges(ranges: Range[], offset: number): boolean {
  return ranges.some((r) => offset >= r.start && offset < r.end);
}

export interface ScannedAttr {
  name: string;
  /** Exactly as it appeared in source; entities are not decoded. */
  value: string;
}

/**
 * Extends `ExpansionError` deliberately: every caller of `expand()` catches
 * that type, so an error outside the hierarchy escapes all of them.
 */
export class MalformedTagError extends ExpansionError {
  constructor(
    readonly tagName: string,
    readonly at: number
  ) {
    super(`Malformed <${tagName}> at offset ${at}: tag is not terminated`);
    this.name = "MalformedTagError";
  }
}

export interface ScannedTag {
  name: string;
  /** Offset of `<`. */
  start: number;
  /** One past the closing `>`. */
  end: number;
  selfClosing: boolean;
  /** In source order. */
  attrs: ScannedAttr[];
}

/**
 * Takes the slice between the end of a tag name and its terminating `>`.
 * Unquoted values are accepted because hand-authored MJML carries them, and
 * dropping an attribute silently would be worse than reading it.
 */
function parseAttrs(src: string): ScannedAttr[] {
  const out: ScannedAttr[] = [];
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i]!)) i++;
    if (i >= src.length) break;

    const nameStart = i;
    while (i < src.length && !/[\s=]/.test(src[i]!)) i++;
    const name = src.slice(nameStart, i);
    if (!name) break;

    while (i < src.length && /\s/.test(src[i]!)) i++;

    // A valueless attribute (`disabled`) is kept with an empty value rather than
    // dropped. It does not round-trip — `renderOpenTag` emits `disabled=""` —
    // but MJML has none, so nothing here depends on the distinction.
    if (src[i] !== "=") {
      out.push({ name, value: "" });
      continue;
    }
    i++;
    while (i < src.length && /\s/.test(src[i]!)) i++;

    const quote = src[i];
    if (quote === '"' || quote === "'") {
      i++;
      const valStart = i;
      while (i < src.length && src[i] !== quote) i++;
      out.push({ name, value: src.slice(valStart, i) });
      i++;
    } else {
      const valStart = i;
      while (i < src.length && !/\s/.test(src[i]!)) i++;
      out.push({ name, value: src.slice(valStart, i) });
    }
  }
  return out;
}

/** Locates the OPEN tag only, which for a self-closing tag is the element. */
export function findTag(
  src: string,
  tagName: string,
  from = 0,
  comments?: Range[]
): ScannedTag | null {
  let searchFrom = from;
  // Supplied by `findAllTags`, so repeated scanning stays linear.
  const commentSpans = comments ?? commentRanges(src);

  for (;;) {
    const idx = src.indexOf(`<${tagName}`, searchFrom);
    if (idx === -1) return null;

    // A commented-out reference must not be expanded into the comment.
    if (isInRanges(commentSpans, idx)) {
      searchFrom = idx + 1;
      continue;
    }

    // `<mj-component-group` must not match `<mj-component`.
    const after = src[idx + tagName.length + 1];
    if (after !== undefined && /[\w-]/.test(after)) {
      searchFrom = idx + 1;
      continue;
    }

    let i = idx + tagName.length + 1;
    let inSingle = false;
    let inDouble = false;
    let end = -1;
    let selfClosing = false;
    let attrsEnd = -1;

    while (i < src.length) {
      const c = src[i]!;
      if (inSingle) {
        if (c === "'") inSingle = false;
      } else if (inDouble) {
        if (c === '"') inDouble = false;
      } else if (c === "'") {
        inSingle = true;
      } else if (c === '"') {
        inDouble = true;
      } else if (c === "/" && src[i + 1] === ">") {
        attrsEnd = i;
        end = i + 2;
        selfClosing = true;
        break;
      } else if (c === ">") {
        attrsEnd = i;
        end = i + 1;
        break;
      }
      i++;
    }

    // Present-but-unscannable is not the same as absent: collapsing both to
    // null would make a malformed reference invisible to the expander's guard.
    if (end === -1) throw new MalformedTagError(tagName, idx);

    return {
      name: tagName,
      start: idx,
      end,
      selfClosing,
      attrs: parseAttrs(src.slice(idx + tagName.length + 1, attrsEnd)),
    };
  }
}

/** Find every occurrence of a tag, left to right, non-overlapping. */
export function findAllTags(src: string, tagName: string): ScannedTag[] {
  const out: ScannedTag[] = [];
  const comments = commentRanges(src);
  let from = 0;
  for (;;) {
    const t = findTag(src, tagName, from, comments);
    if (!t) return out;
    out.push(t);
    from = t.end;
  }
}

/** A component body's single root, so overrides can be applied to it. */
export function readRootTag(src: string): ScannedTag | null {
  const idx = src.indexOf("<");
  if (idx === -1) return null;
  // A body may be commented above its root. Doctypes and processing
  // instructions are not handled: a body is a fragment, never a document.
  let cursor = idx;
  while (cursor < src.length) {
    if (src.startsWith("<!--", cursor)) {
      const close = src.indexOf("-->", cursor);
      if (close === -1) return null;
      cursor = src.indexOf("<", close + 3);
      if (cursor === -1) return null;
      continue;
    }
    break;
  }
  const m = /^<\s*([A-Za-z][\w-]*)/.exec(src.slice(cursor));
  if (!m) return null;
  return findTag(src, m[1]!, cursor);
}

/**
 * Attribute order is preserved; `"` must be escaped because `parseAttrs`
 * accepts single-quoted source while this always emits double quotes. A value
 * holding a literal `"` would otherwise terminate its attribute and have the
 * remainder re-read as further attributes — an injection primitive, since an
 * `ov-*` override lands on the component root:
 *
 *     ov-color='#000" href="https://evil.test/steal'
 *       -> <mj-button color="#000" href="https://evil.test/steal">
 *
 * A value parsed from double-quoted source cannot contain a bare `"`, so this
 * is a no-op on the round-trip path.
 */
export function renderOpenTag(
  name: string,
  attrs: ScannedAttr[],
  selfClosing: boolean
): string {
  const parts = attrs.map(
    (a) => `${a.name}="${a.value.replace(/"/g, "&quot;")}"`
  );
  const body = parts.length ? " " + parts.join(" ") : "";
  return `<${name}${body}${selfClosing ? " />" : ">"}`;
}

/**
 * One past the matching close tag, or null when the element is never closed —
 * which callers must be able to tell apart from "closes at end of input", or
 * `assertSingleRoot` passes vacuously for an unclosed root.
 */
export function findElementEnd(src: string, open: ScannedTag): number | null {
  if (open.selfClosing) return open.end;

  let depth = 1;
  let cursor = open.end;

  for (;;) {
    const nextOpen = findTag(src, open.name, cursor);
    const closeRe = new RegExp(`<\\s*\\/\\s*${open.name}\\s*>`, "g");
    closeRe.lastIndex = cursor;
    const nextClose = closeRe.exec(src);

    if (!nextClose) return null; // never closed

    if (nextOpen && nextOpen.start < nextClose.index) {
      // A self-closing same-name tag opens and closes at once.
      if (!nextOpen.selfClosing) depth++;
      cursor = nextOpen.end;
      continue;
    }

    depth--;
    cursor = nextClose.index + nextClose[0].length;
    if (depth === 0) return cursor;
  }
}

/**
 * The element at an index path of ELEMENT children: `[0, 2]` is the third
 * element child of the first. Comments and text are not counted, so adding a
 * comment to a component body does not move a path — which is what makes a
 * path-based override usable at all.
 *
 * Null when the path does not resolve, so the caller can name the component
 * rather than silently skipping an override the author asked for.
 */
export function findElementAtPath(
  src: string,
  path: number[],
  comments?: Range[]
): ScannedTag | null {
  const spans = comments ?? commentRanges(src);

  let scopeStart = 0;
  let scopeEnd = src.length;
  let current: ScannedTag | null = null;

  for (const wanted of path) {
    let idx = -1;
    let cursor = scopeStart;
    let found: ScannedTag | null = null;

    while (cursor < scopeEnd) {
      const lt = src.indexOf("<", cursor);
      if (lt === -1 || lt >= scopeEnd) break;
      if (isInRanges(spans, lt) || src.startsWith("<!--", lt) || src.startsWith("</", lt)) {
        cursor = lt + 1;
        continue;
      }
      const m = /^<\s*([A-Za-z][\w-]*)/.exec(src.slice(lt));
      if (!m) {
        cursor = lt + 1;
        continue;
      }
      let tag: ScannedTag | null;
      try {
        tag = findTag(src, m[1]!, lt, spans);
      } catch {
        return null; // malformed; the survivor guard reports the real problem
      }
      if (!tag || tag.start !== lt) {
        cursor = lt + 1;
        continue;
      }
      idx++;
      if (idx === wanted) {
        found = tag;
        break;
      }
      const end = findElementEnd(src, tag);
      cursor = end === null ? tag.end : end;
    }

    if (!found) return null;
    current = found;
    scopeStart = found.end;
    const e = findElementEnd(src, found);
    scopeEnd = e === null ? src.length : e;
  }

  return current;
}
