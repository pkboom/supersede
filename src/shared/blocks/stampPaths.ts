/**
 * Inject `data-mjml-path="…"` onto the rendered HTML elements that each
 * modeled block produced, so a click in rendered output resolves back to a
 * node in the parsed tree.
 *
 * mjml wraps its email-client compatibility markup in `<!--[if mso | IE]>`
 * conditionals, and the first `<table>` of its body output sits inside one, so
 * comments are opaque here: neither depth counting nor detector matching ever
 * enters them.
 *
 * A block whose detector finds nothing is reported in `missing[]` rather than
 * mis-stamped.
 */
import { parseMjml } from "./parser.js";
import type { BlockNode, BlockType, TreeNode } from "./types.js";

export interface StampResult {
  html: string;
  stamped: number;
  /** Blocks that were stampable at all — passthroughs and comments are not. */
  expected: number;
  /** Path keys whose detector matched nothing. */
  missing: string[];
}

/**
 * Path keys are index paths joined by `/`: `"0/0/3"` is the fourth grandchild
 * of the first body child.
 */
interface PlanEntry {
  pathKey: string;
  type: BlockType;
  isContainer: boolean;
  /** Bounds this container's children within the flat plan. */
  childrenStart?: number;
  childrenEnd?: number;
}

interface CommentRange {
  start: number;
  /** Exclusive. */
  end: number;
}

interface OpenTagToken {
  /** Lowercased. */
  name: string;
  start: number;
  /** Just before the closing `>`; `data-mjml-path` is spliced in here. */
  insertAt: number;
  /** One past the closing `>`. */
  end: number;
  /** Raw attribute substring. */
  attrs: string;
  selfClosing: boolean;
}

