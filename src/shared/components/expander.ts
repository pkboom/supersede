import {
  COMPONENT_TAG,
  MAX_EXPANDED_BYTES,
  MAX_EXPANSION_DEPTH,
  OVERRIDE_PREFIX,
  PATH_PREFIX,
  TAG_ASSERT_PREFIX,
  SLOT_ATTR,
  SLOT_PREFIX,
  ComponentNotFoundError,
  ExpansionError,
  UnexpandedReferenceError,
  type ComponentStore,
  type ExpansionRegion,
  type ExpansionResult,
} from "./types.js";
import {
  findElementAtPath,
  findElementEnd,
  findTag,
  isInRanges,
  readRootTag,
  scanComments,
  UnterminatedCommentError,
  type Range,
  renderOpenTag,
  type ScannedAttr,
  type ScannedTag,
} from "./tagScan.js";

/**
 * Deliberately independent of the substitution scanner, and deliberately
 * dumber: it looks only for the literal tag opening with a name check and
 * cares nothing for well-formedness. Sharing a scanner would make the guard a
 * tautology on the expander's own fixpoint — a reference with an unterminated
 * quote is invisible to `findTag`, so it would be invisible to the guard too.
 *
 * Never make this smarter. Its whole value is failing in a different direction
 * from the scanner it checks.
 */
function findSurvivors(src: string, comments: Range[]): number[] {
  const out: number[] = [];
  const needle = `<${COMPONENT_TAG}`;
  let at = src.indexOf(needle);

  while (at !== -1) {
    const after = src[at + needle.length];
    const isTagStart = after === undefined || !/[\w-]/.test(after);

    // A commented-out reference loses no content, so it is not a survivor.
    // The guard's one exclusion, and a safe one to share with the substitution
    // scanner: comment ranges are total, and the independence that matters is
    // over tag well-formedness.
    if (isTagStart && !isInRanges(comments, at)) out.push(at);
    at = src.indexOf(needle, at + 1);
  }
  return out;
}

/**
 * Index among the parent's ELEMENT children — not among references, which
 * would report 0 for the component in `<td></td><x-component/>`.
 *
 * Computable from the stored source only because of the single-root invariant:
 * one reference substitutes to exactly one node, so this index is the same in
 * both trees. That equivalence is why the invariant is enforced at publish.
 */
function siblingIndexOf(
  source: string,
  offset: number,
  comments: Range[]
): number {
  // Element children seen so far at each open depth.
  const counts: number[] = [0];
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1 || lt > offset) break;

    if (source.startsWith("<!--", lt)) {
      const close = source.indexOf("-->", lt);
      i = close === -1 ? source.length : close + 3;
      continue;
    }

    // The element that just closed counts as one child of its parent.
    if (source.startsWith("</", lt)) {
      const gt = source.indexOf(">", lt);
      counts.pop();
      counts[counts.length - 1] = (counts[counts.length - 1] ?? 0) + 1;
      i = gt === -1 ? source.length : gt + 1;
      continue;
    }

    const m = /^<\s*([A-Za-z][\w-]*)/.exec(source.slice(lt));
    if (!m) {
      i = lt + 1;
      continue;
    }

    let tag: ScannedTag | null;
    try {
      tag = findTag(source, m[1]!, lt, comments);
    } catch {
      // Cannot classify; the survivor guard reports the real problem.
      break;
    }
    if (!tag || tag.start !== lt) {
      i = lt + 1;
      continue;
    }

    if (tag.start === offset) return counts[counts.length - 1] ?? 0;

    if (tag.selfClosing) {
      counts[counts.length - 1] = (counts[counts.length - 1] ?? 0) + 1;
    } else {
      counts.push(0);
    }
    i = tag.end;
  }

  return counts[counts.length - 1] ?? 0;
}

/** Every open tag in document order. Throws wherever `findTag` throws. */
function* scanTags(src: string): Generator<ScannedTag> {
  let cursor = 0;
  while (cursor < src.length) {
    const lt = src.indexOf("<", cursor);
    if (lt === -1) return;
    const m = /^<\s*([A-Za-z][\w-]*)/.exec(src.slice(lt));
    const tag = m ? findTag(src, m[1]!, lt) : null;
    if (!tag || tag.start !== lt) {
      cursor = lt + 1;
      continue;
    }
    yield tag;
    cursor = tag.end;
  }
}

