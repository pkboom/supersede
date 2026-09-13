/**
 * locateInstances — find every component reference in a template and report,
 * honestly, which ones a tree-walking operation can reach.
 *
 * **Detect-and-report is MANDATORY and PERMANENT** (plan §10.1). It is not a
 * temporary measure pending better parser coverage, and an unreachable instance
 * must never be silently skipped.
 *
 * WHY ANY INSTANCE IS UNREACHABLE
 * -------------------------------
 * `parser.ts` collapses constructs it cannot model deterministically into an
 * opaque `CustomPassthroughNode` holding a verbatim `rawXml` slice. A component
 * reference inside one of those survives round-trip perfectly — but it is not
 * addressable as a tree node, so anything that walks the tree skips it without
 * noticing. The constructs that do this:
 *
 *   - `mj-wrapper`  — swallows the ENTIRE body; a wrapped template parses to
 *                     exactly one node
 *   - `mj-hero`, `mj-navbar`, `mj-group`, `mj-table`, `mj-carousel`,
 *     `mj-accordion`, `mj-raw` — all demote
 *   - rich `mj-text` — ANY inline HTML (`<b>`, `<a>`, `<p>`, `<br/>`) demotes
 *     the whole leaf, and that is the biggest half of the problem because
 *     inline HTML in copy is the norm in real email
 *
 * Note this does NOT block expansion: `expand()` works on the string and
 * substitutes a fixed-shape self-closing token, so it runs straight through an
 * opaque wrapper and produces correct, compilable MJML. Reachability matters
 * for operations that need to ADDRESS an instance in the tree — the canvas
 * overlay, and any per-instance UI. That asymmetry is exactly why D-2 chose
 * reference over copy: copy's worst case is reference's easiest case.
 *
 * There is a known, cheap follow-on: `RightPanel.tsx:579` actively instructs
 * users to paste `<mj-wrapper>` while `parser.ts` collapses it — the product
 * instructs people into the hole. Modelling `mj-wrapper` as a container deletes
 * the largest unreachable category for roughly the code of special-casing it.
 */
import { parseMjml } from "../blocks/parser.js";
import type { TreeNode } from "../blocks/types.js";
import { COMPONENT_TAG, type ComponentInstance } from "./types.js";
import { findAllTags } from "./tagScan.js";
import { OVERRIDE_PREFIX } from "./types.js";

export interface InstanceReport {
  instances: ComponentInstance[];
  summary: {
    total: number;
    reachable: number;
    /**
     * Headline figure, never folded into a "skipped" count and never omitted
     * when zero. A report that hides this teaches users that unreachable and
     * absent are the same thing.
     */
    unreachable: number;
    /** Which opaque constructs were responsible, for an actionable message. */
    unreachableBy: Record<string, number>;
  };
}

interface OpaqueRange {
  start: number;
  end: number;
  reason: string;
}

/**
 * Locate the source ranges the parser could not model.
 *
 * `rawXml` is a verbatim source slice but carries no offsets (parser.ts
 * computes `el.start`/`el.end` as locals and drops them), so we recover the
 * ranges by scanning forward through the source with a monotonic cursor. The
 * cursor matters: two identical opaque nodes would otherwise both resolve to
 * the first occurrence.
 */
function opaqueRanges(source: string, nodes: TreeNode[]): OpaqueRange[] {
  const ranges: OpaqueRange[] = [];
  let cursor = 0;

  const walk = (list: TreeNode[]): void => {
    for (const n of list) {
      if (n.type === "mj-custom-passthrough" || n.type === "__unknown__") {
        // A bare `<mj-component/>` is itself an unmodeled tag, so the parser
        // gives it a passthrough node of its own. That node IS addressable —
        // it is a node in the tree, findable by a walk — so it must NOT be
        // treated as burying itself. Without this, EVERY instance reports as
        // unreachable and the whole report becomes noise.
        //
        // The distinction that matters is being swallowed into a LARGER opaque
        // slice (an `mj-wrapper`, a rich `mj-text`), where the reference is not
        // a node at all, merely bytes inside one.
        if (
          n.type === "mj-custom-passthrough" &&
          n.originalTagName === COMPONENT_TAG
        ) {
          continue;
        }
        const raw = n.rawXml;
        const at = source.indexOf(raw, cursor);
        if (at === -1) {
          // Offset recovery failed. In a module whose contract is "never
          // silently skip an unreachable instance", the one step that CAN fail
          // must not fail by producing the forbidden answer. Treat the rest of
          // the document as unclassifiable rather than reporting everything in
          // it as reachable.
          ranges.push({
            start: cursor,
            end: source.length,
            reason:
              "offset recovery failed — this region could not be classified, " +
              "so its instances are reported unreachable rather than assumed reachable",
          });
          return;
        }
        ranges.push({
          start: at,
          end: at + raw.length,
          reason:
            n.type === "mj-custom-passthrough"
              ? `<${n.originalTagName}> is not modeled by the parser`
              : "unmodeled content (comment or stray text)",
        });
        cursor = at + raw.length;
        continue;
      }
      if (n.children) walk(n.children);
    }
  };

  walk(nodes);
  return ranges;
}

export function locateInstances(source: string): InstanceReport {
  const tags = findAllTags(source, COMPONENT_TAG);

  let ranges: OpaqueRange[] = [];
  try {
    const doc = parseMjml(source);
    ranges = opaqueRanges(source, doc.body);
  } catch {
    // A template we cannot parse at all is reported as entirely unreachable
    // rather than as having no instances — the difference is the whole point
    // of this module.
    ranges = [{ start: 0, end: source.length, reason: "template failed to parse" }];
  }

  const instances: ComponentInstance[] = tags.map((tag) => {
    const componentId =
      tag.attrs.find((a) => a.name === "component-id")?.value ?? "";
    const revisionRaw = tag.attrs.find((a) => a.name === "revision")?.value;
    const overrides = new Map<string, string>();
    for (const a of tag.attrs) {
      if (a.name.startsWith(OVERRIDE_PREFIX)) overrides.set(a.name, a.value);
    }

    const burying = ranges.find(
      (r) => tag.start >= r.start && tag.end <= r.end
    );

    return {
      componentId,
      revision: revisionRaw === undefined ? NaN : Number(revisionRaw),
      start: tag.start,
      end: tag.end,
      overrides,
      status: burying ? "opaque" : "reachable",
      opaqueReason: burying?.reason,
    };
  });

  const unreachableBy: Record<string, number> = {};
  for (const i of instances) {
    if (i.status === "opaque" && i.opaqueReason) {
      unreachableBy[i.opaqueReason] = (unreachableBy[i.opaqueReason] ?? 0) + 1;
    }
  }

  const unreachable = instances.filter((i) => i.status === "opaque").length;
  return {
    instances,
    summary: {
      total: instances.length,
      reachable: instances.length - unreachable,
      unreachable,
      unreachableBy,
    },
  };
}
