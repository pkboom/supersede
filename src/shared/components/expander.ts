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
  MAX_EXPANSION_DEPTH,
  OVERRIDE_PREFIX,
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
  findAllTags,
  findTag,
  readRootTag,
  renderOpenTag,
  type ScannedAttr,
  type ScannedTag,
} from "./tagScan.js";

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

  for (const [key, value] of overrides) {
    if (key.startsWith(SLOT_PREFIX)) {
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
      overridable.set("", `${OVERRIDE_PREFIX}${name}`);
    }
    out =
      out.slice(0, root.start) +
      renderOpenTag(root.name, attrs, root.selfClosing) +
      out.slice(root.end);
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
    overridable.set(replaced.path, `${SLOT_PREFIX}${slotName}`);
  }

  return { body: out, overridable };
}

/**
 * Replace the text content of the element carrying `data-slot="<name>"`.
 * Returns null when no such element exists, so the caller can raise an error
 * naming the component rather than silently producing an un-overridden body.
 */
function replaceSlotText(
  body: string,
  slotName: string,
  value: string
): { body: string; path: string } | null {
  const needle = `${SLOT_ATTR}="${slotName}"`;
  const at = body.indexOf(needle);
  if (at === -1) return null;

  // Walk back to the `<` that opens this element, then scan it quote-aware.
  const open = body.lastIndexOf("<", at);
  if (open === -1) return null;
  const nameMatch = /^<\s*([A-Za-z][\w-]*)/.exec(body.slice(open));
  if (!nameMatch) return null;
  const tag = findTag(body, nameMatch[1]!, open);
  if (!tag) return null;

  if (tag.selfClosing) {
    // A self-closing slot element has no text content to replace. Converting it
    // to a paired element would silently change the document shape, so refuse.
    return null;
  }

  const close = body.indexOf(`</${tag.name}`, tag.end);
  if (close === -1) return null;

  return {
    body: body.slice(0, tag.end) + value + body.slice(close),
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

  const out = expandInto(source, store, pins, regions, [], 0);

  // ---- throw-on-survivor: the guard, at the expander's exit ----
  const survivors = findAllTags(out, COMPONENT_TAG);
  if (survivors.length > 0) {
    const detail = survivors
      .map((t) => {
        const id =
          t.attrs.find((a) => a.name === "component-id")?.value ?? "(no id)";
        return `${id} at offset ${t.start}`;
      })
      .join(", ");
    throw new UnexpandedReferenceError(
      `${survivors.length} unexpanded <${COMPONENT_TAG}/> reference(s) survived expansion: ${detail}. ` +
        `Refusing to return MJML that would compile to HTTP 200 with the content silently missing.`,
      survivors.map(
        (t) => t.attrs.find((a) => a.name === "component-id")?.value ?? "(no id)"
      )
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
  depth: number
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
  let instanceIndex = 0;

  for (;;) {
    const tag = findTag(source, COMPONENT_TAG, cursor);
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

    const chain = [...ancestry, `${componentId}@${revision}`];

    // Recurse BEFORE recording the region, so nested components are already
    // substituted and this region's byte range covers its final content.
    const expandedBody = expandInto(
      body,
      store,
      pins,
      regions,
      chain,
      depth + 1
    );

    const start = out.length;
    out += expandedBody;
    const end = out.length;

    regions.push({
      start,
      end,
      componentId,
      revision,
      instancePath: chain,
      overridable,
      // Single-root invariant: one reference substitutes to exactly one
      // top-level node, so the range is always [n, n]. Kept as a range on
      // purpose — see the note on ExpansionRegion.
      expandedPathRange: [instanceIndex, instanceIndex],
    });

    instanceIndex++;
    cursor = tag.end;
  }

  out += source.slice(cursor);
  return out;
}
