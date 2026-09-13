/**
 * Component design-system types — the REFERENCE model (plan §11, D-2).
 *
 * Templates do not store component content. They store a reference:
 *
 *     <mj-component component-id="shoe-brand/primary-button" revision="4" />
 *
 * Content lives once, in immutable revisions. Expansion is server-side and
 * happens at render/export only. Propagation is a revision bump — one attribute
 * value in each referencing template, and nothing else.
 *
 * **Treat the one-attribute blast radius as an invariant, not a happy
 * property** (D-2). If a change ever makes propagation rewrite more than the
 * pin, it has removed the reason this model was chosen over copy.
 */

/** Depth cap for components referencing other components. */
export const MAX_EXPANSION_DEPTH = 5;

/**
 * Output cap for one expansion.
 *
 * The depth cap bounds recursion but NOT fan-out: a chain where each component
 * references the next N times expands to N^5 within the depth limit. 8 MiB is
 * far above any real email (the largest sane MJML template is low tens of KB)
 * and far below anything that threatens the process.
 */
export const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;

/** The reference tag name. Fixed shape, always self-closing. */
export const COMPONENT_TAG = "mj-component";

/** Attribute prefix for per-instance overrides. */
export const OVERRIDE_PREFIX = "ov-";

/** Override prefix that targets a named slot's TEXT content rather than an attr. */
export const SLOT_PREFIX = "ov-slot-";

/**
 * Override prefix that targets an attribute on a node BELOW the component root,
 * by index path: `ov-at-0.2-href="..."` sets `href` on the third element child
 * of the first element child.
 *
 * **Added because the measurement said root-only was not enough.** §11 scoped
 * `ov-*` to flat root-level targets and predicted the failure — "a product card
 * can have its padding but not its CTA" — but left it out of scope. Running
 * experiment (b) over 39 real templates showed that prediction is what actually
 * happens, and that it gets worse the more a shape resembles a real component:
 *
 *     mj-column[mj-image,mj-text,mj-button]  n=10  mean=14.20  below-root=100%
 *     mj-column[mj-text,mj-text,mj-button]   n= 8  mean= 9.12  below-root= 97%
 *     mj-section[mj-column,mj-column]        n=46  mean= 6.83  below-root= 82%
 *
 * Leaf shapes are trivially 0% below-root and stay low. The composite shapes —
 * a product card, a CTA block, a footer — carry nearly all their variance below
 * the root, which flat overrides cannot express at all. Without this, `detach`
 * becomes the routine path rather than an escape hatch: the copy model reached
 * by attrition, through a one-way door.
 *
 * This stays inside the reference model. An override is still a literal
 * attribute that propagation never touches, there is still no merge, no base
 * and no conflict — the blast radius of a revision bump is still one attribute
 * value per template.
 */
export const PATH_PREFIX = "ov-at-";

/**
 * Required companion to every `ov-at-` override: the tag the path is expected
 * to resolve to. `ov-at-2-href="..."` must be accompanied by
 * `ov-tag-2="mj-button"`, and expansion throws if the element at path `2` is
 * not an `mj-button`.
 *
 * **WHY THIS IS REQUIRED RATHER THAN OPTIONAL.** An index path is positional,
 * and the thing it indexes into is a component revision that is *designed to
 * change*. If r5 reorders the component's interior, `ov-at-2-href` silently
 * resolves to a DIFFERENT element. Under mjml's soft validation an unknown
 * attribute on the wrong node is dropped without an error, so every template
 * that bumped its pin loses its link and still renders HTTP 200 — the exact
 * silent post-re-pin drift the reference model was chosen to eliminate,
 * re-entering through the override mechanism. An optional guard on a
 * silent-corruption path is not a guard; it is documentation.
 *
 * **What this does NOT catch, stated plainly:** two siblings with the SAME tag
 * swapping places. `ov-at-2-href` asserted as `mj-button` still applies to the
 * wrong button. Declared slots are the real answer to that (§11); this converts
 * the dominant failure from silent-wrong-node into a loud throw, and does not
 * claim to close the class.
 */
export const TAG_ASSERT_PREFIX = "ov-tag-";

/** Attribute on a component body node marking it as a named text slot. */
export const SLOT_ATTR = "data-slot";

/**
 * One immutable published revision of a component.
 *
 * Revisions are never edited in place. Publishing produces a new revision with
 * a higher number; existing templates keep pointing at the old one until their
 * pin is bumped. That is what makes propagation an explicit, reviewable act
 * rather than an ambient side effect of editing.
 */
export interface ComponentRevision {
  /** Human-readable slug, e.g. "shoe-brand/primary-button" (D-2: slug, not UUID). */
  componentId: string;
  /** Monotonic, starting at 1. */
  revision: number;
  /**
   * The component body as MJML source — EXACTLY ONE root element.
   *
   * The single-root invariant is load-bearing: it makes stored and expanded
   * index paths 1:1, so a stored path is literally the same path in the
   * expanded tree and overlay resolution is "walk up until you hit an instance
   * root" — no search, no fuzzy matching, auditable by inspection.
   */
  body: string;
  /** Freeform label for humans; never used for identity. */
  label?: string;
  publishedAt: Date;
}

