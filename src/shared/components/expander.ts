/**
 * componentExpander — substitute `<mj-component/>` references with the content
 * of the revision they pin, applying per-instance `ov-*` overrides, and return
 * PROVENANCE alongside the MJML (plan §8, §11 D-2).
 *
 * WHY IT RETURNS REGIONS AND NOT A STRING
 * ---------------------------------------
 * An earlier spec had this returning MJML. The overlay needs, for every stamped
 * path in the expanded tree: which stored `<mj-component/>` node it came from,
 * which instance, and which `ov-*` key an inner node binds to. **That
 * information exists only here, at the moment of substitution, and is
 * unrecoverable from the expanded string afterwards.** You cannot reconstruct
 * "this `<mj-text>` came from the footer component's headline slot" after the
 * fact. The expander already computes all of it; it just has to stop throwing
 * it away. Free to decide now, expensive once callers exist.
 *
 * THE GUARD IS THE POINT
 * ----------------------
 * `expand()` throws if any `<mj-component` survives to its exit. The guard
 * lives HERE, at the expander's exit, and not in `render.ts`, so that every
 * present and future caller inherits it rather than each one remembering.
 *
 * The failure it prevents is the worst one in the system and it is silent:
 * mjml drops an unregistered `<mj-component/>` under `validationLevel: "soft"`
 * and returns **HTTP 200 with the content simply gone**. The diagnostic lands
 * in `result.errors`, which `render.ts` reaches by type assertion and never
 * reads. One missed expansion is a footerless email to a client's list, with no
 * signal anywhere in the system.
 */
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
 * Survivor scan — deliberately INDEPENDENT of the substitution scanner.
 *
 * The guard previously called `findAllTags`, the same scanner `expandInto` uses
 * to find tags. That made it a tautology on the expander's own fixpoint:
 * anything `findTag` could see had already been substituted, and anything it
 * could NOT see was equally invisible to the guard. A reference with an
 * unterminated quote —
 *
 *     <mj-component component-id="a/b revision="1" />
 *
 * — was skipped by both, and the "single most important failure in the system"
 * sailed through to mjml, HTTP 200, content silently gone.
 *
 * So this scan is maximally permissive: it looks only for the literal tag
 * opening with a name-boundary check, and cares nothing for well-formedness.
 * It must never become "smarter" — its whole value is failing in a different
 * direction from the scanner it checks.
 */
function findSurvivors(src: string, comments: Range[]): number[] {
  const out: number[] = [];
  const needle = `<${COMPONENT_TAG}`;
  let at = src.indexOf(needle);

  while (at !== -1) {
    const after = src[at + needle.length];
    const isTagStart = after === undefined || !/[\w-]/.test(after);

    // A commented-out reference loses no content — mjml never renders it — so
    // it is not a survivor. This is the guard's ONE exclusion, and it is safe
    // to share `commentRanges` with the substitution scanner because that
    // function is total: it returns unambiguous ranges or throws. The
    // independence that matters is over tag WELL-FORMEDNESS, where this scan
    // remains deliberately more permissive than `findTag`.
    if (isTagStart && !isInRanges(comments, at)) out.push(at);
    at = src.indexOf(needle, at + 1);
  }
  return out;
}

/**
 * Index of the element starting at `offset` among its PARENT's element children.
 *
 * This is the number `expandedPathRange` needs, and it is computable from the
 * stored source precisely because of the single-root invariant: one reference
 * substitutes to exactly one node, so a reference's sibling index in the stored
 * tree IS its sibling index in the expanded tree. That equivalence is the whole
 * reason the invariant is enforced at publish time.
 *
 * An earlier version used a counter over `<mj-component/>` tags instead, which
 * is only correct when every sibling happens to be a reference — the shape the
 * one test covering it used. In `<mj-text/><mj-component/>` it reported 0 for a
 * node that is sibling 1.
 */