/** Re-emits `tag`'s open tag with `updates` merged in, in source order. */
function setAttrs(
  src: string,
  tag: ScannedTag,
  updates: Map<string, string>
): string {
  const attrs: ScannedAttr[] = [...tag.attrs];
  for (const [name, value] of updates) {
    const existing = attrs.findIndex((a) => a.name === name);
    if (existing >= 0) attrs[existing] = { name, value };
    else attrs.push({ name, value });
  }
  return (
    src.slice(0, tag.start) +
    renderOpenTag(tag.name, attrs, tag.selfClosing) +
    src.slice(tag.end)
  );
}

/**
 * Returns the rewritten body and the `ov-*` key -> inner path bindings. See
 * `types.ts` for the three override forms.
 */
function applyOverrides(
  body: string,
  overrides: Map<string, string>,
  componentId: string
): { body: string; overridable: Map<string, string> } {
  const overridable = new Map<string, string>();
  if (overrides.size === 0) return { body, overridable };

  const attrOverrides = new Map<string, string>();
  const slotOverrides = new Map<string, string>();
  /** path string -> (attr -> value) */
  const pathOverrides = new Map<string, Map<string, string>>();
  /** path string -> asserted tag name (see TAG_ASSERT_PREFIX) */
  const tagAsserts = new Map<string, string>();

  // Order matters: `ov-tag-` and `ov-at-` both start with `ov-`, and testing
  // the plain prefix first would turn them into root attributes.
  for (const [key, value] of overrides) {
    if (key.startsWith(TAG_ASSERT_PREFIX)) {
      const pathStr = key.slice(TAG_ASSERT_PREFIX.length);
      if (!/^\d+(\.\d+)*$/.test(pathStr)) {
        throw new ExpansionError(
          `Malformed tag assertion "${key}" on "${componentId}": expected ${TAG_ASSERT_PREFIX}<path>, e.g. ${TAG_ASSERT_PREFIX}0.2`
        );
      }
      if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(value)) {
        throw new ExpansionError(
          `Invalid tag name "${value}" in "${key}" on "${componentId}": expected an element name, e.g. a`
        );
      }
      tagAsserts.set(pathStr, value);
    } else if (key.startsWith(PATH_PREFIX)) {
      // The path is digits and dots, so the first `-` after it splits path from
      // attribute — which keeps dashed names like `background-color` unambiguous.
      const rest = key.slice(PATH_PREFIX.length);
      const dash = rest.indexOf("-");
      if (dash <= 0) {
        throw new ExpansionError(
          `Malformed path override "${key}" on "${componentId}": expected ${PATH_PREFIX}<path>-<attr>, e.g. ${PATH_PREFIX}0.2-href`
        );
      }
      const pathStr = rest.slice(0, dash);
      const attr = rest.slice(dash + 1);
      if (!/^\d+(\.\d+)*$/.test(pathStr)) {
        throw new ExpansionError(
          `Malformed path "${pathStr}" in override "${key}" on "${componentId}": expected dot-separated child indices, e.g. 0.2`
        );
      }
      if (!pathOverrides.has(pathStr)) pathOverrides.set(pathStr, new Map());
      pathOverrides.get(pathStr)!.set(attr, value);
    } else if (key.startsWith(SLOT_PREFIX)) {
      slotOverrides.set(key.slice(SLOT_PREFIX.length), value);
    } else if (key.startsWith(OVERRIDE_PREFIX)) {
      attrOverrides.set(key.slice(OVERRIDE_PREFIX.length), value);
    }
  }

  let out = body;

  if (attrOverrides.size > 0) {
    const root = readRootTag(out);
    if (!root) {
      throw new ExpansionError(
        `Component "${componentId}" body has no root element to apply overrides to`
      );
    }
    out = setAttrs(out, root, attrOverrides);
    for (const name of attrOverrides.keys()) {
      overridable.set(`${OVERRIDE_PREFIX}${name}`, "");
    }
  }

  // Every path override must carry a tag assertion, which is what makes the
  // guard a guard, and every assertion must belong to one — otherwise a stale
  // or mistyped assertion sits in the template looking like protection.
  for (const pathStr of pathOverrides.keys()) {
    if (!tagAsserts.has(pathStr)) {
      throw new ExpansionError(
        `Path override ${PATH_PREFIX}${pathStr}-* on "${componentId}" has no ${TAG_ASSERT_PREFIX}${pathStr} assertion. ` +
          `An index path is positional and the component's interior can be rearranged by a later revision, ` +
          `so the expected tag is required, e.g. ${TAG_ASSERT_PREFIX}${pathStr}="a".`
      );
    }
  }
  for (const pathStr of tagAsserts.keys()) {
    if (!pathOverrides.has(pathStr)) {
      throw new ExpansionError(
        `Tag assertion ${TAG_ASSERT_PREFIX}${pathStr} on "${componentId}" has no matching ${PATH_PREFIX}${pathStr}-* override`
      );
    }
  }

  // Deepest first, so rewriting one open tag cannot invalidate the offsets of
  // an override still to be applied.
  const paths = [...pathOverrides.keys()].sort(
    (a, b) => b.split(".").length - a.split(".").length || b.localeCompare(a)
  );
  for (const pathStr of paths) {
    // Paths are relative to the root's children. Single-root makes the root
    // itself index 0, so prepending 0 turns a root-relative path into an
    // absolute one without a second traversal mode.
    const indices = [0, ...pathStr.split(".").map(Number)];
    const target = findElementAtPath(out, indices);
    if (!target) {
      throw new ExpansionError(
        `Component "${componentId}" has no element at path ${pathStr} for override ${PATH_PREFIX}${pathStr}-*`
      );
    }
    const expectedTag = tagAsserts.get(pathStr)!;
    if (target.name !== expectedTag) {
      throw new ExpansionError(
        `Path ${pathStr} in "${componentId}" resolves to <${target.name}>, but the override asserts <${expectedTag}>. ` +
          `The component's interior has changed shape since this override was written — re-point it rather than removing the assertion.`
      );
    }
    const updates = pathOverrides.get(pathStr)!;
    out = setAttrs(out, target, updates);
    for (const name of updates.keys()) {
      overridable.set(`${PATH_PREFIX}${pathStr}-${name}`, pathStr);
    }
  }

  for (const [slotName, value] of slotOverrides) {
    const replaced = replaceSlotText(out, slotName, value);
    if (replaced === null) {
      throw new ExpansionError(
        `Component "${componentId}" has no element with ${SLOT_ATTR}="${slotName}" ` +
          `for override ${SLOT_PREFIX}${slotName}`
      );
    }
    out = replaced.body;
    overridable.set(`${SLOT_PREFIX}${slotName}`, replaced.path);
  }

  return { body: out, overridable };
}

