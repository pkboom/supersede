/**
 * Slice edits to `<mj-title>` and `<mj-preview>` inside an `<mj-head>`
 * rawXml. Sliced rather than regex-replaced because the replacement is a
 * user-supplied value and `$1` / `\` in it would be interpreted.
 *
 * The first occurrence of a tag is edited; later duplicates are left alone. A
 * missing tag is inserted right after the `<mj-head>` open tag.
 */

/**
 * Escapes `&` unconditionally, so a value already holding `&amp;` becomes
 * `&amp;amp;`. That is the contract here — these helpers take plain text, not
 * source — and is the opposite of `serializer.ts`, which takes both.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Requires whitespace, `/` or `>` after the name, so `<mj-head-extra` misses. */
function findOpenTag(xml: string, tag: string): number {
  const re = new RegExp(`<${tag}(?=[\\s/>])`);
  const m = re.exec(xml);
  return m ? m.index : -1;
}

/** Inner-text range of the first `<{tag}>…</{tag}>`, or null if absent. */
function locateTag(
  xml: string,
  tag: string
): { innerStart: number; innerEnd: number } | null {
  const tagOpenStart = findOpenTag(xml, tag);
  if (tagOpenStart < 0) return null;
  // mj-title / mj-preview carry no attributes in practice, so a naive `>`
  // search is safe here and the worst case is degrading to not-found.
  const openEnd = xml.indexOf(">", tagOpenStart);
  if (openEnd < 0) return null;
  let scan = openEnd - 1;
  while (scan > tagOpenStart && /\s/.test(xml[scan]!)) scan--;
  if (scan > tagOpenStart && xml[scan] === "/") return null; // self-closing
  const innerStart = openEnd + 1;
  const innerEnd = xml.indexOf(`</${tag}>`, innerStart);
  if (innerEnd < 0) return null;
  return { innerStart, innerEnd };
}

function getInnerText(headRawXml: string, tag: string): string {
  const loc = locateTag(headRawXml, tag);
  if (!loc) return "";
  return headRawXml.slice(loc.innerStart, loc.innerEnd);
}

function setInnerText(headRawXml: string, tag: string, value: string): string {
  const escaped = escapeHtml(value);
  const loc = locateTag(headRawXml, tag);
  if (loc) {
    return (
      headRawXml.slice(0, loc.innerStart) +
      escaped +
      headRawXml.slice(loc.innerEnd)
    );
  }

  const headOpen = findOpenTag(headRawXml, "mj-head");
  const headOpenEnd =
    headOpen < 0 ? -1 : headRawXml.indexOf(">", headOpen);
  // Given a fragment rather than a head, wrap it.
  if (headOpenEnd < 0) {
    return `<mj-head><${tag}>${escaped}</${tag}></mj-head>`;
  }
  const insertAt = headOpenEnd + 1;
  return (
    headRawXml.slice(0, insertAt) +
    `<${tag}>${escaped}</${tag}>` +
    headRawXml.slice(insertAt)
  );
}

export function getTitle(headRawXml: string): string {
  return getInnerText(headRawXml, "mj-title");
}

export function setTitle(headRawXml: string, value: string): string {
  return setInnerText(headRawXml, "mj-title", value);
}

export function getPreheader(headRawXml: string): string {
  return getInnerText(headRawXml, "mj-preview");
}

export function setPreheader(headRawXml: string, value: string): string {
  return setInnerText(headRawXml, "mj-preview", value);
}
