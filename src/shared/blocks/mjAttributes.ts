/**
 * String-slice editor for `<mj-attributes>` defaults inside `<mj-head>`'s
 * `rawXml`. Used by the right-panel "Settings" tab to set design defaults
 * (e.g. default font family, default text color, default link color)
 * without round-tripping through fast-xml-parser.
 *
 * MJML's `<mj-attributes>` block lets you declare per-element-type
 * defaults inside the head, e.g.:
 *
 *   <mj-head>
 *     <mj-attributes>
 *       <mj-all font-family="Arial, sans-serif" />
 *       <mj-text color="#333333" line-height="1.5" />
 *       <a color="#1f6feb" />
 *     </mj-attributes>
 *   </mj-head>
 *
 * `getMjAttribute(headRaw, "mj-text", "color")` reads the current value;
 * `setMjAttribute(headRaw, "mj-text", "color", "#000000")` writes it.
 *
 * Algorithm (mirrors headEdit.ts indexOf-style slicing):
 *  1. Locate `<mj-attributes>...</mj-attributes>` inside the head. If
 *     missing, insert one immediately after `<mj-head>`'s open tag with
 *     a single child `<{element} {attr}="{value}" />`.
 *  2. Within mj-attributes' inner range, locate the first `<{element}`
 *     open tag (with strict `[\s/>]` lookahead so `mj-text` doesn't match
 *     `mj-text-extra`, etc.). If missing, insert
 *     `<{element} {attr}="{value}" />` immediately after the
 *     mj-attributes open tag.
 *  3. Within the element's open tag, find `attr="..."`. If present,
 *     slice-replace its quoted value. If absent, insert the new attr
 *     immediately before the closing `>` or `/>`, padded with whitespace
 *     so the emitted tag stays well-formed (e.g. `<mj-text foo="bar" />`,
 *     not `<mj-text foo="bar"/>`).
 *
 * Quote handling: only `"..."` (double-quoted) is supported on write.
 * Reading also accepts only double-quoted values; single-quoted
 * attributes are rare in MJML output and would simply read as missing.
 *
 * Validation: `element` is restricted to `^[a-zA-Z][\\w-]*$` (handles
 * `mj-all`, `mj-text`, `mj-button`, plain `a`, etc.). `attr` is
 * restricted to `^[a-zA-Z][\\w:-]*$`. Invalid names short-circuit
 * (get returns `""`, set returns the input unchanged).
 *
 * Values are HTML-attribute-escaped on write: `&` → `&amp;`,
 * `"` → `&quot;`, `<` → `&lt;`. Read returns the raw quoted slice
 * (caller decodes if needed).
 */

const ELEMENT_NAME_RE = /^[a-zA-Z][\w-]*$/;
const ATTR_NAME_RE = /^[a-zA-Z][\w:-]*$/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Find `<{tag}` where the next char after the tag name is whitespace,
 * `/`, or `>`. Returns the offset of `<`, or `-1` if not found.
 */
function findOpenTag(xml: string, tag: string, fromIdx = 0): number {
  const re = new RegExp(`<${escapeRe(tag)}(?=[\\s/>])`, "g");
  re.lastIndex = fromIdx;
  const m = re.exec(xml);
  return m ? m.index : -1;
}

interface TagLocation {
  /** Offset of `<` of the open tag. */
  tagOpenStart: number;
  /** Offset just after the `>` (or `/>`) of the open tag. */
  openEnd: number;
  isSelfClose: boolean;
  /** Offset of inner content start (== openEnd). null if self-closing. */
  innerStart: number | null;
  /** Offset of `<` of the matching close tag. null if self-closing. */
  innerEnd: number | null;
}

/**
 * Locate `<{tag}>...</{tag}>` (or self-closing `<{tag} />`) starting from
 * `fromIdx`. Tolerates quoted attribute values containing `>` / `/`.
 * Tracks depth for nested same-name tags.
 */
