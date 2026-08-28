/**
 * stampMjmlPaths — re-parse the MJML source and inject `data-mjml-path="..."`
 * attributes onto the corresponding rendered HTML elements.
 *
 * **Scope.** This is the server-side path-parity stamper used by the canvas
 * overlay system (plan §2.2.1). The parser owns the path-determination logic;
 * we walk the parsed body in document order and, for each modeled block,
 * locate the matching rendered element via a per-block-type detector and
 * stamp it.
 *
 * **MSO-comment-aware.** mjml@^4.18.0 wraps emitted email-client compatibility
 * markup inside `<!--[if mso | IE]> ... <![endif]-->` blocks. The first
 * `<table>` in mjml's body output lives INSIDE one of those conditional
 * comments and MUST NOT be stamped as a section. Our HTML tokenizer treats
 * the entire comment span as opaque — depth counters and detector matching
 * never enter a comment.
 *
 * **Graceful skip.** If a parser node fails to match a rendered element
 * (mjml output drift, unmodeled construct), we push its pathKey into
 * `missing[]` and continue with the next node. The caller (`/api/render`)
 * logs a one-line `console.warn` once per cache miss when `stamped < expected`.
 *
 * **Right-to-left splicing.** We accumulate `(insertOffset, attrText)` tuples
 * during the matching pass, then apply them in descending offset order so
 * earlier offsets remain valid.
 *
 * **Path key format.** Index path joined by `/` — e.g. `"0"` for the first
 * body child, `"0/0"` for its first child, `"0/0/3"` for the fourth grandchild.
 * Matches `pathKey()` / `parsePathKey()` in `web/src/canvas/Canvas.tsx`.
 */
import { parseMjml } from "./parser.js";
import type { BlockNode, BlockType, TreeNode } from "./types.js";

export interface StampResult {
  /** The rendered HTML with `data-mjml-path` attributes injected. */
  html: string;
  /** How many parser blocks were successfully stamped. */
  stamped: number;
  /** How many parser blocks were stampable (not `__unknown__` / passthrough). */
  expected: number;
  /** PathKeys whose detector failed to find a matching rendered element. */
  missing: string[];
}

interface PlanEntry {
  pathKey: string;
  type: BlockType;
  /** Container path entries are emitted depth-first; their children follow. */
  isContainer: boolean;
  /** For leaves, no children; for containers, the index where children begin. */
  childrenStart?: number;
  /** For containers, the index AFTER their last child entry. */
  childrenEnd?: number;
}

interface OpenTagToken {
  /** Tag name, lowercased. */
  name: string;
  /** Byte offset of the leading `<`. */
  start: number;
  /**
   * Byte offset of the position just before the closing `>` (or `/>`).
   * `data-mjml-path="..."` is spliced in at this offset.
   */
  insertAt: number;
  /** Byte offset of the byte after the closing `>` (i.e. exclusive end of the open tag). */
  end: number;
  /** Raw attribute substring (between tag-name end and `insertAt`). */
  attrs: string;
  /** True if `<foo .../>`. */
  selfClosing: boolean;
}

/**
 * Walk the parser body in DFS order and produce a flat list of stampable
 * entries. Containers come BEFORE their children; the post-order range
 * (`childrenStart..childrenEnd`) bounds the children for matching.
 */
function buildStampPlan(body: TreeNode[]): PlanEntry[] {
  const out: PlanEntry[] = [];

  function visit(nodes: TreeNode[], parentPath: string): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const pathKey = parentPath === "" ? String(i) : `${parentPath}/${i}`;
      // Comments / stray text — never stampable.
      if (node.type === "__unknown__") continue;
      // Passthroughs are stampable only when their rawXml carries the canvas
      // sentinel `data-mjml-passthrough="true"`. Icon-rail-dropped Custom MJML
      // blocks emit the sentinel; hand-authored unmodeled tags
      // (`<mj-wrapper>`, `<mj-include>`, etc.) don't, and remain unstampable
      // — matching the long-standing "out of overlay scope" semantics.
      if (node.type === "mj-custom-passthrough") {
        if (!PASSTHROUGH_SENTINEL_RE.test(node.rawXml)) continue;
        out.push({
          pathKey,
          type: "mj-custom-passthrough",
          isContainer: false,
        });
        continue;
      }
      const block = node as BlockNode;
      const isContainer =
        block.type === "mj-section" ||
        block.type === "mj-column" ||
        block.type === "mj-social";
      const entry: PlanEntry = {
        pathKey,
        type: block.type,
        isContainer,
      };
      out.push(entry);
      if (isContainer && block.children) {
        const childrenStart = out.length;
        visit(block.children, pathKey);
        entry.childrenStart = childrenStart;
        entry.childrenEnd = out.length;
      }
    }
  }

  visit(body, "");
  return out;
}

