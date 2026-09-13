/**
 * Quote-aware tag scanning for the component expander.
 *
 * **Deliberately not a regex** (plan §11, "two decisions locked now"). A naive
 * `/<mj-component[^>]*\/>/` misses a raw `>` inside an attribute value:
 *
 *     <mj-component component-id="x" ov-content="a > b" />
 *
 * ...where `[^>]*` stops at the `>` inside the value and produces a truncated,
 * wrong match. The expander fails closed into the throw-on-survivor guard when
 * that happens, but the plan is explicit that we must not RELY on the guard for
 * something a correct scanner handles.
 *
 * This mirrors the technique already proven in `parser.ts`'s `readElement`:
 * walk the string tracking single/double quote state, and only treat `>` as a
 * tag terminator when outside both.
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
 * Elements whose content is RAW TEXT, not markup. Inside these, `<!--` is
 * ordinary text and opens no comment — htmlparser2 tokenizes them specially and
 * so must we, or `<script><!--</script>` starts a comment here that never
 * started there, swallowing every reference until the next `-->`.
 */
const RAW_TEXT_ELEMENTS = ["script", "style", "title"];
// `textarea` is deliberately NOT listed. htmlparser2 treats it as raw text only
// in HTML mode; under the XML options mjml uses it does not, so skipping its
// content here made us call live what the real parser comments out. The
// direction was fail-safe, but a second parser that is "safely wrong" is still
// wrong, and the next person to read this list should not learn the wrong rule.

/**
 * Byte ranges covered by XML comments.
 *
 * **This must agree with htmlparser2**, which is the parser mjml actually uses
 * (via mjml-parser-xml). Any disagreement is a leak in one direction or a false
 * rejection in the other, and both have happened here:
 *
 *  - A backward `lastIndexOf("<!--")` was fooled by a `<!--` inside an attribute
 *    value, and by an unterminated comment. Fixed by scanning forward and
 *    skipping whole tags quote-aware.
 *  - **Short comments.** htmlparser2 closes `<!-->` and `<!--->` immediately
 *    (Tokenizer.js: "Allow short comments (eg. <!-->)", sequenceIndex = 2).
 *    Searching for `-->` from `lt + 4` misses that and runs the comment on to
 *    the NEXT `-->` anywhere later in the document — which any ordinary trailing
 *    comment supplies — swallowing every reference in between. Searching from
 *    `lt + 2` lets the opener's own `--` serve as the closer's, which is exactly
 *    what htmlparser2 does.
 *  - **Raw-text elements.** See RAW_TEXT_ELEMENTS.
 *
 * An unterminated comment is REPORTED rather than thrown, so the caller can
 * decide. It only matters when a reference could be hidden by it; a template
 * with a stray `<!--` and no components renders fine in mjml and must not be
 * rejected here.
 */
export function scanComments(src: string): CommentScan {
  const ranges: Range[] = [];
  let unterminatedAt: number | undefined;
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) break;

    // CDATA is NOT markup: `<!--` inside it opens no comment, and mjml enables
    // it (recognizeCDATA: true). Without this the generic tag-skip below stops
    // at the first `>` INSIDE the CDATA, so a section containing both `>` and
    // `<!--` leaks a phantom comment opener. That produced both a missed
    // expansion and — the mirror defect — a 422 on a template mjml compiles.
    if (src.startsWith("<![CDATA[", lt)) {
      const close = src.indexOf("]]>", lt + 9);
      i = close === -1 ? src.length : close + 3;
      continue;
    }

    if (src.startsWith("<!--", lt)) {
      // From lt + 2, so the opener's own `--` can close a short comment.
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

    // Skip past this tag quote-aware, so a `<!--` inside an attribute value
    // cannot be mistaken for a comment opener.
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

    // If this opened a raw-text element, its CONTENT is text: skip to the close
    // tag so a `<!--` inside it is never read as a comment opener.
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
  /** Raw value exactly as it appeared in source, entities NOT decoded. */
  value: string;
}

import { ExpansionError } from "./types.js";

/**
 * Raised when a tag is present but cannot be scanned (e.g. unterminated quote).
 *
 * Extends `ExpansionError` deliberately: every caller of `expand()` catches
 * that type, so an error outside the hierarchy escapes them all. When this
 * extended plain `Error`, a malformed reference produced an unhandled HTTP 500
 * with a stack trace from `render.ts` instead of the intended 422, and would
 * have crashed the CLI.
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
  /** Inclusive start offset of `<`. */
  start: number;
  /** Exclusive end offset, one past the closing `>`. */
  end: number;
  selfClosing: boolean;
  /** Attributes in source order. */
  attrs: ScannedAttr[];
}

