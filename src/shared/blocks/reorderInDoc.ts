import { BLOCK_REGISTRY } from "./registry.js";
import type { MjmlDocument, TreeNode } from "./types.js";
import { isBlockNode } from "./types.js";

/** `body` itself for a top-level path; null if the walk hits a non-container. */
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

function isAllowedChild(
  body: TreeNode[],
  parentPath: number[],
  source: TreeNode
): boolean {
  // Passthrough and unknown nodes carry no block type to gate on.
  if (!isBlockNode(source)) return true;
  if (parentPath.length === 0) return source.type === "mj-section";
  const parent = resolveParentBlock(body, parentPath);
  if (!parent || !isBlockNode(parent)) return false;
  const def = BLOCK_REGISTRY[parent.type];
  if (!def.allowedChildren) return false;
  return def.allowedChildren.includes(source.type);
}

/**
 * Splicing the source out shifts its right-siblings down by one, so an
 * `overPath` to the right of it under the same parent has to come back by one.
 *
 *   [0,0,1] over [0,0,3] -> [0,0,2]   same parent, over is to the right
 *   [0,0,1] over [0,1,0] -> unchanged  they share only [0]
 *   [0,0,3] over [0,0,1] -> unchanged  over is already to the left
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

  // A source that prefixes `over` would be dropped into its own descendant.
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

  // structuredClone rather than a JSON round trip, which loses `attrs`.
  const cloned = structuredClone(doc.body) as TreeNode[];

  const sourceParentArr = walkToParentArr(cloned, sourcePath);
  if (!sourceParentArr) return null;
  const sourceIdx = sourcePath[sourcePath.length - 1]!;
  if (sourceIdx < 0 || sourceIdx >= sourceParentArr.length) return null;
  const moved = sourceParentArr[sourceIdx];
  if (!moved) return null;

  // Validated before the splice, so an invalid target leaves the doc untouched.
  const adjustedOverPath = adjustOverPath(overPath, sourcePath);
  if (!isAllowedChild(cloned, adjustedOverPath.slice(0, -1), moved)) return null;

  sourceParentArr.splice(sourceIdx, 1);

  // Re-walked after the splice, which shifted the paths.
  const overParentArr = walkToParentArr(cloned, adjustedOverPath);
  if (!overParentArr) return null;
  const overIdx = adjustedOverPath[adjustedOverPath.length - 1]!;
  if (overIdx < 0 || overIdx >= overParentArr.length) return null;

  overParentArr.splice(overIdx + 1, 0, moved);

  return { ...doc, body: cloned };
}
