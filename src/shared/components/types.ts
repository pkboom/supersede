/**
 * Templates do not store component content. They store a reference:
 *
 *     <mj-component component-id="shoe-brand/primary-button" revision="4" />
 *
 * Content lives once, in immutable revisions; expansion happens at render and
 * export only. Propagation is therefore a revision bump — one attribute value
 * per referencing template and nothing else.
 *
 * Treat that blast radius as an invariant, not a happy property. If a change
 * makes propagation rewrite more than the pin, it has removed the reason this
 * model was chosen over copying content into each template.
 */

/** Depth cap for components referencing other components. */
export const MAX_EXPANSION_DEPTH = 5;

/**
 * The depth cap bounds recursion but not fan-out: a component referencing the
 * next one N times expands to N^5 within it. 8 MiB is far above any real email
 * and far below anything that threatens the process.
 */
export const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;

/** The reference tag. Fixed shape, always self-closing. */
export const COMPONENT_TAG = "mj-component";

/** `ov-<attr>` — sets an attribute on the component's root element. */
export const OVERRIDE_PREFIX = "ov-";

/** `ov-slot-<name>` — replaces the text of the element marked `data-slot`. */
export const SLOT_PREFIX = "ov-slot-";

/**
 * `ov-at-<path>-<attr>` — sets an attribute on a node below the root, by index
 * path: `ov-at-0.2-href` targets the third element child of the first.
 *
 * Measured over 39 real templates, composite shapes carry nearly all their
 * variance below the root (a product card: mean 14.2 differing attributes,
 * 100% of them below root), which root-only overrides cannot express at all.
 * Without this, `detach` becomes the routine path rather than an escape hatch.
 */
export const PATH_PREFIX = "ov-at-";

/**
 * `ov-tag-<path>` — the tag the path is expected to resolve to. Required
 * alongside every `ov-at-` override, not optional.
 *
 * An index path is positional and the thing it indexes is designed to change.
 * If a later revision reorders the interior, the path silently resolves to a
 * different element, and mjml drops an unknown attribute on the wrong node
 * without an error — so every template that bumped its pin renders HTTP 200
 * with its link gone. An optional guard on a silent-corruption path is not a
 * guard.
 *
 * It does not catch two same-tag siblings swapping places; declared slots are
 * the answer to that. It converts the dominant failure from silent-wrong-node
 * into a loud throw, and claims no more.
 */
export const TAG_ASSERT_PREFIX = "ov-tag-";

/** Marks a component body node as a named text slot. */
export const SLOT_ATTR = "data-slot";

/**
 * Revisions are never edited in place: publishing produces a new one and
 * existing templates keep pointing at the old until their pin is bumped. That
 * is what makes propagation an explicit act rather than a side effect of
 * editing.
 */
export interface ComponentRevision {
  /** A slug, not a UUID, e.g. "shoe-brand/primary-button". */
  componentId: string;
  /** Monotonic, starting at 1. */
  revision: number;
  /**
   * MJML source with EXACTLY ONE root element. That invariant keeps stored and
   * expanded index paths 1:1, so a stored path is literally the same path in
   * the expanded tree and resolution is "walk up to the instance root".
   */
  body: string;
  /** For humans; never used for identity. */
  label?: string;
  publishedAt: Date;
}

/**
 * Not a boolean, because detect-and-report is mandatory: an instance buried
 * inside an opaque construct must be reported as such, never silently skipped.
 */
export type InstanceStatus = "reachable" | "opaque";

export interface ComponentInstance {
  componentId: string;
  revision: number;
  /** Byte range of the `<mj-component/>` tag in the scanned source. */
  start: number;
  end: number;
  /** `ov-*` attributes, prefix still attached, in source order. */
  overrides: Map<string, string>;
  status: InstanceStatus;
  /** Which construct buried it, so the report can say more than a count. */
  opaqueReason?: string;
}

/**
 * Provenance for one substituted region.
 *
 * This exists only inside the expander at the moment of substitution and is
 * unrecoverable from the expanded string afterwards — you cannot reconstruct
 * "this `<mj-text>` came from the footer's headline slot" after the fact.
 */
export interface ExpansionRegion {
  /** Byte range in the EXPANDED MJML. */
  start: number;
  end: number;
  componentId: string;
  revision: number;
  /**
   * The `<mj-component/>` node's ancestry, outermost first, each element
   * `componentId@revision#siblingIndex`. Components nest, so one expanded path
   * can sit inside several regions; the chain is what makes "which component
   * did I click" answerable. The sibling index is load-bearing — without it,
   * two instances of the same component produce identical chains.
   */
  instancePath: string[];
  /**
   * `ov-*` key -> the inner path it binds to. Keyed by the ov-key rather than
   * the path because every root override targets the same path (`""`), so a
   * path-keyed map would keep only the last of them. A consumer wanting
   * path -> keys must build the reverse index, which is a multimap.
   */
  overridable: Map<string, string>;
  /**
   * The range this region occupies in the expanded tree. Always `[n, n]` under
   * the single-root invariant, and kept as a range anyway: as a scalar,
   * relaxing single-root later becomes a breaking change to a boundary with
   * two implementations.
   */
  expandedPathRange: [number, number];
}

export interface ExpansionResult {
  mjml: string;
  regions: ExpansionRegion[];
}

export class ExpansionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpansionError";
  }
}

/**
 * Its own type because it is the worst failure in the system and callers may
 * want to distinguish it: mjml drops an unknown `<mj-component/>` under soft
 * validation and returns HTTP 200 with the content silently gone. One missed
 * expansion is a footerless email to a client's list with no signal anywhere.
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

export interface ComponentStore {
  get(componentId: string, revision: number): ComponentRevision | undefined;
  latest(componentId: string): ComponentRevision | undefined;
  list(): ComponentRevision[];
}