/**
 * Tokenize HTML into a sequence of comment spans and tag open/close tokens.
 * Comments (including MSO conditionals like `<!--[if mso | IE]>...<![endif]-->`)
 * are treated as opaque ranges — depth counters never enter them.
 *
 * Returns parallel arrays describing each open-tag candidate, in source order.
 * `commentRanges` is sorted by `start`; we use a binary-search-friendly
 * "is offset inside a comment" predicate.
 */
interface Tokens {
  openTags: OpenTagToken[];
  /** Inclusive-start, exclusive-end ranges for `<!-- ... -->` spans. */
  commentRanges: Array<{ start: number; end: number }>;
}

function tokenize(html: string): Tokens {
  const openTags: OpenTagToken[] = [];
  const commentRanges: Array<{ start: number; end: number }> = [];
  const len = html.length;
  let i = 0;
  while (i < len) {
    const ch = html.charCodeAt(i);
    if (ch !== 0x3c /* '<' */) {
      i++;
      continue;
    }
    // Comment?
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      if (end === -1) {
        // Unterminated — bail out; treat the rest as opaque.
        commentRanges.push({ start: i, end: len });
        i = len;
        break;
      }
      commentRanges.push({ start: i, end: end + 3 });
      i = end + 3;
      continue;
    }
    // Closing tag `</...>` — we don't need a token for it (depth tracking is
    // handled by `findClosingOffset`); just skip past it.
    if (html.charCodeAt(i + 1) === 0x2f /* '/' */) {
      const gt = html.indexOf(">", i + 2);
      if (gt === -1) {
        i = len;
        break;
      }
      i = gt + 1;
      continue;
    }
    // Open tag — must start with `<` followed by a letter.
    const c1 = html.charCodeAt(i + 1);
    const isLetter =
      (c1 >= 0x41 && c1 <= 0x5a) || (c1 >= 0x61 && c1 <= 0x7a);
    if (!isLetter) {
      i++;
      continue;
    }
    // Read the tag name.
    let j = i + 1;
    while (j < len) {
      const cc = html.charCodeAt(j);
      const isNameChar =
        (cc >= 0x41 && cc <= 0x5a) ||
        (cc >= 0x61 && cc <= 0x7a) ||
        (cc >= 0x30 && cc <= 0x39) ||
        cc === 0x2d /* '-' */ ||
        cc === 0x5f /* '_' */;
      if (!isNameChar) break;
      j++;
    }
    const name = html.slice(i + 1, j).toLowerCase();
    // Walk forward through attrs to find the closing `>`, respecting quotes.
    let k = j;
    let inSingle = false;
    let inDouble = false;
    let endOfOpen = -1;
    let selfClosing = false;
    while (k < len) {
      const cc = html.charCodeAt(k);
      if (inSingle) {
        if (cc === 0x27 /* "'" */) inSingle = false;
      } else if (inDouble) {
        if (cc === 0x22 /* '"' */) inDouble = false;
      } else if (cc === 0x27) {
        inSingle = true;
      } else if (cc === 0x22) {
        inDouble = true;
      } else if (cc === 0x2f && html.charCodeAt(k + 1) === 0x3e /* '/>' */) {
        endOfOpen = k + 2;
        selfClosing = true;
        break;
      } else if (cc === 0x3e /* '>' */) {
        endOfOpen = k + 1;
        break;
      }
      k++;
    }
    if (endOfOpen === -1) {
      // Malformed — bail.
      i = len;
      break;
    }
    const insertAt = selfClosing ? endOfOpen - 2 : endOfOpen - 1;
    openTags.push({
      name,
      start: i,
      insertAt,
      end: endOfOpen,
      attrs: html.slice(j, insertAt),
      selfClosing,
    });
    i = endOfOpen;
  }
  return { openTags, commentRanges };
}

function isInsideComment(
  ranges: Array<{ start: number; end: number }>,
  offset: number
): boolean {
  // Linear scan is fine for our token volumes (~hundreds of comments at most).
  for (const r of ranges) {
    if (offset >= r.start && offset < r.end) return true;
    if (r.start > offset) break;
  }
  return false;
}

