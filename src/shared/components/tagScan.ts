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

export interface ScannedAttr {
  name: string;
  /** Raw value exactly as it appeared in source, entities NOT decoded. */
  value: string;
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
      // Valueless attribute (e.g. `disabled`). Record it with an empty value so
      // it round-trips rather than vanishing.
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
  from = 0
): ScannedTag | null {
  let searchFrom = from;

  for (;;) {
    const idx = src.indexOf(`<${tagName}`, searchFrom);
    if (idx === -1) return null;

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

    if (end === -1) return null; // unterminated tag

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
  let from = 0;
  for (;;) {
    const t = findTag(src, tagName, from);
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
  // Skip comments and processing instructions; a body may be commented above
  // its root element.
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

/** Re-emit an open tag from its parts, preserving attribute order. */
export function renderOpenTag(
  name: string,
  attrs: ScannedAttr[],
  selfClosing: boolean
): string {
  const parts = attrs.map((a) => `${a.name}="${a.value}"`);
  const body = parts.length ? " " + parts.join(" ") : "";
  return `<${name}${body}${selfClosing ? " />" : ">"}`;
}