function locateTag(
  xml: string,
  tag: string,
  fromIdx = 0
): TagLocation | null {
  const tagOpenStart = findOpenTag(xml, tag, fromIdx);
  if (tagOpenStart < 0) return null;

  let i = tagOpenStart + 1 + tag.length;
  let inSingle = false;
  let inDouble = false;
  let openEnd = -1;
  let isSelfClose = false;
  while (i < xml.length) {
    const c = xml[i]!;
    if (inSingle) {
      if (c === "'") inSingle = false;
    } else if (inDouble) {
      if (c === '"') inDouble = false;
    } else if (c === "'") inSingle = true;
    else if (c === '"') inDouble = true;
    else if (c === "/" && xml[i + 1] === ">") {
      openEnd = i + 2;
      isSelfClose = true;
      break;
    } else if (c === ">") {
      openEnd = i + 1;
      break;
    }
    i++;
  }
  if (openEnd < 0) return null;

  if (isSelfClose) {
    return {
      tagOpenStart,
      openEnd,
      isSelfClose: true,
      innerStart: null,
      innerEnd: null,
    };
  }

  // Walk forward tracking depth so nested same-name tags balance correctly.
  const openRe = new RegExp(`<${escapeRe(tag)}(?=[\\s/>])`, "g");
  const closeRe = new RegExp(`</${escapeRe(tag)}\\s*>`, "g");
  let depth = 1;
  let cursor = openEnd;
  while (cursor < xml.length) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const o = openRe.exec(xml);
    const c = closeRe.exec(xml);
    if (!c) return null;
    if (o && o.index < c.index) {
      depth++;
      cursor = o.index + 1;
      continue;
    }
    depth--;
    if (depth === 0) {
      return {
        tagOpenStart,
        openEnd,
        isSelfClose: false,
        innerStart: openEnd,
        innerEnd: c.index,
      };
    }
    cursor = c.index + c[0].length;
  }
  return null;
}

interface AttrMatch {
  /** Offset of the first character of the attribute value (inside quotes). */
  valueStart: number;
  /** Offset of the closing quote. */
  valueEnd: number;
}

/** Find `attr="..."` inside [openStart, openEnd). Whitespace-bounded so
 * we don't match attribute names that appear as substrings of values. */
function findAttr(
  xml: string,
  attr: string,
  openStart: number,
  openEnd: number
): AttrMatch | null {
  const re = new RegExp(`(?:\\s)${escapeRe(attr)}\\s*=\\s*"([^"]*)"`, "g");
  re.lastIndex = openStart;
  const m = re.exec(xml);
  if (!m) return null;
  if (m.index >= openEnd) return null;
  if (re.lastIndex > openEnd) return null;
  // Find the offsets of the opening and closing quote.
  // m[1] is the captured value; its length tells us where the quotes sit.
  const quoteOpen = xml.indexOf('"', m.index);
  return { valueStart: quoteOpen + 1, valueEnd: quoteOpen + 1 + m[1]!.length };
}

/**
 * Read `<{element} {attr}="...">` from `<mj-attributes>` inside
 * `headRawXml`. Returns the raw quoted slice, or `""` if the head is
 * missing the mj-attributes block, the element, or the attribute.
 */
export function getMjAttribute(
  headRawXml: string,
  element: string,
  attr: string
): string {
  if (!ELEMENT_NAME_RE.test(element)) return "";
  if (!ATTR_NAME_RE.test(attr)) return "";

  const mjAttrs = locateTag(headRawXml, "mj-attributes");
  if (!mjAttrs || mjAttrs.innerStart === null || mjAttrs.innerEnd === null) {
    return "";
  }

  const elem = locateTag(headRawXml, element, mjAttrs.innerStart);
  if (!elem || elem.tagOpenStart >= mjAttrs.innerEnd) return "";

  const found = findAttr(
    headRawXml,
    attr,
    elem.tagOpenStart,
    elem.openEnd
  );
  if (!found) return "";
  return headRawXml.slice(found.valueStart, found.valueEnd);
}

/**
 * Set (insert or update) `<{element} {attr}="..."/>` inside
 * `<mj-attributes>` in `headRawXml`. Creates the mj-attributes block
 * and/or the element node as needed. Returns the new headRawXml.
 *
 * If `headRawXml` carries no `<mj-head>` open tag, returns a freshly
 * wrapped head containing only the requested default — defensive
 * fallback for callers that pass raw fragments.
 */