/**
 * Parse the attribute list of an open tag, given the slice strictly between the
 * end of the tag name and the terminating `>` (or `/>`).
 *
 * Values may be double- or single-quoted. Unquoted values are accepted because
 * hand-authored MJML sometimes carries them, and silently dropping an attribute
 * would be worse than reading it.
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

    if (src[i] !== "=") {
      // Valueless attribute (e.g. `disabled`). Recorded with an empty value so
      // it is not silently dropped. NOTE: this does NOT round-trip —
      // `renderOpenTag` re-emits it as `disabled=""`. MJML has no valueless
      // attributes, so nothing in this codebase depends on the distinction.
      out.push({ name, value: "" });
      continue;
    }
    i++; // consume '='
    while (i < src.length && /\s/.test(src[i]!)) i++;

    const quote = src[i];
    if (quote === '"' || quote === "'") {
      i++;
      const valStart = i;
      while (i < src.length && src[i] !== quote) i++;
      out.push({ name, value: src.slice(valStart, i) });
      i++; // consume closing quote
    } else {
      const valStart = i;
      while (i < src.length && !/\s/.test(src[i]!)) i++;
      out.push({ name, value: src.slice(valStart, i) });
    }
  }
  return out;
}

/**
 * Find the next element with the given tag name at or after `from`, scanning
 * quote-aware so a `>` inside an attribute value cannot terminate the tag
 * early.
 *
 * Only the OPEN tag is located. For a self-closing tag that is the whole
 * element, which is all the component reference ever is.
 */
export function findTag(
  src: string,
  tagName: string,
  from = 0,
  comments?: Range[]
): ScannedTag | null {
  let searchFrom = from;
  // Computed once per call unless the caller supplies it; `findAllTags` does,
  // so repeated scanning stays linear rather than quadratic.
  const commentSpans = comments ?? commentRanges(src);

  for (;;) {
    const idx = src.indexOf(`<${tagName}`, searchFrom);
    if (idx === -1) return null;

    // Skip tags inside XML comments. Without this a commented-out reference was
    // expanded INTO the comment — a commented-out line changing the output, and
    // corrupting the document outright if the body contained `--`.
    if (isInRanges(commentSpans, idx)) {
      searchFrom = idx + 1;
      continue;
    }

    // Guard against matching a longer tag name that merely starts with ours
    // (`<mj-component-group` must not match `<mj-component`). Mirrors the
    // `(?![\w-])` lookahead parser.ts relies on for the same reason.
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

    // A tag that is PRESENT but unscannable is not the same as no tag.
    // Collapsing both to `null` is what let a malformed reference slip past
    // both the substitution loop and the survivor guard — the guard used this
    // same scanner, so anything it could not see was invisible to both, making
    // the guard a tautology on the expander's own fixpoint.
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

/**
 * Read the first element's open tag in `src`, whatever it is called.
 * Used to locate a component body's single root so overrides can be applied
 * to it.
 */
export function readRootTag(src: string): ScannedTag | null {
  const idx = src.indexOf("<");
  if (idx === -1) return null;
  // Skip comments; a body may be commented above its root element.
  // Processing instructions and doctypes are NOT handled — a component body is
  // a fragment, never a document, so neither can legitimately appear.
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
 * Re-emit an open tag from its parts, preserving attribute order.
 *
 * Values MUST be escaped for `"`, because `parseAttrs` accepts single-quoted
 * source (`alt='say "hi"'`) while this always emits double quotes. Without the
 * escape, a value holding a literal `"` terminates the attribute and everything
 * after it is re-read as further attributes — a working injection primitive,
 * since an `ov-*` override lands on the component root:
 *
 *     ov-color='#000" href="https://evil.test/steal'
 *       -> <mj-button color="#000" href="https://evil.test/steal">
 *
 * The escape is safe for the round-trip contract: a value parsed from
 * double-quoted source can never contain a bare `"`, so this is a no-op there
 * and only fires on the single-quoted and programmatic paths.
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
 * Offset one past the matching close tag of the element opened at `open`.
 *
 * Returns `null` when the element is never closed — deliberately, so callers
 * can distinguish "unclosed" from "closes at end of input". The regex-based
 * predecessor returned the input length in that case, which made
 * `assertSingleRoot` pass VACUOUSLY for an unclosed root: the root appeared to
 * swallow the rest of the body, so no trailing content was ever seen.
 *
 * Uses `findTag`, so it inherits quote-awareness and comment-skipping. The
 * regex version had neither, and counted same-name tags inside comments and
 * inside attribute values, plus incremented depth for self-closing tags it
 * never decremented.
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
      // A self-closing same-name tag opens and closes at once — it must not
      // increment depth, which the regex predecessor got wrong.
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
 * Locate the element at an index path of ELEMENT children, e.g. [0, 2] is the
 * third element child of the first element child.
 *
 * Comments and text nodes are not counted, so a path stays stable when someone
 * adds a comment to a component body — which is the whole reason a path-based
 * override is usable at all.
 *
 * Returns null when the path does not resolve, so the caller can raise an error
 * naming the component and the path rather than silently not applying an
 * override the author asked for.
 */
export function findElementAtPath(
  src: string,
  path: number[],
  comments?: Range[]
): ScannedTag | null {
  const spans = comments ?? commentRanges(src);

  // Children of the element currently being descended into.
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
