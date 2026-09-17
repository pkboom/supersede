/**
 * Slice edits to `<mj-attributes>` defaults inside an `<mj-head>` rawXml:
 *
 *   <mj-attributes>
 *     <mj-all font-family="Arial, sans-serif" />
 *     <mj-text color="#333333" />
 *   </mj-attributes>
 *
 * Missing containers are created on write. Only double-quoted values are
 * read or written; a single-quoted one simply reads as missing.
 */

const ELEMENT_NAME_RE = /^[a-zA-Z][\w-]*$/;
const ATTR_NAME_RE = /^[a-zA-Z][\w:-]*$/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Requires whitespace, `/` or `>` after the name, so `mj-text-extra` misses. */
function findOpenTag(xml: string, tag: string, fromIdx = 0): number {
  const re = new RegExp(`<${escapeRe(tag)}(?=[\\s/>])`, "g");
  re.lastIndex = fromIdx;
  const m = re.exec(xml);
  return m ? m.index : -1;
}

interface TagLocation {
  tagOpenStart: number;
  /** Offset just past the `>` or `/>` of the open tag. */
  openEnd: number;
  isSelfClose: boolean;
  /** Both null when self-closing. */
  innerStart: number | null;
  innerEnd: number | null;
}

/** Quote-aware and depth-tracking, so `>` in a value and nesting are safe. */
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

/** Whitespace-bounded, so an attr name appearing inside a value never matches. */
function findAttr(
  xml: string,
  attr: string,
  openStart: number,
  openEnd: number
): { valueStart: number; valueEnd: number } | null {
  const re = new RegExp(`(?:\\s)${escapeRe(attr)}\\s*=\\s*"([^"]*)"`, "g");
  re.lastIndex = openStart;
  const m = re.exec(xml);
  if (!m) return null;
  if (m.index >= openEnd) return null;
  if (re.lastIndex > openEnd) return null;
  const quoteOpen = xml.indexOf('"', m.index);
  return { valueStart: quoteOpen + 1, valueEnd: quoteOpen + 1 + m[1]!.length };
}

/** The raw quoted slice, or `""` if any level of it is missing. */
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

/** Invalid element or attr names are a no-op rather than an error. */
export function setMjAttribute(
  headRawXml: string,
  element: string,
  attr: string,
  value: string
): string {
  if (!ELEMENT_NAME_RE.test(element)) return headRawXml;
  if (!ATTR_NAME_RE.test(attr)) return headRawXml;

  const escaped = escapeAttr(value);

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

  const elem = locateTag(headRawXml, element, mjAttrs.innerStart);
  if (!elem || elem.tagOpenStart >= mjAttrs.innerEnd) {
    return (
      headRawXml.slice(0, mjAttrs.innerStart) +
      `<${element} ${attr}="${escaped}" />` +
      headRawXml.slice(mjAttrs.innerStart)
    );
  }

  const found = findAttr(headRawXml, attr, elem.tagOpenStart, elem.openEnd);
  if (found) {
    return (
      headRawXml.slice(0, found.valueStart) +
      escaped +
      headRawXml.slice(found.valueEnd)
    );
  }

  // Padded so the emitted tag stays `<x foo="v" />`, not `<x foo="v"/>`.
  const insertAt = elem.isSelfClose ? elem.openEnd - 2 : elem.openEnd - 1;
  const before = headRawXml[insertAt - 1] ?? "";
  const leadingSpace =
    before === " " || before === "\t" || before === "\n" ? "" : " ";
  const trailing = elem.isSelfClose ? " " : "";
  return (
    headRawXml.slice(0, insertAt) +
    `${leadingSpace}${attr}="${escaped}"${trailing}` +
    headRawXml.slice(insertAt)
  );
}

/** Leaves the element behind even once it is attribute-less. */
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

  // Takes the preceding whitespace too, and is bounded to the open tag so it
  // cannot chew into inner text.
  const re = new RegExp(`(\\s+)${escapeRe(attr)}\\s*=\\s*"[^"]*"`, "g");
  re.lastIndex = elem.tagOpenStart;
  const m = re.exec(headRawXml);
  if (!m) return headRawXml;
  if (re.lastIndex > elem.openEnd) return headRawXml;
  return headRawXml.slice(0, m.index) + headRawXml.slice(re.lastIndex);
}