/** Depth-first, containers before their children. */
function buildStampPlan(body: TreeNode[]): PlanEntry[] {
  const out: PlanEntry[] = [];

  function visit(nodes: TreeNode[], parentPath: string): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const pathKey = parentPath === "" ? String(i) : `${parentPath}/${i}`;
      if (node.type === "__unknown__") continue;
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

interface Tokens {
  openTags: OpenTagToken[];
  /** Sorted by `start`, so `isInsideComment` can stop early. */
  commentRanges: CommentRange[];
}

function tokenize(html: string): Tokens {
  const openTags: OpenTagToken[] = [];
  const commentRanges: CommentRange[] = [];
  const len = html.length;
  let i = 0;
  while (i < len) {
    const ch = html.charCodeAt(i);
    if (ch !== 0x3c /* '<' */) {
      i++;
      continue;
    }
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      if (end === -1) {
        commentRanges.push({ start: i, end: len });
        i = len;
        break;
      }
      commentRanges.push({ start: i, end: end + 3 });
      i = end + 3;
      continue;
    }
    // Close tags need no token — `findClosingOffset` scans the raw HTML.
    if (html.charCodeAt(i + 1) === 0x2f /* '/' */) {
      const gt = html.indexOf(">", i + 2);
      if (gt === -1) {
        i = len;
        break;
      }
      i = gt + 1;
      continue;
    }
    const c1 = html.charCodeAt(i + 1);
    const isLetter =
      (c1 >= 0x41 && c1 <= 0x5a) || (c1 >= 0x61 && c1 <= 0x7a);
    if (!isLetter) {
      i++;
      continue;
    }
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

function isInsideComment(ranges: CommentRange[], offset: number): boolean {
  for (const r of ranges) {
    if (offset >= r.start && offset < r.end) return true;
    if (r.start > offset) break;
  }
  return false;
}

/** Falls back to `html.length` when there is no close, so the range stays valid. */
function findClosingOffset(
  html: string,
  openTags: OpenTagToken[],
  commentRanges: CommentRange[],
  openIdx: number
): number {
  const tag = openTags[openIdx]!;
  if (tag.selfClosing) return tag.end;
  const name = tag.name;
  const closeMarker = `</${name}`;
  let depth = 1;
  let cursor = tag.end;
  while (cursor < html.length) {
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
  commentRanges: CommentRange[],
  name: string,
  fromOffset: number
): number {
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
  commentRanges: CommentRange[],
  closeMarker: string,
  fromOffset: number
): number {
  let cursor = fromOffset;
  while (cursor < html.length) {
    const idx = html.indexOf(closeMarker, cursor);
    if (idx === -1) return -1;
    if (!isInsideComment(commentRanges, idx)) {
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

// Detectors: does the open tag at this index have the shape mjml renders this
// block type as?

type TagDetector = (tag: OpenTagToken) => boolean;

/** Leaf and container shapes identified by what the element wraps. */
type SubtreeDetector = (
  tag: OpenTagToken,
  openTags: OpenTagToken[],
  selfIdx: number,
  commentRanges: CommentRange[],
  closeOffset: number
) => boolean;

function matchesSection(tag: OpenTagToken): boolean {
  if (tag.name !== "table") return false;
  if (!/\brole\s*=\s*["']presentation["']/.test(tag.attrs)) return false;
  return /\bstyle\s*=\s*["'][^"']*\bwidth\s*:\s*100%/i.test(tag.attrs);
}

function matchesColumn(tag: OpenTagToken): boolean {
  if (tag.name !== "div") return false;
  return /\bclass\s*=\s*["'][^"']*\bmj-column-/.test(tag.attrs);
}

/**
 * Horizontal mode only. In vertical mode each element is a `<tr>` that a flat
 * token matcher cannot pin down, so those fall through to `missing[]` and only
 * the parent mj-social stays addressable.
 */
function matchesSocialElement(tag: OpenTagToken): boolean {
  if (tag.name !== "table") return false;
  return /\bstyle\s*=\s*["'][^"']*\binline-table\b/i.test(tag.attrs);
}

/**
 * Opts a passthrough into stamping. Hand-authored unmodeled tags
 * (`<mj-wrapper>`, `<mj-include>`) don't carry it and stay unaddressable.
 */
const PASSTHROUGH_SENTINEL_RE = /\bdata-mjml-passthrough\s*=\s*["']true["']/i;

function matchesCustomPassthrough(tag: OpenTagToken): boolean {
  return PASSTHROUGH_SENTINEL_RE.test(tag.attrs);
}

/** The first non-comment open tag inside a `<td>` — what the leaf detectors key on. */
function firstTagInCell(
  tag: OpenTagToken,
  openTags: OpenTagToken[],
  selfIdx: number,
  commentRanges: CommentRange[],
  closeOffset: number
): OpenTagToken | null {
  if (tag.name !== "td") return null;
  const idx = nextOpenTagIdxWithin(openTags, commentRanges, selfIdx + 1, closeOffset);
  return idx === -1 ? null : openTags[idx]!;
}

function matchesImageLeaf(...args: Parameters<SubtreeDetector>): boolean {
  return firstTagInCell(...args)?.name === "img";
}

function matchesTextLeaf(...args: Parameters<SubtreeDetector>): boolean {
  const next = firstTagInCell(...args);
  if (next?.name !== "div") return false;
  return /\bstyle\s*=\s*["'][^"']*font-family/i.test(next.attrs);
}

/** A `<p>` with a `border-top` — the rule line. */
function matchesDividerLeaf(...args: Parameters<SubtreeDetector>): boolean {
  const next = firstTagInCell(...args);
  if (next?.name !== "p") return false;
  return /\bstyle\s*=\s*["'][^"']*\bborder-top\s*:/i.test(next.attrs);
}

/** A `<div>` with a height but no `font-family`, which is mj-text's signature. */
function matchesSpacerLeaf(...args: Parameters<SubtreeDetector>): boolean {
  const next = firstTagInCell(...args);
  if (next?.name !== "div") return false;
  if (!/\bstyle\s*=\s*["'][^"']*\bheight\s*:/i.test(next.attrs)) return false;
  return !/\bstyle\s*=\s*["'][^"']*font-family/i.test(next.attrs);
}

/**
 * A `<td>` wrapping a table that is either `inline-table` (horizontal mode) or
 * `margin:0px` (vertical). mj-section's table declares `width:100%` instead.
 */
function matchesSocialContainer(...args: Parameters<SubtreeDetector>): boolean {
  const next = firstTagInCell(...args);
  if (next?.name !== "table") return false;
  return /\bstyle\s*=\s*["'][^"']*(\binline-table\b|\bmargin\s*:\s*0px)/i.test(
    next.attrs
  );
}

/**
 * mjml emits `<a href>` for a non-empty href and `<p href>` otherwise; both are
 * unique to mj-button, since mj-text wraps in a font-family `<div>`. Searches
 * the whole subtree rather than the first child, which is a wrapper table.
 */
function matchesButtonLeaf(
  tag: OpenTagToken,
  openTags: OpenTagToken[],
  selfIdx: number,
  commentRanges: CommentRange[],
  closeOffset: number
): boolean {
  if (tag.name !== "td") return false;
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

const TAG_DETECTORS: Partial<Record<BlockType, TagDetector>> = {
  "mj-section": matchesSection,
  "mj-column": matchesColumn,
  "mj-social-element": matchesSocialElement,
  "mj-custom-passthrough": matchesCustomPassthrough,
};

const SUBTREE_DETECTORS: Partial<Record<BlockType, SubtreeDetector>> = {
  "mj-image": matchesImageLeaf,
  "mj-text": matchesTextLeaf,
  "mj-button": matchesButtonLeaf,
  "mj-divider": matchesDividerLeaf,
  "mj-spacer": matchesSpacerLeaf,
  "mj-social": matchesSocialContainer,
};

function nextOpenTagIdxWithin(
  openTags: OpenTagToken[],
  commentRanges: CommentRange[],
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

/** Inert for today's numeric path keys; here so a richer key stays safe. */
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

  const stamps: Array<{ insertAt: number; pathKey: string }> = [];
  const missing: string[] = [];

  /** Matches `plan[start..end)` against tokens before `untilOffset`. */
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
        // The anchor is lost, so the whole subtree is skipped rather than
        // matched against arbitrary tokens. The plan is depth-first and
        // contiguous, so this range is exactly the descendants.
        if (entry.isContainer && entry.childrenEnd !== undefined) {
          for (let k = entry.childrenStart!; k < entry.childrenEnd; k++) {
            missing.push(plan[k]!.pathKey);
          }
          pIdx = entry.childrenEnd;
        } else {
          pIdx += 1;
        }
        continue;
      }
      const tag = openTags[tokenIdx]!;
      stamps.push({ insertAt: tag.insertAt, pathKey: entry.pathKey });
      // Either way, advance past the close so a sibling cannot re-match tokens
      // from inside this element's own subtree.
      if (entry.isContainer && entry.childrenStart !== undefined) {
        const closeOffset = findClosingOffset(html, openTags, commentRanges, tokenIdx);
        matchRange(entry.childrenStart, entry.childrenEnd!, tokenIdx + 1, closeOffset);
        cursor = advancePastOffset(openTags, tokenIdx + 1, closeOffset);
        pIdx = entry.childrenEnd!;
      } else {
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
    const byTag = TAG_DETECTORS[entry.type];
    if (byTag) return byTag(tag);
    // A registry type with no detector yet lands in `missing[]` rather than
    // being stamped onto the wrong element.
    const bySubtree = SUBTREE_DETECTORS[entry.type];
    if (!bySubtree) return false;
    const close = findClosingOffset(html, openTags, commentRanges, tokenIdx);
    return bySubtree(tag, openTags, tokenIdx, commentRanges, close);
  }

  matchRange(0, plan.length, 0, html.length);

  // Right-to-left, so each splice leaves the earlier offsets valid.
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
