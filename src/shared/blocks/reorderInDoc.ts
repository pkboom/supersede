/**
 * reorderInDoc — pure helper for H5 drag-to-reorder of overlay blocks.
 *
 * Moves the node at `sourcePath` so it is inserted immediately AFTER the node
 * at `overPath`, returning a new MjmlDocument. Returns null if the move is
 * invalid (cycle, missing path, target parent rejects the source's type).
 *
 * Constraints:
 *   - structuredClone is used so the returned doc shares no mutable state
 *     (BlockNode.attrs is a Map<string,string>; structuredClone preserves it,
 *     JSON round-trip would not).
 *   - Cycle prevention: if `sourcePath` is a strict prefix of `overPath`,
 *     dropping the source into its own descendant would create a cycle —
 *     return null.
 *   - Validity: `BLOCK_REGISTRY[parentType].allowedChildren` must include the
 *     source's block type (skipped for unknown / mj-custom-passthrough nodes,
 *     which carry no canonical block-type for the registry to gate on).
 *
 * Path-arithmetic note (architect NEW-1):
 *   When the source's parent is an ancestor of `overPath`, splicing the source
 *   out of its parent shifts the indices of its right-siblings down by 1 —
 *   `overPath` must be adjusted before the second walk.
 *
 *   Predicate:
 *     let i = sourcePath.length - 1
 *     adjust overPath[i] iff
 *       overPath.length > i
 *       AND overPath.slice(0, i).every((v, j) => v === sourcePath[j])
 *       AND overPath[i] > sourcePath[i]
 *
 *   Example: sourcePath = [0, 0, 1], overPath = [0, 0, 3]
 *     - share parent [0, 0]
 *     - i = 2; overPath[2] = 3 > sourcePath[2] = 1
 *     - adjusted overPath = [0, 0, 2]
 *
 *   Counter-examples (no adjust):
 *     - sourcePath = [0, 0, 1], overPath = [0, 1] — different parent at depth 1.
 *     - sourcePath = [0, 0, 1], overPath = [0, 1, 0] — share only [0]; the
 *       splice does not touch overPath[1].
 *     - sourcePath = [0, 0, 3], overPath = [0, 0, 1] — overPath index is
 *       already to the LEFT of source, so splice doesn't shift it.
 */
import { BLOCK_REGISTRY } from "./registry.js";
import type { MjmlDocument, TreeNode } from "./types.js";
import { isBlockNode } from "./types.js";

/**
 * Walk to the children-array of the parent of `path`. Returns `body` itself
 * for top-level paths. Returns null if any intermediate node is missing or
 * not a container.
 */
function walkToParentArr(
  body: TreeNode[],
  path: number[]
): TreeNode[] | null {
  if (path.length === 0) return null;
  let arr: TreeNode[] = body;
  for (let i = 0; i < path.length - 1; i++) {
    const idx = path[i]!;
    const node = arr[idx];
    if (!node || !isBlockNode(node)) return null;
    if (!node.children) return null;
    arr = node.children;
  }
  return arr;
}

/**
 * Resolve the block-typed parent at `parentPath` against `body`, or null for
 * a top-level path (parentPath = []).
 */
function resolveParentBlock(
  body: TreeNode[],
  parentPath: number[]
): TreeNode | null {
  if (parentPath.length === 0) return null;
  let cur: TreeNode | undefined;
  let arr: TreeNode[] = body;
  for (let i = 0; i < parentPath.length; i++) {
    const idx = parentPath[i]!;
    cur = arr[idx];
    if (!cur) return null;
    if (i < parentPath.length - 1) {
      if (!isBlockNode(cur) || !cur.children) return null;
      arr = cur.children;
    }
  }
  return cur ?? null;
}

/**
 * Returns true if the move is allowed by BLOCK_REGISTRY.allowedChildren of the
 * target parent. Top-level drops (parentPath = []) only allow `mj-section` per
 * the implicit body-children invariant. Unknown / passthrough source nodes are
 * not gated (we can't reason about their block-type).
 */
function isAllowedChild(
  body: TreeNode[],
  parentPath: number[],
  source: TreeNode
): boolean {
  if (!isBlockNode(source)) return true; // unknown / passthrough — no gate.

  if (parentPath.length === 0) {
    // Top-level body only accepts mj-section.
    return source.type === "mj-section";
  }
  const parent = resolveParentBlock(body, parentPath);
  if (!parent || !isBlockNode(parent)) return false;
  const def = BLOCK_REGISTRY[parent.type];
  if (!def.allowedChildren) return false;
  return def.allowedChildren.includes(source.type);
}

/**
 * If sourcePath's parent is the same as overPath's prefix at depth
 * (sourcePath.length - 1) AND overPath's index at that depth is greater than
 * sourcePath's last index, decrement overPath at that depth by 1 to account
 * for the splice.
 */
function adjustOverPath(
  overPath: number[],
  sourcePath: number[]
): number[] {
  const i = sourcePath.length - 1;
  if (i < 0) return overPath.slice();
  if (overPath.length <= i) return overPath.slice();
  for (let j = 0; j < i; j++) {
    if (overPath[j] !== sourcePath[j]) return overPath.slice();
  }
  if (overPath[i]! <= sourcePath[i]!) return overPath.slice();
  const adjusted = overPath.slice();
  adjusted[i] = (adjusted[i] as number) - 1;
  return adjusted;
}

export function reorderInDoc(
  doc: MjmlDocument,
  sourcePath: number[],
  overPath: number[]
): MjmlDocument | null {
  if (sourcePath.length === 0 || overPath.length === 0) return null;

  // Cycle prevention: source is a strict prefix of over → would drop a node
  // into its own descendant.
  if (sourcePath.length <= overPath.length) {
    let isPrefix = true;
    for (let i = 0; i < sourcePath.length; i++) {
      if (sourcePath[i] !== overPath[i]) {
        isPrefix = false;
        break;
      }
    }
    if (isPrefix) return null;
  }

  // structuredClone preserves Map (attrs).
  const cloned = structuredClone(doc.body) as TreeNode[];

  // 1) Detach source.
  const sourceParentArr = walkToParentArr(cloned, sourcePath);
  if (!sourceParentArr) return null;
  const sourceIdx = sourcePath[sourcePath.length - 1]!;
  if (sourceIdx < 0 || sourceIdx >= sourceParentArr.length) return null;
  const moved = sourceParentArr[sourceIdx];
  if (!moved) return null;

  // 2) Compute adjusted overPath, then resolve target parent + index.
  const adjustedOverPath = adjustOverPath(overPath, sourcePath);
  // Walk from the un-mutated body to validate the adjusted path resolves
  // BEFORE we splice, so an invalid target leaves the doc untouched.
  const overParentPath = adjustedOverPath.slice(0, -1);

  // Validate target parent type allows source's block type.
  if (!isAllowedChild(cloned, overParentPath, moved)) return null;

  // 3) Splice out source.
  sourceParentArr.splice(sourceIdx, 1);

  // 4) Resolve target parent's children-array AFTER the splice (paths shifted).
  const overParentArr = walkToParentArr(cloned, adjustedOverPath);
  if (!overParentArr) return null;
  const overIdx = adjustedOverPath[adjustedOverPath.length - 1]!;
  if (overIdx < 0 || overIdx >= overParentArr.length) return null;

  // 5) Insert AFTER over.
  overParentArr.splice(overIdx + 1, 0, moved);

  return { ...doc, body: cloned };
}