function siblingIndexOf(
  source: string,
  offset: number,
  comments: Range[]
): number {
  // Counts of element children seen so far at each open depth.
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

    if (source.startsWith("</", lt)) {
      const gt = source.indexOf(">", lt);
      counts.pop();
      // The element that just closed counts as one child of its parent.
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
      // Malformed tag: cannot classify. Stop here rather than guess — the
      // survivor guard reports the real problem.
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

/**
 * Apply `ov-*` overrides to a component body.
 *
 * Two forms, both scoped to flat, root-level targets by design:
 *   - `ov-<attr>`        -> set `<attr>` on the body's ROOT element
 *   - `ov-slot-<name>`   -> replace the text content of the element carrying
 *                           `data-slot="<name>"`
 *
 * Below-root attribute targeting is deliberately OUT of scope. That is a real
 * limitation, not an oversight: a footer rooted at `mj-section` can have its
 * background overridden but not its unsubscribe link. §11 experiment (b) sizes
 * whether that limitation is survivable, and it has not been run — see the
 * caller-facing note in `expand()`.
 *
 * Returns the rewritten body plus the inner-path -> ov-key bindings the overlay
 * needs.
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

  for (const [key, value] of overrides) {
    // `ov-tag-` must be tested BEFORE `ov-` or it falls through to the root
    // branch and quietly becomes a root attribute named `tag-2`.
    if (key.startsWith(TAG_ASSERT_PREFIX)) {
      const pathStr = key.slice(TAG_ASSERT_PREFIX.length);
      if (!/^\d+(\.\d+)*$/.test(pathStr)) {
        throw new ExpansionError(
          `Malformed tag assertion "${key}" on "${componentId}": expected ${TAG_ASSERT_PREFIX}<path>, e.g. ${TAG_ASSERT_PREFIX}0.2`
        );
      }
      if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(value)) {
        throw new ExpansionError(
          `Invalid tag name "${value}" in "${key}" on "${componentId}": expected an element name, e.g. mj-button`
        );
      }
      tagAsserts.set(pathStr, value);
    } else if (key.startsWith(PATH_PREFIX)) {
      // `ov-at-<path>-<attr>`; the path is digits and dots, so the FIRST `-`
      // after it separates path from attribute name. That keeps attribute
      // names containing dashes (background-color) unambiguous.
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

  // --- root attribute overrides ---
  if (attrOverrides.size > 0) {
    const root = readRootTag(out);
    if (!root) {
      throw new ExpansionError(
        `Component "${componentId}" body has no root element to apply overrides to`
      );
    }
    const attrs: ScannedAttr[] = [...root.attrs];
    for (const [name, value] of attrOverrides) {
      const existing = attrs.findIndex((a) => a.name === name);
      if (existing >= 0) {
        // Update in place so the source attribute ORDER is preserved — the same
        // insertion-order invariant the block parser maintains.
        attrs[existing] = { name, value };
      } else {
        attrs.push({ name, value });
      }
      // Key by the ov-key: every root override targets the same path, so a
      // path-keyed map would keep only the last one.
      overridable.set(`${OVERRIDE_PREFIX}${name}`, "");
    }
    out =
      out.slice(0, root.start) +
      renderOpenTag(root.name, attrs, root.selfClosing) +
      out.slice(root.end);
  }

  // --- below-root attribute overrides, by index path ---
  //
  // Applied DEEPEST-FIRST so that rewriting one element's open tag cannot
  // invalidate the offsets of another override still to be applied. Rewriting
  // a shallower element first would shift every offset inside it.
  // Every path override MUST carry a tag assertion, and every assertion must
  // belong to one. The first rule is what makes the guard a guard; the second
  // catches a stale or mistyped assertion, which would otherwise sit in the
  // template looking like protection it is not providing.
  for (const pathStr of pathOverrides.keys()) {
    if (!tagAsserts.has(pathStr)) {
      throw new ExpansionError(
        `Path override ${PATH_PREFIX}${pathStr}-* on "${componentId}" has no ${TAG_ASSERT_PREFIX}${pathStr} assertion. ` +
          `An index path is positional and the component's interior can be rearranged by a later revision, ` +
          `so the expected tag is required, e.g. ${TAG_ASSERT_PREFIX}${pathStr}="mj-button".`
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

  const paths = [...pathOverrides.keys()].sort(
    (a, b) => b.split(".").length - a.split(".").length || b.localeCompare(a)
  );
  for (const pathStr of paths) {
    // Paths are relative to the ROOT'S CHILDREN, which is the natural reading
    // of "below the root": `ov-at-2-href` targets the root's third element
    // child. The single-root invariant makes the root itself index 0 at
    // document level, so prepending 0 turns a root-relative path into an
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
    const attrs: ScannedAttr[] = [...target.attrs];
    for (const [name, value] of pathOverrides.get(pathStr)!) {
      const existing = attrs.findIndex((a) => a.name === name);
      if (existing >= 0) attrs[existing] = { name, value };
      else attrs.push({ name, value });
      overridable.set(`${PATH_PREFIX}${pathStr}-${name}`, pathStr);
    }
    out =
      out.slice(0, target.start) +
      renderOpenTag(target.name, attrs, target.selfClosing) +
      out.slice(target.end);
  }

  // --- named slot text overrides ---
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
 * Replace the TEXT content of the element carrying `data-slot="<name>"`.
 *
 * Returns null when no such element exists, so the caller can raise an error
 * naming the component rather than silently producing an un-overridden body.
 *
 * Three things this has to get right, each of which it previously did not:
 *
 *  - **It must be text.** Replacing everything between the open and close tags
 *    deletes element children, so a slot on a container silently destroyed its
 *    subtree. A slot element containing elements is now rejected rather than
 *    emptied.
 *  - **The close tag must be the MATCHING one**, not the first one with that
 *    name — same-name nesting corrupted the body otherwise.
 *  - **The value is escaped.** It is interpolated into element content, so an
 *    unescaped value can close the slot and open new elements:
 *    `ov-slot-x="</mj-text><mj-raw><script>…"` injected script into the
 *    delivered email. This is a one-way ingress escape (the value is not read
 *    back out as source), so it does not reintroduce the compounding problem
 *    §0.2 fixed.
 */
function replaceSlotText(
  body: string,
  slotName: string,
  value: string
): { body: string; path: string } | null {
  // Find the slot as an ATTRIBUTE, not as a substring: a plain indexOf also
  // matches inside text content and inside other attributes' values.
  let cursor = 0;
  let tag: ScannedTag | null = null;

  while (cursor < body.length) {
    const lt = body.indexOf("<", cursor);
    if (lt === -1) break;
    const m = /^<\s*([A-Za-z][\w-]*)/.exec(body.slice(lt));
    if (!m) {
      cursor = lt + 1;
      continue;
    }
    let candidate: ScannedTag | null;
    try {
      candidate = findTag(body, m[1]!, lt);
    } catch {
      return null; // malformed body; the survivor guard reports the real issue
    }
    if (!candidate || candidate.start !== lt) {
      cursor = lt + 1;
      continue;
    }
    const slot = candidate.attrs.find((a) => a.name === SLOT_ATTR);
    if (slot?.value === slotName) {
      tag = candidate;
      break;
    }
    cursor = candidate.end;
  }

  if (!tag) return null;

  if (tag.selfClosing) {
    // A self-closing slot element has no text content to replace. Converting it
    // to a paired element would silently change the document shape, so refuse.
    return null;
  }

  const end = findElementEnd(body, tag);
  if (end === null) return null;
  const close = body.lastIndexOf(`</`, end);
  if (close === -1 || close < tag.end) return null;

  const inner = body.slice(tag.end, close);
  if (/<\s*[A-Za-z]/.test(inner)) {
    // Element children present: this is not a text slot. Emptying it would
    // silently delete the subtree.
    return null;
  }

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
   * Override the pinned revision per component. This is how a dry-run diff is
   * produced: `expand(t, store)` vs `expand(t, store, { pins: {id: next} })`.
   * Both sides are pure functions of stored data, so the diff is real
   * before/after MJML rather than the string "revision 4 -> 5".
   */
  pins?: Record<string, number>;
}

/**
 * Expand every component reference in `source`.
 *
 * Note on the override model's known limit, surfaced here because this is where
 * an implementer will look: `ov-*` reaches the component ROOT and named text
 * slots only. If real templates need to override things BELOW the root (a
 * nested CTA's `href`, an unsubscribe link inside a footer), flat `ov-*` cannot
 * express it and `detach` becomes the routine path rather than an escape hatch.
 * §11 experiment (b) measures exactly that and HAS NOT BEEN RUN — it needs ten
 * real agency templates. Until it has, treat the override surface as provisional.
 */
export function expand(
  source: string,
  store: ComponentStore,
  opts: ExpandOptions = {}
): ExpansionResult {
  const regions: ExpansionRegion[] = [];
  const pins = opts.pins ?? {};

  // Scan comments ONCE for the whole expansion. Every `findTag` call takes the
  // result, so the document is not rescanned per reference — doing that made
  // expansion ~4x slower on a 200-reference document, in the /api/render path
  // that the preview pane hits on a 200ms keystroke debounce.
  const scan = scanComments(source);

  // An unterminated comment is only a problem if it could HIDE a reference —
  // that is, if a reference sits at or after it. Throwing whenever the document
  // merely CONTAINS the tag anywhere rejected templates whose references all
  // precede the stray `<!--`, and even ones where the tag name appears only
  // inside the comment text.
  if (scan.unterminatedAt !== undefined) {
    const hidden = source.indexOf(`<${COMPONENT_TAG}`, scan.unterminatedAt);
    if (hidden !== -1) throw new UnterminatedCommentError(scan.unterminatedAt);
  }

  const out = expandInto(source, store, pins, regions, [], 0, scan.ranges);

  // ---- throw-on-survivor: the guard, at the expander's exit ----
  // Re-scan the OUTPUT: substitution changes the text, so the input's comment
  // ranges do not describe it.
  const survivors = findSurvivors(out, scanComments(out).ranges);
  if (survivors.length > 0) {
    const detail = survivors
      .map((at) => `offset ${at}: ${out.slice(at, at + 60)}`)
      .join(" | ");
    throw new UnexpandedReferenceError(
      `${survivors.length} unexpanded <${COMPONENT_TAG}/> reference(s) survived expansion: ${detail}. ` +
        `Refusing to return MJML that would compile to HTTP 200 with the content silently missing.`,
      survivors.map((at) => out.slice(at, at + 60))
    );
  }

  return { mjml: out, regions };
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

  // Rebuild left-to-right so recorded offsets are offsets into the OUTPUT,
  // which is what the overlay join needs. Right-to-left splicing (as
  // stampPaths does) would keep input offsets valid but leave every recorded
  // region pointing into a string the caller never sees.
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

    const { body, overridable } = applyOverrides(
      rev.body,
      overridesOf(tag),
      componentId
    );

    const siblingIdx = siblingIndexOf(source, tag.start, comments);
    // `id@revision#siblingIndex`. The sibling index is what makes two INSTANCES
    // of the same component distinguishable — without it, both entries in
    // `<mj-column><mj-component c/><mj-component c/></mj-column>` produced the
    // identical chain, and "which instance did I click" — the question this
    // field exists to answer — had no answer.
    const chain = [...ancestry, `${componentId}@${revision}#${siblingIdx}`];

    // Recurse BEFORE recording the region, so nested components are already
    // substituted and this region's byte range covers its final content.
    //
    // Nested regions come back with offsets relative to the COMPONENT BODY,
    // because the recursive call built its own output starting at 0. They must
    // be rebased into this level's coordinate space or they point into a string
    // no caller ever sees — the earlier version recorded them unrebased, so a
    // nested region's `start` equalled its parent's and `mjml.slice(start, end)`
    // did not contain the component.
    const nestedFrom = regions.length;
    // The body is a different string, so it needs its own comment ranges.
    //
    // Its `unterminatedAt` is checked too, and that is not redundant with the
    // publish-time check in `assertSingleRoot`: a ComponentStore is an
    // interface, and a body can reach here from an implementation that never
    // validated. This is the one failure the compiler-authority check in
    // render.ts cannot catch — the reference DID expand, so mjml reports
    // nothing, while the body's stray `<!--` silently truncates every template
    // that references it.
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

    // Width, not just depth. The depth cap alone bounds nothing useful: a chain
    // where each component references the next N times expands to N^5 — at N=40
    // that is ~10^8 nodes and the process dies with no diagnostic. Not reachable
    // today (component bodies are deployer-authored), but it must be in place
    // before a real store is wired into a route.
    if (out.length > MAX_EXPANDED_BYTES) {
      throw new ExpansionError(
        `Expansion exceeded ${MAX_EXPANDED_BYTES} bytes (chain: ${chain.join(" -> ")}). ` +
          `This usually means components fan out multiplicatively rather than ` +
          `recursing deeply, which the depth cap alone does not bound.`
      );
    }

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
      // Sibling index of this region's root among the top-level nodes THIS
      // call emits. Single-root invariant: one reference substitutes to exactly
      // one node, so the range is always [n, n]. Kept as a range on purpose —
      // see the note on ExpansionRegion.
      //
      // This counts EMITTED SIBLINGS, not references. An earlier version used a
      // counter over `<mj-component/>` tags alone, so in
      // `<mj-text/><mj-component/>` the component reported index 0 while it is
      // sibling 1 — breaking the path-to-path join the field exists to carry.
      expandedPathRange: [siblingIdx, siblingIdx],
    });

    cursor = tag.end;
  }

  out += source.slice(cursor);
  return out;
}