/**
 * A resolved component reference found in a template.
 *
 * `status` is deliberately not a boolean: detect-and-report for unreachable
 * instances is MANDATORY and PERMANENT (plan §10.1). An instance buried inside
 * an opaque construct (`mj-wrapper`, rich `mj-text`, `mj-hero`, …) must be
 * reported as `opaque`, never silently skipped — "cannot propagate" is an
 * honest answer and a silent skip is not.
 */
export type InstanceStatus = "reachable" | "opaque";

export interface ComponentInstance {
  componentId: string;
  revision: number;
  /** Byte range of the `<mj-component/>` tag in the source being scanned. */
  start: number;
  end: number;
  /** `ov-*` attributes, with the prefix still attached, in source order. */
  overrides: Map<string, string>;
  status: InstanceStatus;
  /**
   * Why this instance is unreachable, when `status === "opaque"`. Present so
   * the report can say *which* construct buried it rather than just a count.
   */
  opaqueReason?: string;
}

/**
 * Provenance for one substituted region of the expanded MJML.
 *
 * **This information exists only inside the expander at the moment of
 * substitution and is unrecoverable from the expanded string afterwards.** You
 * cannot reconstruct "this `<mj-text>` came from the footer component's
 * headline slot" after the fact. The expander already computes all of it; the
 * only requirement is that it stop throwing it away.
 */
export interface ExpansionRegion {
  /** Byte range in the EXPANDED MJML. Server-side only — never sent to a browser. */
  start: number;
  end: number;
  componentId: string;
  revision: number;
  /**
   * Index path of the `<mj-component/>` node in the STORED tree.
   *
   * **A chain, not a string** — components nest (depth cap 5), so one expanded
   * path can sit inside several regions at once. Click inside a footer that
   * contains a button component: the chain says footer THEN button, outermost
   * first, so "which component did I click" has a defined answer.
   *
   * Each element is `componentId@revision#siblingIndex`. The sibling index is
   * load-bearing, not decoration: without it two INSTANCES of the same
   * component in one template produce identical chains, and the question this
   * field exists to answer becomes unanswerable.
   */
  instancePath: string[];
  /**
   * `ov-*` key -> the inner path (relative to the region root) it binds to.
   *
   * **Keyed by the ov-key, not by the path** — a deliberate inversion of the
   * shape first sketched for this field. Every root attribute override targets
   * the SAME inner path (the root, `""`), so a path-keyed map silently collapses
   * N root overrides into one: `ov-color`, `ov-background-color` and
   * `ov-padding` all write key `""` and only the last survives. The ov-key is
   * unique by construction, so this direction is lossless.
   *
   * Consumers wanting path -> keys should build the reverse index, which is
   * a multimap — that asymmetry is the point.
   */
  overridable: Map<string, string>;
  /**
   * Index-path range this region occupies in the expanded tree.
   *
   * **Keep this a range even though the single-root invariant makes it always
   * `[n, n]`.** Someone will notice the two numbers are always equal and
   * propose a scalar. Refuse: as a scalar, relaxing single-root later becomes a
   * breaking change to a boundary with two implementations; as a range it
   * degrades to bookkeeping. This is exactly the kind of invariant traded away
   * by someone optimising elsewhere, and the overlay breaks first.
   */
  expandedPathRange: [number, number];
}

export interface ExpansionResult {
  mjml: string;
  regions: ExpansionRegion[];
}

/** Raised when expansion cannot complete. Never swallowed — see the guard note. */
export class ExpansionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpansionError";
  }
}

/**
 * Raised by the throw-on-survivor guard at the expander's exit.
 *
 * Separate from ExpansionError because it is the single most important failure
 * in the system and callers may want to distinguish it: mjml drops an unknown
 * `<mj-component/>` under soft validation and returns **HTTP 200 with the
 * content silently gone**. The warning lands in `result.errors`, which
 * `render.ts` reaches by type assertion and never reads. One missed expansion
 * is a footerless email to a client's list with no signal anywhere.
 */
export class UnexpandedReferenceError extends ExpansionError {
  constructor(
    message: string,
    readonly survivors: string[]
  ) {
    super(message);
    this.name = "UnexpandedReferenceError";
  }
}

export class ComponentNotFoundError extends ExpansionError {
  constructor(componentId: string, revision: number) {
    super(`No revision ${revision} of component "${componentId}"`);
    this.name = "ComponentNotFoundError";
  }
}

/** Read side of the component store. */
export interface ComponentStore {
  get(componentId: string, revision: number): ComponentRevision | undefined;
  latest(componentId: string): ComponentRevision | undefined;
  list(): ComponentRevision[];
}
