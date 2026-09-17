/**
 * Finds every component reference in a template and reports, honestly, which
 * ones a tree-walking operation can reach. An unreachable instance is never
 * silently skipped.
 *
 * A reference is unreachable when the parser collapsed the construct around it
 * into an opaque verbatim slice: `mj-wrapper` (which swallows the entire body),
 * `mj-hero`, `mj-navbar`, `mj-group`, `mj-table`, `mj-carousel`,
 * `mj-accordion`, `mj-raw`, and any `mj-text` carrying inline HTML — the last
 * being the largest share, since inline HTML in copy is the norm in real email.
 *
 * This does not block expansion, which works on the string and runs straight
 * through an opaque wrapper. It limits operations that need to ADDRESS an
 * instance in the tree.
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
    /** Never folded into a "skipped" count, and never omitted when zero. */
    unreachable: number;
    /** Which opaque constructs were responsible. */
    unreachableBy: Record<string, number>;
  };
}

interface OpaqueRange {
  start: number;
  end: number;
  reason: string;
}

/**
 * The parser drops the offsets it computed, so the ranges are recovered by
 * scanning forward with a monotonic cursor — without which two identical
 * opaque nodes would both resolve to the first occurrence.
 */
function opaqueRanges(source: string, nodes: TreeNode[]): OpaqueRange[] {
  const ranges: OpaqueRange[] = [];
  let cursor = 0;

  const walk = (list: TreeNode[]): void => {
    for (const n of list) {
      if (n.type === "mj-custom-passthrough" || n.type === "__unknown__") {
        // A bare `<mj-component/>` is unmodeled too, so it gets a passthrough
        // node of its own — but that node is addressable and must not count as
        // burying itself. What matters is being swallowed into a LARGER opaque
        // slice, where the reference is not a node at all, just bytes in one.
        if (
          n.type === "mj-custom-passthrough" &&
          n.originalTagName === COMPONENT_TAG
        ) {
          continue;
        }
        const raw = n.rawXml;
        const at = source.indexOf(raw, cursor);
        // The one step that can fail must not fail by producing the forbidden
        // answer, so the rest of the document becomes unclassifiable rather
        // than reachable.
        if (at === -1) {
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
    // Entirely unreachable, not "no instances" — that difference is the point.
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