/**
 * `data-slot` is authoring metadata for the stored body. It must not ship, and
 * leaving it in puts a marker the customer never typed into every file.
 *
 * Called unconditionally on the way out rather than from `replaceSlotText`: a
 * slot that is declared but never overridden never reaches that function, so a
 * fix confined to the override path would leak from exactly the templates that
 * customised nothing.
 *
 * Excises the attribute text rather than re-emitting through `renderOpenTag`,
 * which would normalise quote style and whitespace across every slot-bearing
 * element in a single-quoted or multi-line source file.
 */
function stripSlotMarkers(body: string): string {
  // Collected first and spliced from the end, so earlier offsets stay valid.
  const cuts: Array<{ start: number; end: number }> = [];

  try {
    for (const tag of scanTags(body)) {
      if (!tag.attrs.some((a) => a.name === SLOT_ATTR)) continue;
      // Anchored to a whitespace-preceded name, so `data-slot` inside another
      // attribute's value does not match.
      const re = /\s+data-slot\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/;
      const hit = re.exec(body.slice(tag.start, tag.end));
      if (hit) {
        cuts.push({
          start: tag.start + hit.index,
          end: tag.start + hit.index + hit[0].length,
        });
      }
    }
  } catch {
    // Malformed: leave it alone. The survivor guard reports the real problem
    // with better context than a cosmetic pass could.
    return body;
  }

  let out = body;
  for (let i = cuts.length - 1; i >= 0; i--) {
    out = out.slice(0, cuts[i]!.start) + out.slice(cuts[i]!.end);
  }
  return out;
}