/**
 * Given an open-tag index, find the byte offset of the matching close tag's
 * `<`. Returns `html.length` (i.e. unbounded) when the tag is self-closing or
 * we can't find a close (graceful — caller still gets a valid range).
 *
 * Walks `openTags` (skipping ones inside comments), tracking depth on
 * same-named opens. We need a separate scan over the raw HTML for `</name>`
 * because close tags don't appear in `openTags`.
 */
function findClosingOffset(
  html: string,
  openTags: OpenTagToken[],
  commentRanges: Array<{ start: number; end: number }>,
  openIdx: number
): number {
  const tag = openTags[openIdx]!;
  if (tag.selfClosing) return tag.end;
  const name = tag.name;
  const closeMarker = `</${name}`;
  let depth = 1;
  let cursor = tag.end;
  // Pre-build the index of subsequent same-named opens (skipping comments).
  while (cursor < html.length) {
    // Skip comments.
    let inCmt: { start: number; end: number } | null = null;
    for (const r of commentRanges) {
      if (cursor >= r.start && cursor < r.end) {
        inCmt = r;
        break;
      }
      if (r.start > cursor) break;
    }
    if (inCmt) {
      cursor = inCmt.end;
      continue;
    }
    const nextOpen = findNextSameNameOpen(openTags, commentRanges, name, cursor);
    const nextClose = findNextCloseRaw(html, commentRanges, closeMarker, cursor);
    if (nextClose === -1) return html.length;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      cursor = nextOpen + 1;
      continue;
    }
    depth--;
    if (depth === 0) {
      return nextClose;
    }
    cursor = nextClose + closeMarker.length;
  }
  return html.length;
}

function findNextSameNameOpen(
  openTags: OpenTagToken[],
  commentRanges: Array<{ start: number; end: number }>,
  name: string,
  fromOffset: number
): number {
  // Linear walk — token volumes are modest; we don't bother with binary search.
  for (let i = 0; i < openTags.length; i++) {
    const t = openTags[i]!;
    if (t.start < fromOffset) continue;
    if (t.name !== name) continue;
    if (isInsideComment(commentRanges, t.start)) continue;
    return t.start;
  }
  return -1;
}

function findNextCloseRaw(
  html: string,
  commentRanges: Array<{ start: number; end: number }>,
  closeMarker: string,
  fromOffset: number
): number {
  let cursor = fromOffset;
  while (cursor < html.length) {
    const idx = html.indexOf(closeMarker, cursor);
    if (idx === -1) return -1;
    if (!isInsideComment(commentRanges, idx)) {
      // Verify it's a real close (followed by `>` or whitespace+`>`).
      const after = html.charCodeAt(idx + closeMarker.length);
      const isSep =
        after === 0x3e /* '>' */ ||
        after === 0x20 ||
        after === 0x09 ||
        after === 0x0a ||
        after === 0x0d;
      if (isSep) return idx;
    }
    cursor = idx + closeMarker.length;
  }
  return -1;
}

/**
 * Per-block-type detectors. Each returns true iff the open tag at the given
 * candidate index matches the parser block's expected rendered shape. The
 * `lookahead` callbacks let leaf detectors peek at the next non-comment open
 * tag inside the same `<td>` subtree.
 */
