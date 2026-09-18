/** Depth cap for components referencing other components. */
export const MAX_EXPANSION_DEPTH = 5;
/**
 * The depth cap bounds recursion but not fan-out: a component referencing the
 * next one N times expands to N^5 within it. 8 MiB is far above any real email
 * and far below anything that threatens the process.
 */
export const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
/**
 * The reference tag. Fixed shape, always self-closing.
 *
 * HTML has no self-closing syntax for non-void elements — a browser parses
 * `<x-component/>` as an OPEN tag and nests the rest of the document inside it.
 * That is survivable only because a file containing references is never handed
 * to an HTML parser: expansion happens before sending, so the only reader is
 * the byte scanner in `tagScan.ts`. Never run a DOM parser over a rewired
 * template.
 */
export const COMPONENT_TAG = "x-component";
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
 * different element, and the attribute lands on the wrong node with nothing to
 * report it — so every template that bumped its pin ships with its link gone.
 * An optional guard on a silent-corruption path is not a guard.
 *
 * It does not catch two same-tag siblings swapping places; declared slots are
 * the answer to that. It converts the dominant failure from silent-wrong-node
 * into a loud throw, and claims no more.
 */
export const TAG_ASSERT_PREFIX = "ov-tag-";
/** Marks a component body node as a named text slot. */
export const SLOT_ATTR = "data-slot";
export class ExpansionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExpansionError";
  }
}
/**
 * Its own type because it is the worst failure in the system and callers may
 * want to distinguish it: a surviving `<x-component/>` renders as nothing at
 * all, and there is no compiler left to object. One missed expansion is a
 * footerless email to a client's list with no signal anywhere.
 */
export class UnexpandedReferenceError extends ExpansionError {
  survivors;
  constructor(message, survivors) {
    super(message);
    this.survivors = survivors;
    this.name = "UnexpandedReferenceError";
  }
}
export class ComponentNotFoundError extends ExpansionError {
  constructor(componentId, revision) {
    super(`No revision ${revision} of component "${componentId}"`);
    this.name = "ComponentNotFoundError";
  }
}