export function setMjAttribute(
  headRawXml: string,
  element: string,
  attr: string,
  value: string
): string {
  if (!ELEMENT_NAME_RE.test(element)) return headRawXml;
  if (!ATTR_NAME_RE.test(attr)) return headRawXml;

  const escaped = escapeAttr(value);

  // 1. Find or create the mj-attributes block inside mj-head.
  const mjAttrs = locateTag(headRawXml, "mj-attributes");
  if (!mjAttrs || mjAttrs.innerStart === null || mjAttrs.innerEnd === null) {
    const headOpen = findOpenTag(headRawXml, "mj-head");
    if (headOpen < 0) {
      return `<mj-head><mj-attributes><${element} ${attr}="${escaped}" /></mj-attributes></mj-head>`;
    }
    const headOpenEnd = headRawXml.indexOf(">", headOpen);
    if (headOpenEnd < 0) return headRawXml;
    const insertAt = headOpenEnd + 1;
    return (
      headRawXml.slice(0, insertAt) +
      `<mj-attributes><${element} ${attr}="${escaped}" /></mj-attributes>` +
      headRawXml.slice(insertAt)
    );
  }

  // 2. Find or create the element inside mj-attributes.
  const elem = locateTag(headRawXml, element, mjAttrs.innerStart);
  if (!elem || elem.tagOpenStart >= mjAttrs.innerEnd) {
    return (
      headRawXml.slice(0, mjAttrs.innerStart) +
      `<${element} ${attr}="${escaped}" />` +
      headRawXml.slice(mjAttrs.innerStart)
    );
  }

  // 3. Replace existing attr value, or insert a new attr inside the
  //    element's open tag.
  const found = findAttr(headRawXml, attr, elem.tagOpenStart, elem.openEnd);
  if (found) {
    return (
      headRawXml.slice(0, found.valueStart) +
      escaped +
      headRawXml.slice(found.valueEnd)
    );
  }

  const insertAt = elem.isSelfClose ? elem.openEnd - 2 : elem.openEnd - 1;
  const before = headRawXml[insertAt - 1] ?? "";
  const leadingSpace =
    before === " " || before === "\t" || before === "\n" ? "" : " ";
  // For self-closing tags, ensure there is a space before `/>`:
  // we want `<x foo="v" />`, not `<x foo="v"/>`.
  const trailing = elem.isSelfClose ? " " : "";
  return (
    headRawXml.slice(0, insertAt) +
    `${leadingSpace}${attr}="${escaped}"${trailing}` +
    headRawXml.slice(insertAt)
  );
}

/**
 * Remove `<{element} ... {attr}="..." ...>` from `<mj-attributes>`.
 * Leaves the element node in place even if it becomes attribute-less
 * (e.g. `<mj-text />`); higher-level UI is responsible for any further
 * cleanup. No-op if mj-attributes, the element, or the attr is missing.
 */
export function deleteMjAttribute(
  headRawXml: string,
  element: string,
  attr: string
): string {
  if (!ELEMENT_NAME_RE.test(element)) return headRawXml;
  if (!ATTR_NAME_RE.test(attr)) return headRawXml;

  const mjAttrs = locateTag(headRawXml, "mj-attributes");
  if (!mjAttrs || mjAttrs.innerStart === null || mjAttrs.innerEnd === null) {
    return headRawXml;
  }

  const elem = locateTag(headRawXml, element, mjAttrs.innerStart);
  if (!elem || elem.tagOpenStart >= mjAttrs.innerEnd) return headRawXml;

  // Remove preceding whitespace + the attr declaration so we don't leave
  // a double-space behind. Anchored to the open-tag range so we don't
  // accidentally chew through inner text content.
  const re = new RegExp(`(\\s+)${escapeRe(attr)}\\s*=\\s*"[^"]*"`, "g");
  re.lastIndex = elem.tagOpenStart;
  const m = re.exec(headRawXml);
  if (!m) return headRawXml;
  if (re.lastIndex > elem.openEnd) return headRawXml;
  return headRawXml.slice(0, m.index) + headRawXml.slice(re.lastIndex);
}