/**
 * Replaces the TEXT content of the element marked `data-slot="<name>"`, and
 * returns null for anything else — including a slot element that contains
 * elements, since emptying it would silently delete a subtree.
 *
 * The value is interpolated into element content, so it must be escaped:
 * `ov-slot-x="</td><script>…"` would otherwise close the slot and
 * inject into the delivered email. Escaping here is one-way — the value is
 * never read back out as source — so it cannot compound.
 */
function replaceSlotText(
  body: string,
  slotName: string,
  value: string
): { body: string; path: string } | null {
  // Matched as an attribute, not a substring: a plain indexOf also hits text
  // content and other attributes' values.
  let tag: ScannedTag | null = null;
  try {
    for (const candidate of scanTags(body)) {
      const slot = candidate.attrs.find((a) => a.name === SLOT_ATTR);
      if (slot?.value === slotName) {
        tag = candidate;
        break;
      }
    }
  } catch {
    return null; // the survivor guard reports the real issue
  }

  if (!tag) return null;

  // Pairing up a self-closing slot would silently change the document shape.
  if (tag.selfClosing) return null;

  // The MATCHING close tag, not the first with that name.
  const end = findElementEnd(body, tag);
  if (end === null) return null;
  const close = body.lastIndexOf(`</`, end);
  if (close === -1 || close < tag.end) return null;

  const inner = body.slice(tag.end, close);
  if (/<\s*[A-Za-z]/.test(inner)) return null;

  const safe = value
    .replace(/&(?!(?:[A-Za-z][A-Za-z0-9]{1,31}|#\d{1,7}|#[xX][0-9A-Fa-f]{1,6});)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return {
    body: body.slice(0, tag.end) + safe + body.slice(close),
    path: `${tag.name}[${slotName}]`,
  };
}

/** Pull `ov-*` attributes off a reference tag, preserving source order. */
function overridesOf(tag: ScannedTag): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of tag.attrs) {
    if (a.name.startsWith(OVERRIDE_PREFIX)) out.set(a.name, a.value);
  }
  return out;
}

export interface ExpandOptions {
  /**
   * Overrides the pinned revision per component, which is how a dry run is
   * produced: `expand(t, store)` against `expand(t, store, { pins })` is a
   * real before/after HTML diff rather than the string "revision 4 -> 5".
   */
  pins?: Record<string, number>;
}

export function expand(
  source: string,
  store: ComponentStore,
  opts: ExpandOptions = {}
): ExpansionResult {
  const regions: ExpansionRegion[] = [];
  const pins = opts.pins ?? {};

  // Once for the whole expansion, and passed to every `findTag`: rescanning per
  // reference made a 200-reference document ~4x slower.
  const scan = scanComments(source);

  // Only a problem if it could HIDE a reference, i.e. one sits at or after it.
  if (scan.unterminatedAt !== undefined) {
    const hidden = source.indexOf(`<${COMPONENT_TAG}`, scan.unterminatedAt);
    if (hidden !== -1) throw new UnterminatedCommentError(scan.unterminatedAt);
  }

  const out = expandInto(source, store, pins, regions, [], 0, scan.ranges);

  // The output is rescanned: substitution changed the text, so the input's
  // comment ranges no longer describe it.
  const survivors = findSurvivors(out, scanComments(out).ranges);
  if (survivors.length > 0) {
    const detail = survivors
      .map((at) => `offset ${at}: ${out.slice(at, at + 60)}`)
      .join(" | ");
    throw new UnexpandedReferenceError(
      `${survivors.length} unexpanded <${COMPONENT_TAG}/> reference(s) survived expansion: ${detail}. ` +
        `Refusing to return HTML that would ship with the content silently missing.`,
      survivors.map((at) => out.slice(at, at + 60))
    );
  }

  return { html: out, regions };
}

