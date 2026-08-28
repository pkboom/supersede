/**
 * indexOf-based slice editor for `<mj-title>` and `<mj-preview>` inside
 * `<mj-head>`'s `rawXml`. Used by the right-panel "Settings" tab to update
 * subject (mj-preview) and title (mj-title) without round-tripping through
 * a regex (Architect Q2 rejected regex-on-value due to metacharacter risk
 * with `$1`, `\\`, `<`, `>` in user-provided values).
 *
 * Behavior:
 *  - `getTitle` / `getPreheader`: find the first occurrence of the tag,
 *    return the inner text (NOT html-decoded — caller takes the raw slice).
 *    Returns `""` if the tag is missing.
 *  - `setTitle` / `setPreheader`: if the tag exists, slice-replace its
 *    inner text with `escapeHtml(value)`. If the tag is missing, INSERT
 *    `<mj-title>{escaped}</mj-title>` (or `<mj-preview>...`) immediately
 *    after the `<mj-head>` open tag. Edits the FIRST occurrence; leaves
 *    subsequent duplicates untouched.
 *  - `escapeHtml(s)`: escapes `&`, `<`, `>` (in that order — `&` first to
 *    avoid double-escape). Quotes are NOT escaped — these tags have plain
 *    text content, not attribute values.
 *
 * **Synthetic mj-head injection encoding** (per plan Step 6 R9-prime,
 * lines 265-269):
 *  - When the parser produces an `MjmlDocument` with NO `head` field and
 *    the user calls `setTitle("X")` / `setPreheader("Y")`, the right-panel
 *    code (Lane F) is responsible for materializing a head on the doc:
 *        doc.head = {
 *          rawXml: "<mj-head><mj-title>X</mj-title></mj-head>",
 *          __synthetic: true,
 *        };
 *    The `__synthetic: true` sentinel lives on the `MjmlDocument.head`
 *    object (see `types.ts`). The serializer (Lane B owns
 *    `serializer.ts`) MUST emit a head iff `doc.head` exists, regardless
 *    of `__synthetic`. The sentinel field is a tree-internal flag and
 *    MUST be stripped from the serialized MJML output (i.e. the
 *    serializer never writes `__synthetic="true"` to disk).
 *
 *    Why sentinel-on-NODE rather than a stateful flag passed to
 *    `serializeMjml`: the tree IS the source of truth; a stateful
 *    serialize-time flag would couple the serializer to call-site context
 *    and break round-trip composition (`serialize(parse(serialize(t)))`
 *    would forget the synthetic intent).
 *
 *    The helpers below operate on `headRawXml: string` only — they do
 *    NOT mutate `MjmlDocument`. The synthetic-head materialization
 *    (creating the `head` field with `__synthetic: true` when absent) is
 *    the right-panel code's responsibility — it calls these helpers on
 *    a freshly-built `<mj-head></mj-head>` rawXml string.
 *
 * Synthetic-head emission is automatic: serializer emits doc.head.rawXml
 * whenever doc.head !== undefined; the __synthetic boolean field is a
 * wrapper-object property never written to MJML output.
 */

/**
 * HTML-escape `&`, `<`, `>` for plain-text content of `<mj-title>` /
 * `<mj-preview>`. Order matters: `&` first so subsequent `<` / `>`
 * replacements don't double-escape an existing `&amp;`.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Find the open-tag start of `<{tag}` in `xml`, requiring that the next
 * char after the tag name be whitespace, `/`, or `>`. This avoids matching
 * `<mj-head` against `<mj-head-extra` etc. The `tag` argument is a
 * hardcoded literal (`"mj-head"`, `"mj-title"`, `"mj-preview"`) at every
 * call site — never user-controlled — so this regex is safe.
 */
function findOpenTag(xml: string, tag: string): number {
  // tag is a hardcoded literal, no escaping needed.
  const re = new RegExp(`<${tag}(?=[\\s/>])`);
  const m = re.exec(xml);
  return m ? m.index : -1;
}

/**
 * Find the inner-text byte range of the first `<{tag}>...</{tag}>` in
 * `xml`. Returns `null` if the tag is missing or malformed.
 *
 * Returned indices: `innerStart` is the offset just AFTER `>` of the
 * open tag; `innerEnd` is the offset of the `<` of the close tag.
 * `tagOpenStart` is the offset of `<` of the open tag (used to insert
 * AFTER the open tag if a different mode wants that).
 */
function locateTag(
  xml: string,
  tag: string
): { tagOpenStart: number; innerStart: number; innerEnd: number } | null {
  const closeMarker = `</${tag}>`;
  const tagOpenStart = findOpenTag(xml, tag);
  if (tagOpenStart < 0) return null;
  // Find `>` that terminates this open tag. We don't allow `>` inside
  // attribute values for mj-title/mj-preview (their tags carry no
  // attributes in practice, and the worst case here is graceful
  // degrade-to-not-found).
  const openEnd = xml.indexOf(">", tagOpenStart);
  if (openEnd < 0) return null;
  // Self-closing `<mj-title />` — scan back over whitespace before
  // checking for `/`. Catches `<mj-title />`, `<mj-title  />`, etc.
  let scan = openEnd - 1;
  while (scan > tagOpenStart && /\s/.test(xml[scan]!)) scan--;
  if (scan > tagOpenStart && xml[scan] === "/") {
    return null;
  }
  const innerStart = openEnd + 1;
  const innerEnd = xml.indexOf(closeMarker, innerStart);
  if (innerEnd < 0) return null;
  return { tagOpenStart, innerStart, innerEnd };
}

function getInnerText(headRawXml: string, tag: string): string {
  const loc = locateTag(headRawXml, tag);
  if (!loc) return "";
  return headRawXml.slice(loc.innerStart, loc.innerEnd);
}

function setInnerText(
  headRawXml: string,
  tag: string,
  value: string
): string {
  const escaped = escapeHtml(value);
  const loc = locateTag(headRawXml, tag);
  if (loc) {
    return (
      headRawXml.slice(0, loc.innerStart) +
      escaped +
      headRawXml.slice(loc.innerEnd)
    );
  }
  // Tag missing — INSERT immediately after the `<mj-head>` open tag.
  // Tolerates whitespace inside `<mj-head ...>` by anchoring on the first
  // `>` after the open marker. Use the anchored matcher so we don't
  // accidentally match `<mj-head-extra`-style siblings.
  const headOpen = findOpenTag(headRawXml, "mj-head");
  if (headOpen < 0) {
    // No `<mj-head>` tag at all — wrap the value in a new head. (This
    // path is taken when the right-panel code passes us a raw fragment
    // rather than a head string. The synthetic-head materializer in the
    // store wraps with `<mj-head>...</mj-head>` already, so this is a
    // defensive fallback.)
    return `<mj-head><${tag}>${escaped}</${tag}></mj-head>`;
  }
  const headOpenEnd = headRawXml.indexOf(">", headOpen);
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
