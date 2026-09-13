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


/** Raised when a source carries an unterminated `<!--`. */
export class UnterminatedCommentError extends ExpansionError {
  constructor(readonly at: number) {
    super(
      `Unterminated <!-- comment at offset ${at}. Refusing to scan: mjml swallows ` +
        `everything after it, so a reference inside would silently vanish from the output.`
    );
    this.name = "UnterminatedCommentError";
  }
}

export interface Range {
  start: number;
  end: number;
}

/**
 * Byte ranges covered by XML comments.
 *
 * **A forward scan, not `lastIndexOf("<!--")`.** The backward search is wrong in
 * two reachable ways, and both produced a silent HTTP 200 with content missing:
 *
 *  1. `<mj-text alt="<!--">x</mj-text><mj-component/>` — the `<!--` lives inside
 *     an ATTRIBUTE VALUE and opens no comment, but a backward search finds it
 *     and concludes the reference is commented out. It is then neither expanded
 *     nor reported.
 *  2. `<!-- note<mj-component/>` — an UNTERMINATED comment. A backward search
 *     finds the opener, sees no closer, and treats everything after it as
 *     commented. mjml does the same and swallows the rest of the document,
 *     without a diagnostic.
 *
 * Scanning forward and skipping whole tags quote-aware fixes (1); throwing on an
 * unterminated comment fixes (2) — that input is malformed source, and guessing
 * at intent is how the content went missing in the first place.
 *
 * Both the substitution scanner and the survivor guard use this. Sharing is safe
 * HERE, where it was not safe for tag scanning: this function is total — it
 * either returns unambiguous ranges or throws — so there is no failure mode for
 * the two to share. The independence that matters is over tag WELL-FORMEDNESS,
 * where the guard remains deliberately more permissive.
 */
export function commentRanges(src: string): Range[] {
  const out: Range[] = [];
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) break;

    if (src.startsWith("<!--", lt)) {
      const close = src.indexOf("-->", lt + 4);
      if (close === -1) throw new UnterminatedCommentError(lt);
      out.push({ start: lt, end: close + 3 });
      i = close + 3;
      continue;
    }

    // Any other `<` begins a tag (or stray text). Skip past it quote-aware so a
    // `<!--` sitting inside an attribute value cannot be mistaken for a comment.
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
    i = j + 1;
  }

  return out;
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