function matchesSection(tag: OpenTagToken): boolean {
  if (tag.name !== "table") return false;
  if (!/\brole\s*=\s*["']presentation["']/.test(tag.attrs)) return false;
  if (!/\bstyle\s*=\s*["'][^"']*\bwidth\s*:\s*100%/i.test(tag.attrs)) return false;
  return true;
}

function matchesColumn(tag: OpenTagToken): boolean {
  if (tag.name !== "div") return false;
  return /\bclass\s*=\s*["'][^"']*\bmj-column-/.test(tag.attrs);
}

function matchesImageLeaf(
  tag: OpenTagToken,
  openTags: OpenTagToken[],
  selfIdx: number,
  commentRanges: Array<{ start: number; end: number }>,
  closeOffset: number
): boolean {
  if (tag.name !== "td") return false;
  // Find the next non-comment open tag whose start is between this td's open-end
  // and the matching `</td>`. Must be `<img>`.
  const nextIdx = nextOpenTagIdxWithin(openTags, commentRanges, selfIdx + 1, closeOffset);
  if (nextIdx === -1) return false;
  return openTags[nextIdx]!.name === "img";
}

function matchesTextLeaf(
  tag: OpenTagToken,
  openTags: OpenTagToken[],
  selfIdx: number,
  commentRanges: Array<{ start: number; end: number }>,
  closeOffset: number
): boolean {
  if (tag.name !== "td") return false;
  const nextIdx = nextOpenTagIdxWithin(openTags, commentRanges, selfIdx + 1, closeOffset);
  if (nextIdx === -1) return false;
  const next = openTags[nextIdx]!;
  if (next.name !== "div") return false;
  return /\bstyle\s*=\s*["'][^"']*font-family/i.test(next.attrs);
}

function matchesButtonLeaf(
  tag: OpenTagToken,
  openTags: OpenTagToken[],
  selfIdx: number,
  commentRanges: Array<{ start: number; end: number }>,
  closeOffset: number
): boolean {
  if (tag.name !== "td") return false;
  // The td's subtree must contain the button's text-bearing element. MJML
  // emits `<a href="...">` when `href` is non-empty, but falls back to
  // `<p href="...">` (sic — the empty-string href is preserved as an
  // attribute) when `href=""` or unset. Accept either; both are unique to
  // mj-button output (mj-text wraps in a `<div>` with `font-family` style).
  for (let i = selfIdx + 1; i < openTags.length; i++) {
    const t = openTags[i]!;
    if (t.start >= closeOffset) break;
    if (isInsideComment(commentRanges, t.start)) continue;
    if ((t.name === "a" || t.name === "p") && /\bhref\s*=/.test(t.attrs)) {
      return true;
    }
  }
  return false;
}

/**
 * mj-divider renders as a `<td>` containing a `<p>` with a `border-top`
 * inline style — that's the rule line. Distinct from mj-text (whose
 * inner is `<div style="font-family:...">`) and mj-button (`<a href>` /
 * `<p href>`).
 */
function matchesDividerLeaf(
  tag: OpenTagToken,
  openTags: OpenTagToken[],
  selfIdx: number,
  commentRanges: Array<{ start: number; end: number }>,
  closeOffset: number
): boolean {
  if (tag.name !== "td") return false;
  const nextIdx = nextOpenTagIdxWithin(
    openTags,
    commentRanges,
    selfIdx + 1,
    closeOffset
  );
  if (nextIdx === -1) return false;
  const next = openTags[nextIdx]!;
  if (next.name !== "p") return false;
  return /\bstyle\s*=\s*["'][^"']*\bborder-top\s*:/i.test(next.attrs);
}

/**
 * mj-spacer renders as a `<td>` containing a `<div>` whose inline style
 * has `height:` + `line-height:` and crucially NO `font-family:`
 * (which is mj-text's signature). Inner content is a zero-width space.
 */
function matchesSpacerLeaf(
  tag: OpenTagToken,
  openTags: OpenTagToken[],
  selfIdx: number,
  commentRanges: Array<{ start: number; end: number }>,
  closeOffset: number
): boolean {
  if (tag.name !== "td") return false;
  const nextIdx = nextOpenTagIdxWithin(
    openTags,
    commentRanges,
    selfIdx + 1,
    closeOffset
  );
  if (nextIdx === -1) return false;
  const next = openTags[nextIdx]!;
  if (next.name !== "div") return false;
  if (!/\bstyle\s*=\s*["'][^"']*\bheight\s*:/i.test(next.attrs)) return false;
  // Reject mj-text's inner div, which always carries font-family.
  if (/\bstyle\s*=\s*["'][^"']*font-family/i.test(next.attrs)) return false;
  return true;
}

/**
 * mj-social (the container) renders as a `<td>` whose first inner non-comment
 * tag is a presentation `<table>`:
 *   - `mode="horizontal"` (default): each child mj-social-element is a sibling
 *     `<table style="...display:inline-table">`, so the FIRST inner table also
 *     carries `inline-table`.
 *   - `mode="vertical"`: there is a single wrapper `<table style="margin:0px">`
 *     containing one `<tr>` per child element.
 * mj-section also emits a presentation table but its style declares
 * `width:100%`, which is mutually exclusive with both shapes above.
 */
function matchesSocialContainer(
  tag: OpenTagToken,
  openTags: OpenTagToken[],
  selfIdx: number,
  commentRanges: Array<{ start: number; end: number }>,
  closeOffset: number
): boolean {
  if (tag.name !== "td") return false;
  const nextIdx = nextOpenTagIdxWithin(
    openTags,
    commentRanges,
    selfIdx + 1,
    closeOffset
  );
  if (nextIdx === -1) return false;
  const next = openTags[nextIdx]!;
  if (next.name !== "table") return false;
  return /\bstyle\s*=\s*["'][^"']*(\binline-table\b|\bmargin\s*:\s*0px)/i.test(
    next.attrs
  );
}

/**
 * mj-social-element renders as a `<table style="...display:inline-table">` in
 * the default `horizontal` mode (one such table per child element, all sharing
 * a parent `<td>`). In `vertical` mode each element is a `<tr>` inside the
 * mj-social wrapper table — a flat token-matcher cannot pin those down without
 * a parent-aware search, so vertical-mode elements gracefully fall through to
 * `missing[]` and the canvas overlay simply lacks per-element handles for that
 * mode (the parent mj-social is still selectable). Acceptable trade-off: the
 * registry default is `horizontal` and that path is fully stamped.
 */
function matchesSocialElement(tag: OpenTagToken): boolean {
  if (tag.name !== "table") return false;
  return /\bstyle\s*=\s*["'][^"']*\binline-table\b/i.test(tag.attrs);
}

/**
 * Sentinel attribute the canvas-side seed for the Custom MJML drop bakes
 * into its `<mj-raw>` wrapper. Stamping a passthrough is the difference
 * between an editable, click-selectable block and one the user can only
 * reach via auto-select-on-drop. Authored MJML that doesn't carry this
 * attribute is intentionally unmatched (see `buildStampPlan`).
 */
const PASSTHROUGH_SENTINEL_RE = /\bdata-mjml-passthrough\s*=\s*["']true["']/i;

function matchesCustomPassthrough(tag: OpenTagToken): boolean {
  return PASSTHROUGH_SENTINEL_RE.test(tag.attrs);
}

function nextOpenTagIdxWithin(
  openTags: OpenTagToken[],
  commentRanges: Array<{ start: number; end: number }>,
  fromIdx: number,
  closeOffset: number
): number {
  for (let i = fromIdx; i < openTags.length; i++) {
    const t = openTags[i]!;
    if (t.start >= closeOffset) return -1;
    if (isInsideComment(commentRanges, t.start)) continue;
    return i;
  }
  return -1;
}

/**
 * HTML attribute escape. Currently inert for `"0/0/1"`-shaped pathKeys, but
 * mandatory per plan §2.2.1 step 5 / R9a so a future fallback (content-hash,
 * etc.) is automatically safe.
 */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function stampMjmlPaths(source: string, html: string): StampResult {
  const doc = parseMjml(source);
  const plan = buildStampPlan(doc.body);
  const expected = plan.length;

  if (expected === 0) {
    return { html, stamped: 0, expected: 0, missing: [] };
  }

  const { openTags, commentRanges } = tokenize(html);

  // Pre-compute "next non-comment open tag index whose offset is >= X" via a
  // simple linear cursor — token counts are modest (~50 for starter).
  const stamps: Array<{ insertAt: number; pathKey: string }> = [];
  const missing: string[] = [];

  /**
   * Match a contiguous slice `plan[start..end)` of stamp-plan entries against
   * tokens within `[fromOffset, untilOffset)`. Returns the cursor (token
   * index) one past the last stamped entry.
   *
   * Container entries recurse into their children's plan range.
   */
  function matchRange(
    start: number,
    end: number,
    fromTokenIdx: number,
    untilOffset: number
  ): number {
    let cursor = fromTokenIdx;
    let pIdx = start;
    while (pIdx < end) {
      const entry = plan[pIdx]!;
      const tokenIdx = findMatch(entry, cursor, untilOffset);
      if (tokenIdx === -1) {
        missing.push(entry.pathKey);
        // Skip the entire subtree (don't try to match this container's children
        // against arbitrary tokens — we lost our anchor).
        if (entry.isContainer && entry.childrenEnd !== undefined) {
          for (let k = entry.childrenStart!; k < entry.childrenEnd; k++) {
            const child = plan[k]!;
            // Only push leaf misses to keep the missing list focused; container
            // subtrees that fully fail will already be listed with their root.
            // But to keep parity with the simple semantics promised in the
            // plan, we push every skipped node.
            missing.push(child.pathKey);
            if (child.isContainer && child.childrenEnd !== undefined) {
              // Continue iterating; the loop covers all descendants because
              // `buildStampPlan` emits depth-first contiguously.
            }
          }
          pIdx = entry.childrenEnd;
        } else {
          pIdx += 1;
        }
        continue;
      }
      const tag = openTags[tokenIdx]!;
      stamps.push({ insertAt: tag.insertAt, pathKey: entry.pathKey });
      if (entry.isContainer && entry.childrenStart !== undefined) {
        const closeOffset = findClosingOffset(html, openTags, commentRanges, tokenIdx);
        // Recurse into children, scanning tokens AFTER this open tag and
        // before this container's close.
        matchRange(entry.childrenStart, entry.childrenEnd!, tokenIdx + 1, closeOffset);
        // Advance past the container's close.
        cursor = advancePastOffset(openTags, tokenIdx + 1, closeOffset);
        pIdx = entry.childrenEnd!;
      } else {
        // Leaf: advance past the matching close so siblings don't re-match
        // tokens inside this leaf's subtree (e.g. button leaf wraps an inner
        // `<table>` — we don't want a sibling section detector to hit it,
        // though that detector would already filter on style="width:100%").
        const closeOffset = findClosingOffset(html, openTags, commentRanges, tokenIdx);
        cursor = advancePastOffset(openTags, tokenIdx + 1, closeOffset);
        pIdx += 1;
      }
    }
    return cursor;

    function findMatch(
      entry: PlanEntry,
      fromIdx: number,
      withinOffset: number
    ): number {
      for (let i = fromIdx; i < openTags.length; i++) {
        const tag = openTags[i]!;
        if (tag.start >= withinOffset) return -1;
        if (isInsideComment(commentRanges, tag.start)) continue;
        if (matchesEntry(entry, i)) return i;
      }
      return -1;
    }
  }

  function matchesEntry(entry: PlanEntry, tokenIdx: number): boolean {
    const tag = openTags[tokenIdx]!;
    switch (entry.type) {
      case "mj-section":
        return matchesSection(tag);
      case "mj-column":
        return matchesColumn(tag);
      case "mj-image": {
        const close = findClosingOffset(html, openTags, commentRanges, tokenIdx);
        return matchesImageLeaf(tag, openTags, tokenIdx, commentRanges, close);
      }
      case "mj-text": {
        const close = findClosingOffset(html, openTags, commentRanges, tokenIdx);
        return matchesTextLeaf(tag, openTags, tokenIdx, commentRanges, close);
      }
      case "mj-button": {
        const close = findClosingOffset(html, openTags, commentRanges, tokenIdx);
        return matchesButtonLeaf(tag, openTags, tokenIdx, commentRanges, close);
      }
      case "mj-divider": {
        const close = findClosingOffset(html, openTags, commentRanges, tokenIdx);
        return matchesDividerLeaf(tag, openTags, tokenIdx, commentRanges, close);
      }
      case "mj-spacer": {
        const close = findClosingOffset(html, openTags, commentRanges, tokenIdx);
        return matchesSpacerLeaf(tag, openTags, tokenIdx, commentRanges, close);
      }
      case "mj-social": {
        const close = findClosingOffset(html, openTags, commentRanges, tokenIdx);
        return matchesSocialContainer(
          tag,
          openTags,
          tokenIdx,
          commentRanges,
          close
        );
      }
      case "mj-social-element":
        return matchesSocialElement(tag);
      case "mj-custom-passthrough":
        return matchesCustomPassthrough(tag);
      default:
        // Unmodeled leaves (e.g. future block types added to the registry
        // before stampPaths catches up) fall through and get pushed to
        // `missing[]` for the caller to log.
        return false;
    }
  }

  matchRange(0, plan.length, 0, html.length);

  // Apply stamps right-to-left so earlier offsets remain valid.
  stamps.sort((a, b) => b.insertAt - a.insertAt);
  let stampedHtml = html;
  for (const s of stamps) {
    const insertion = ` data-mjml-path="${escapeAttr(s.pathKey)}"`;
    stampedHtml =
      stampedHtml.slice(0, s.insertAt) + insertion + stampedHtml.slice(s.insertAt);
  }

  return {
    html: stampedHtml,
    stamped: stamps.length,
    expected,
    missing,
  };
}

function advancePastOffset(
  openTags: OpenTagToken[],
  fromIdx: number,
  offset: number
): number {
  for (let i = fromIdx; i < openTags.length; i++) {
    if (openTags[i]!.start >= offset) return i;
  }
  return openTags.length;
}