function expandInto(
  source: string,
  store: ComponentStore,
  pins: Record<string, number>,
  regions: ExpansionRegion[],
  ancestry: string[],
  depth: number,
  comments: Range[]
): string {
  if (depth > MAX_EXPANSION_DEPTH) {
    throw new ExpansionError(
      `Component expansion exceeded the depth cap of ${MAX_EXPANSION_DEPTH} ` +
        `(chain: ${ancestry.join(" -> ")}). This usually means components reference each other in a cycle.`
    );
  }

  // Rebuilt left-to-right so recorded offsets index the OUTPUT. Right-to-left
  // splicing would keep input offsets valid and leave every recorded region
  // pointing into a string the caller never sees.
  let out = "";
  let cursor = 0;

  for (;;) {
    const tag = findTag(source, COMPONENT_TAG, cursor, comments);
    if (!tag) break;

    out += source.slice(cursor, tag.start);

    const componentId = tag.attrs.find((a) => a.name === "component-id")?.value;
    if (!componentId) {
      throw new ExpansionError(
        `<${COMPONENT_TAG}/> at offset ${tag.start} has no component-id`
      );
    }

    const pinned = pins[componentId];
    const revisionAttr = tag.attrs.find((a) => a.name === "revision")?.value;
    const revision =
      pinned ?? (revisionAttr === undefined ? NaN : Number(revisionAttr));
    if (!Number.isFinite(revision)) {
      throw new ExpansionError(
        `<${COMPONENT_TAG} component-id="${componentId}"/> has no usable revision ` +
          `(attribute was ${JSON.stringify(revisionAttr)})`
      );
    }

    const rev = store.get(componentId, revision);
    if (!rev) throw new ComponentNotFoundError(componentId, revision);

    const { body: overridden, overridable } = applyOverrides(
      rev.body,
      overridesOf(tag),
      componentId
    );
    // After overrides resolve, which still need the markers, and before regions
    // are recorded, so every offset indexes the bytes the caller receives.
    const body = stripSlotMarkers(overridden);

    const siblingIdx = siblingIndexOf(source, tag.start, comments);
    const chain = [...ancestry, `${componentId}@${revision}#${siblingIdx}`];

    // Recursion happens before the region is recorded, so this region's byte
    // range covers its final, fully-substituted content.
    const nestedFrom = regions.length;
    // A different string, so it needs its own comment ranges — and its own
    // unterminated check, which is not redundant with `assertSingleRoot`: a
    // ComponentStore is an interface, and a body can arrive from an
    // implementation that never validated.
    const bodyScan = scanComments(body);
    if (bodyScan.unterminatedAt !== undefined) {
      throw new UnterminatedCommentError(bodyScan.unterminatedAt);
    }

    const expandedBody = expandInto(
      body,
      store,
      pins,
      regions,
      chain,
      depth + 1,
      bodyScan.ranges
    );

    const start = out.length;
    out += expandedBody;
    const end = out.length;

    // Width, not just depth: a component referencing the next N times expands
    // to N^5, which at N=40 is ~10^8 nodes and a process death with no
    // diagnostic.
    if (out.length > MAX_EXPANDED_BYTES) {
      throw new ExpansionError(
        `Expansion exceeded ${MAX_EXPANDED_BYTES} bytes (chain: ${chain.join(" -> ")}). ` +
          `This usually means components fan out multiplicatively rather than ` +
          `recursing deeply, which the depth cap alone does not bound.`
      );
    }

    // Nested regions came back with offsets into the component body, since the
    // recursive call built its own output from 0.
    for (let i = nestedFrom; i < regions.length; i++) {
      const r = regions[i]!;
      r.start += start;
      r.end += start;
    }

    regions.push({
      start,
      end,
      componentId,
      revision,
      instancePath: chain,
      overridable,
      expandedPathRange: [siblingIdx, siblingIdx],
    });

    cursor = tag.end;
  }

  out += source.slice(cursor);
  return out;
}
