/**
 * Canvas — F3-prime Stripo-style 3-region layout.
 *
 *   [icon-rail | canvas-frame (iframe + overlay) | right-panel]
 *
 * The canvas itself is the rendered email (via /api/render → iframe).
 * Selection / inline-edit / properties all flow through the store.
 *
 * Atomic landing constraint: this file replaces the legacy read-only
 * scaffold. After Lane F lands, there is no read-only state, no PUT
 * /api/email path, and no parent-side block placeholder rendering.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import {
  BLOCK_REGISTRY,
  isBlockNode,
  parseMjml,
  reorderInDoc,
  serializeMjml,
} from "../blocks/index.js";
import type {
  BlockNode,
  BlockType,
  CustomPassthroughNode,
  MjmlDocument,
  TreeNode,
} from "../blocks/index.js";
import IconRail from "./IconRail.js";
import RightPanel from "./RightPanel.js";
import IframePreview from "./IframePreview.js";
import OverlayTree from "./OverlayTree.js";
import InlineTextEditor from "./InlineTextEditor.js";
import DeviceToggle from "./DeviceToggle.js";
import { DragLayer } from "./DragLayer.js";
import { Navigate } from "react-router-dom";
import { useTemplateActions, useTemplateData } from "../hooks/useTemplate.js";
import { useQueryRunnerCtx } from "../hooks/useQueryRunner.js";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

let __idCounter = 0;
function makeId(): string {
  __idCounter += 1;
  return `c_${__idCounter.toString(36)}`;
}

function defaultBlock(type: Exclude<BlockType, "mj-custom-passthrough">): BlockNode {
  const def = BLOCK_REGISTRY[type];
  const node: BlockNode = {
    id: makeId(),
    type,
    attrs: new Map(Object.entries(def.defaults)),
  };
  if (def.contentField === "text") {
    node.text =
      type === "mj-button"
        ? "Click me"
        : type === "mj-social-element"
        ? "Facebook"
        : "Lorem ipsum";
  }
  if (def.isContainer) {
    node.children = [];
    if (type === "mj-section") {
      node.children = [defaultBlock("mj-column")];
    } else if (type === "mj-social") {
      // MJML's mj-social renders nothing without mj-social-element children —
      // a fresh DnD must seed real elements so the user immediately sees icons.
      node.children = [
        defaultSocialElement("facebook", "https://facebook.com", "Facebook"),
        defaultSocialElement("instagram", "https://instagram.com", "Instagram"),
        defaultSocialElement("x", "https://x.com", "X"),
      ];
    }
  }
  return node;
}

function defaultSocialElement(
  name: string,
  href: string,
  label: string
): BlockNode {
  return {
    id: makeId(),
    type: "mj-social-element",
    attrs: new Map<string, string>([
      ["name", name],
      ["href", href],
    ]),
    text: label,
  };
}

// `data-mjml-passthrough="true"` is the sentinel that lets stampPaths give a
// dropped passthrough a clickable `data-mjml-path` overlay. If the user later
// rewrites the rawXml and removes the sentinel, the block still renders
// fine but loses its click-selection target — auto-select-on-drop is the
// guaranteed entry point into the editor.
//
// Wrapper is `<mj-text>`, NOT `<mj-raw>`. Industry-standard email builders
// (Stripo, Beefree, Mailchimp, Klaviyo) place "Custom HTML" / "Code" blocks
// inside columns alongside Image/Text/Button and render them in place.
// `mj-raw` only renders predictably at body level — MJML's renderer hoists
// it out of column flow when nested. mj-text accepts arbitrary inner HTML
// and renders it inside the column's `<td>` cell, preserving position. The
// parser demotes mj-text-with-element-children to mj-custom-passthrough so
// the rawXml is preserved verbatim across round-trips.
const CUSTOM_PASSTHROUGH_SEED_RAW =
  '<mj-text padding="0"><div data-mjml-passthrough="true" style="padding:24px;text-align:center;background:#fafafa;border:1px dashed #999;color:#666;font-family:Arial,sans-serif;font-size:14px;">Custom MJML — edit in the right panel</div></mj-text>';

function defaultPaletteNode(type: BlockType): TreeNode {
  if (type === "mj-custom-passthrough") {
    return {
      id: makeId(),
      type: "mj-custom-passthrough",
      rawXml: CUSTOM_PASSTHROUGH_SEED_RAW,
      originalTagName: "mj-raw",
    } satisfies CustomPassthroughNode;
  }
  return defaultBlock(type);
}

/**
 * Resolved insertion site for a palette drag. Computed by `resolveInsertion`
 * and consumed by both the drop indicator (preview while dragging) and
 * `insertPaletteBlock` (commit on drop) — single source of truth so the
 * indicator can never lie about where the block will land.
 */
export type Insertion =
  | { kind: "root-append" }
  | { kind: "after"; anchorPath: number[] }
  | { kind: "inside"; containerPath: number[] };

/**
 * Walk `targetPath` looking for the nearest ancestor whose type is in
 * `validParents`. Returns the same kinds resolveInsertion does so we can
 * compose multiple parent-search strategies for content drops.
 */
function findValidParent(
  body: TreeNode[],
  targetPath: number[],
  validParents: BlockType[]
): Insertion {
  let parentDepth = -1;
  for (let depth = 0; depth < targetPath.length; depth++) {
    const node = resolveNode(body, targetPath.slice(0, depth + 1));
    if (node && isBlockNode(node) && (validParents as BlockType[]).includes(node.type)) {
      parentDepth = depth;
      break;
    }
  }
  if (parentDepth < 0) return { kind: "root-append" };
  if (parentDepth === targetPath.length - 1) {
    return { kind: "inside", containerPath: targetPath.slice(0, parentDepth + 1) };
  }
  return { kind: "after", anchorPath: targetPath.slice(0, parentDepth + 2) };
}

/**
 * Decide where a palette-dragged block of `draggedType` should land when the
 * user is hovering over `targetPath` (or canvas-root when `targetPath` is
 * null). Pure: no body mutation, no allocation beyond the returned record.
 *
 * Content blocks (text/image/button/…) follow a two-tier search:
 *   1. Nearest `mj-column` ancestor → drop inside or as sibling.
 *   2. Nearest `mj-section` ancestor → drop "inside the section"; the
 *      commit step (`insertPaletteBlock`) then either places the leaf in the
 *      section's last existing column or synthesizes a new column.
 *   3. Otherwise → root-append, which wraps the leaf in a synthesized
 *      section + column.
 *
 * `mj-section` / `mj-column` palette items are not exposed in the v2 icon
 * rail (the user picks a "Layout" preset instead), but the resolution paths
 * are kept defensive.
 */
function resolveInsertion(
  body: TreeNode[],
  targetPath: number[] | null,
  draggedType: BlockType
): Insertion {
  if (!targetPath || targetPath.length === 0) return { kind: "root-append" };

  if (draggedType === "mj-section") {
    return { kind: "after", anchorPath: [targetPath[0]!] };
  }
  if (draggedType === "mj-column") {
    return findValidParent(body, targetPath, ["mj-section"]);
  }
  if (draggedType === "mj-social-element") {
    return findValidParent(body, targetPath, ["mj-social"]);
  }

  // Content block (leaf).
  const inColumn = findValidParent(body, targetPath, ["mj-column"]);
  if (inColumn.kind !== "root-append") return inColumn;

  const inSection = findValidParent(body, targetPath, ["mj-section"]);
  const sectionPath =
    inSection.kind === "inside"
      ? inSection.containerPath
      : inSection.kind === "after"
        ? inSection.anchorPath.slice(0, -1)
        : null;
  if (sectionPath) {
    // If the section already has a column, point at the LAST column so the
    // drop indicator (which reads this Insertion) matches the commit site.
    // Otherwise return "inside the section" and let insertPaletteBlock
    // synthesize the column at commit time.
    const section = resolveNode(body, sectionPath);
    if (section && isBlockNode(section)) {
      const kids = section.children ?? [];
      for (let i = kids.length - 1; i >= 0; i--) {
        const c = kids[i];
        if (c && isBlockNode(c) && c.type === "mj-column") {
          return { kind: "inside", containerPath: [...sectionPath, i] };
        }
      }
    }
    return { kind: "inside", containerPath: sectionPath };
  }
  return { kind: "root-append" };
}

/**
 * Insert a palette-dragged block into the body. Delegates the "where"
 * decision to `resolveInsertion` so the drop indicator and the commit agree.
 *
 * Path-spine cloning is via structuredClone (the codebase's chosen path-clone
 * primitive because BlockNode.attrs is a Map<string,string>; a JSON round-trip
 * would silently turn it into {}).
 */
interface InsertResult {
  body: TreeNode[];
  /** Path to the newly inserted node, or [] if the insertion was rejected. */
  insertedPath: number[];
}

function insertPaletteBlock(
  body: TreeNode[],
  targetPath: number[] | null,
  draggedType: BlockType
): InsertResult {
  const newBlock = defaultPaletteNode(draggedType);

  // Wrap a non-Section block so it can sit at root level. Returns the
  // resulting top-level BlockNode plus the path *within* that wrapper to the
  // original node (so callers can auto-select the dropped block, not its
  // synthetic ancestors).
  const wrapForRoot = (
    block: TreeNode
  ): { wrapped: BlockNode; innerPath: number[] } => {
    if (isBlockNode(block) && block.type === "mj-section") {
      return { wrapped: block, innerPath: [] };
    }
    if (isBlockNode(block) && block.type === "mj-column") {
      const sec = defaultBlock("mj-section");
      sec.children = [block];
      return { wrapped: sec, innerPath: [0] };
    }
    const sec = defaultBlock("mj-section");
    const col = defaultBlock("mj-column");
    col.children = [block];
    sec.children = [col];
    return { wrapped: sec, innerPath: [0, 0] };
  };

  const insertion = resolveInsertion(body, targetPath, draggedType);

  if (insertion.kind === "root-append") {
    const { wrapped, innerPath } = wrapForRoot(newBlock);
    return {
      body: [...body, wrapped],
      insertedPath: [body.length, ...innerPath],
    };
  }

  if (insertion.kind === "after") {
    const anchor = insertion.anchorPath;
    if (anchor.length === 1) {
      const idx = anchor[0]! + 1;
      return {
        body: [...body.slice(0, idx), newBlock, ...body.slice(idx)],
        insertedPath: [idx],
      };
    }
    const cloned = structuredClone(body) as TreeNode[];
    const parentPath = anchor.slice(0, -1);
    const parent = resolveNode(cloned, parentPath);
    if (!parent || !isBlockNode(parent)) return { body, insertedPath: [] };
    const childIdx = anchor[anchor.length - 1]! + 1;
    const children = parent.children ?? [];
    parent.children = [
      ...children.slice(0, childIdx),
      newBlock,
      ...children.slice(childIdx),
    ];
    return { body: cloned, insertedPath: [...parentPath, childIdx] };
  }

  // inside
  const cloned = structuredClone(body) as TreeNode[];
  const container = resolveNode(cloned, insertion.containerPath);
  if (!container || !isBlockNode(container)) return { body, insertedPath: [] };

  // Leaf-on-section: drop into the section's last column if one exists,
  // otherwise synthesize a fresh column inside the section. This is the
  // "you don't need to drop a section/column first" UX path.
  const isLeaf =
    draggedType !== "mj-section" &&
    draggedType !== "mj-column" &&
    draggedType !== "mj-social-element";
  if (container.type === "mj-section" && isLeaf) {
    const children = container.children ?? [];
    let lastColIdx = -1;
    for (let i = children.length - 1; i >= 0; i--) {
      const c = children[i];
      if (c && isBlockNode(c) && c.type === "mj-column") {
        lastColIdx = i;
        break;
      }
    }
    if (lastColIdx >= 0) {
      const col = children[lastColIdx] as BlockNode;
      const colChildren = col.children ?? [];
      col.children = [...colChildren, newBlock];
      return {
        body: cloned,
        insertedPath: [...insertion.containerPath, lastColIdx, colChildren.length],
      };
    }
    const synthCol = defaultBlock("mj-column");
    synthCol.children = [newBlock];
    const colIdx = children.length;
    container.children = [...children, synthCol];
    return {
      body: cloned,
      insertedPath: [...insertion.containerPath, colIdx, 0],
    };
  }

  const newIdx = (container.children ?? []).length;
  container.children = [...(container.children ?? []), newBlock];
  return {
    body: cloned,
    insertedPath: [...insertion.containerPath, newIdx],
  };
}

/** Resolve `path` against `body`. Returns the node or null if missing. */
function resolveNode(body: TreeNode[], path: number[]): TreeNode | null {
  if (path.length === 0) return null;
  let arr: TreeNode[] = body;
  let node: TreeNode | undefined;
  for (let i = 0; i < path.length; i++) {
    const idx = path[i]!;
    node = arr[idx];
    if (!node) return null;
    if (i < path.length - 1) {
      if (!isBlockNode(node)) return null;
      arr = node.children ?? [];
    }
  }
  return node ?? null;
}

/** Compute SHA-256 hex of an arbitrary string. Async. */
async function sha256Hex(s: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    // Fallback hash for non-browser test envs without subtle.
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return `fallback_${(h >>> 0).toString(16)}`;
  }
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Serialize a single node by wrapping it in a minimal mjml doc. Used for
 *  selection fingerprinting (R13). */
function fingerprintInput(node: TreeNode): string {
  if (node.type === "__unknown__") return `unknown:${node.rawXml}`;
  if (node.type === "mj-custom-passthrough") return `passthrough:${node.rawXml}`;
  // Build a tiny doc and serialize so we can re-use serializer.
  const tmpDoc: MjmlDocument = { body: [node] };
  return serializeMjml(tmpDoc);
}

/** Length of siblings at every ancestor level in `body` for `path`. */
function ancestorSiblingCounts(body: TreeNode[], path: number[]): number[] {
  const out: number[] = [];
  let arr: TreeNode[] = body;
  out.push(arr.length);
  for (let i = 0; i < path.length - 1; i++) {
    const idx = path[i]!;
    const node = arr[idx];
    if (!node || !isBlockNode(node)) return out;
    arr = node.children ?? [];
    out.push(arr.length);
  }
  return out;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function parsePathKey(key: string): number[] {
  if (!key) return [];
  return key.split("/").map((s) => Number.parseInt(s, 10));
}

interface CanvasMainProps {
  outerRef: React.MutableRefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}

// `useDroppable` consumes the dnd-kit context via React context, so the
// canvas-root droppable must be registered from a component that renders
// *inside* the <DndContext> provider — calling the hook from `Canvas` itself
// (the component that owns the <DndContext>) silently no-ops because the
// context isn't in scope yet, leaving the canvas with zero registered
// droppables when the body is empty (no overlay-block droppables either).
function CanvasMain({ outerRef, children }: CanvasMainProps) {
  const { setNodeRef } = useDroppable({
    id: "canvas-root",
    data: { kind: "canvas-root" },
  });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        outerRef.current = el;
      }}
      className="canvas-main"
    >
      {children}
    </div>
  );
}

export function Canvas() {
  // Data + actions from the per-route TemplateRoute providers (Phase 6).
  const data = useTemplateData();
  const acts = useTemplateActions();
  const q = useQueryRunnerCtx();

  const [doc, setDoc] = useState<MjmlDocument | null>(null);
  const [source, setSource] = useState<string>("");
  const [viewportMode, setViewportMode] =
    useState<"desktop" | "mobile">("desktop");
  const [selectedPath, setSelectedPath] = useState<number[] | null>(null);
  const [selectedFingerprint, setSelectedFingerprint] =
    useState<string | null>(null);
  const [bboxes, setBboxes] = useState<Map<string, Rect>>(new Map());
  const [dragActive, setDragActive] = useState<boolean>(false);
  // Live insertion preview while dragging.
  const [dropPreview, setDropPreview] = useState<Insertion | null>(null);
  // Hovered overlay path (browser-only).
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  // Refs for dnd / async handlers.
  const docRef = useRef<MjmlDocument | null>(null);
  const sourceRef = useRef<string>("");
  const selectedPathRef = useRef<number[] | null>(null);
  const selectedFingerprintRef = useRef<string | null>(null);
  // BLOCKER 5: thread iframe + inline-edit control across Canvas.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // H1: refs for the .canvas-frame (coord origin) and the .canvas-main scroll
  // surface. The bbox transform reads .canvas-frame's bounding rect; the
  // REQUEST_REEMIT scroll listener attaches to .canvas-main.
  const canvasFrameRef = useRef<HTMLDivElement | null>(null);
  const canvasMainRef = useRef<HTMLDivElement | null>(null);
  const inlineEditControlRef = useRef<{
    beginEdit: (ordinal: number, expectedText: string) => void;
    endEdit: () => void;
  } | null>(null);
  // Path of the block currently being inline-edited. Captured at beginEdit
  // time so the commit handler knows where to write back even if selection
  // changes.
  const editingPathRef = useRef<number[] | null>(null);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);
  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);
  useEffect(() => {
    selectedFingerprintRef.current = selectedFingerprint;
  }, [selectedFingerprint]);

  // Re-parse MJML whenever the hook reports a new server-authoritative version
  // (initial load, applyServerWrite from /query, refetch after 409). The
  // mid-edit classifier is gone — v2 has no concurrent server writer; canvas
  // is locked via `q.locked` while /query is in flight, AND useQueryRunner
  // calls acts.cancelPendingSave() before the POST so there's no in-flight
  // save to race against (ralplan §7.2).
  useEffect(() => {
    if (!data.mjml) {
      setDoc(null);
      setSource("");
      return;
    }
    try {
      setDoc(parseMjml(data.mjml));
      setSource(data.mjml);
    } catch {
      // Surfaced via data.status === "error" in the SaveStatusIndicator.
    }
  }, [data.mjml, data.version]);

  /** Persist a serialized MJML source. Routes through useTemplate.save —
   *  debounce + single-flight + visibilitychange handling all live there. */
  const persistSource = (
    nextSource: string,
    _origin: "dnd" | "browser-inline-text" | "browser-attr-form",
  ): void => {
    setSource(nextSource);
    acts.save(nextSource);
  };

  const persistDoc = (next: MjmlDocument): void => {
    const nextSource = serializeMjml(next);
    setSource(nextSource);
    acts.save(nextSource);
  };

  /** Compute on-demand fingerprint after selection. */
  const selectByPathKey = (key: string): void => {
    const path = parsePathKey(key);
    if (!docRef.current) return;
    const node = resolveNode(docRef.current.body, path);
    if (!node) return;
    setSelectedPath(path);
    // Provisional fingerprint placeholder; resolved async.
    setSelectedFingerprint(null);
    void sha256Hex(fingerprintInput(node)).then((fp) => {
      if (
        selectedPathRef.current &&
        arraysEqual(selectedPathRef.current, path)
      ) {
        setSelectedFingerprint(fp);
      }
    });
  };

  // H1 — coordinate transform at the iframe→parent boundary.
  // The iframe posts `rect` in iframe-viewport coords plus its content scroll
  // offset; we translate to `.canvas-frame`-relative coords via:
  //   pageX = rect.x + iframeBox.left - iframeScroll.x
  //   frameX = pageX - frameBox.left = rect.x + (iframeBox.left - frameBox.left) - iframeScroll.x
  // Math.round on x/y/w/h kills sub-pixel drift that would otherwise cause
  // bbox flicker on every scroll/resize tick.
  const onBboxReport = (
    pathKey: string,
    rect: Rect,
    iframeScroll: { x: number; y: number }
  ): void => {
    const iframeEl = iframeRef.current;
    const frameEl = canvasFrameRef.current;
    if (!iframeEl || !frameEl) return;

    const iframeBox = iframeEl.getBoundingClientRect();
    const frameBox = frameEl.getBoundingClientRect();

    const transformed: Rect = {
      x: Math.round(rect.x + iframeBox.left - frameBox.left - iframeScroll.x),
      y: Math.round(rect.y + iframeBox.top - frameBox.top - iframeScroll.y),
      w: Math.round(rect.w),
      h: Math.round(rect.h),
    };

    setBboxes((prev) => {
      const existing = prev.get(pathKey);
      if (
        existing &&
        existing.x === transformed.x &&
        existing.y === transformed.y &&
        existing.w === transformed.w &&
        existing.h === transformed.h
      ) {
        return prev;
      }
      const next = new Map(prev);
      next.set(pathKey, transformed);
      return next;
    });
  };

  // H1 — request a re-emit from the iframe whenever the parent layout could
  // shift the iframe's page-relative position: window resize OR `.canvas-main`
  // scroll. Both can desync the bbox-receive transform without a re-emit.
  useEffect(() => {
    const requestReemit = (): void => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "EMAIL_DESIGNER_REQUEST_REEMIT" },
        "*"
      );
    };
    window.addEventListener("resize", requestReemit);
    const mainEl = canvasMainRef.current;
    mainEl?.addEventListener("scroll", requestReemit, { passive: true });
    return () => {
      window.removeEventListener("resize", requestReemit);
      mainEl?.removeEventListener("scroll", requestReemit);
    };
  }, []);

  // Selection toolbar handlers.
  const mutateBody = (
    fn: (body: TreeNode[], path: number[]) => TreeNode[] | null
  ): void => {
    const cur = docRef.current;
    const path = selectedPathRef.current;
    if (!cur || !path) return;
    // structuredClone preserves Map/Set; JSON round-trip would silently turn
    // BlockNode.attrs (Map<string,string>) into {} and crash later .get() calls.
    const cloned = structuredClone(cur.body) as TreeNode[];
    const nextBody = fn(cloned, path);
    if (!nextBody) return;
    void persistDoc({ ...cur, body: nextBody });
  };

  const cloneNode = (node: TreeNode): TreeNode => {
    // structuredClone preserves Map (attrs); JSON round-trip would not.
    const dup = structuredClone(node) as TreeNode;
    if (dup.type !== "__unknown__" && dup.type !== "mj-custom-passthrough") {
      (dup as BlockNode).id = makeId();
      const walk = (n: BlockNode): void => {
        if (n.children) {
          for (const c of n.children) {
            if (c.type !== "__unknown__" && c.type !== "mj-custom-passthrough") {
              (c as BlockNode).id = makeId();
              walk(c as BlockNode);
            }
          }
        }
      };
      walk(dup as BlockNode);
    }
    return dup;
  };

  const computeMoveDir = (
    path: number[],
    dir: -1 | 1
  ): { parentArr: TreeNode[]; idx: number; nextIdx: number } | null => {
    if (!docRef.current || path.length === 0) return null;
    // structuredClone preserves Map (attrs).
    const cloned = structuredClone(docRef.current.body) as TreeNode[];
    let arr: TreeNode[] = cloned;
    for (let i = 0; i < path.length - 1; i++) {
      const idx = path[i]!;
      const node = arr[idx];
      if (!node || !isBlockNode(node)) return null;
      arr = node.children ?? [];
    }
    const idx = path[path.length - 1]!;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= arr.length) return null;
    return { parentArr: arr, idx, nextIdx };
  };

  const canMoveUp = useMemo(() => {
    if (!selectedPath || selectedPath.length === 0) return false;
    return selectedPath[selectedPath.length - 1]! > 0;
  }, [selectedPath]);

  const canMoveDown = useMemo(() => {
    if (!docRef.current || !selectedPath || selectedPath.length === 0) {
      return false;
    }
    const move = computeMoveDir(selectedPath, 1);
    return move !== null;
  }, [selectedPath, doc]);

  const onMoveUp = canMoveUp
    ? () => {
        mutateBody((body, path) => {
          const move = computeMoveDir(path, -1);
          if (!move) return null;
          let arr: TreeNode[] = body;
          for (let i = 0; i < path.length - 1; i++) {
            const idx = path[i]!;
            const node = arr[idx];
            if (!node || !isBlockNode(node)) return null;
            arr = node.children ?? [];
          }
          const cur = arr[move.idx]!;
          const prev = arr[move.nextIdx]!;
          arr[move.idx] = prev;
          arr[move.nextIdx] = cur;
          return body;
        });
      }
    : undefined;

  const onMoveDown = canMoveDown
    ? () => {
        mutateBody((body, path) => {
          const move = computeMoveDir(path, 1);
          if (!move) return null;
          let arr: TreeNode[] = body;
          for (let i = 0; i < path.length - 1; i++) {
            const idx = path[i]!;
            const node = arr[idx];
            if (!node || !isBlockNode(node)) return null;
            arr = node.children ?? [];
          }
          const cur = arr[move.idx]!;
          const nxt = arr[move.nextIdx]!;
          arr[move.idx] = nxt;
          arr[move.nextIdx] = cur;
          return body;
        });
      }
    : undefined;

  const onDuplicate = (): void => {
    mutateBody((body, path) => {
      let arr: TreeNode[] = body;
      for (let i = 0; i < path.length - 1; i++) {
        const idx = path[i]!;
        const node = arr[idx];
        if (!node || !isBlockNode(node)) return null;
        arr = node.children ?? [];
      }
      const idx = path[path.length - 1]!;
      const target = arr[idx];
      if (!target) return null;
      arr.splice(idx + 1, 0, cloneNode(target));
      return body;
    });
  };

  const onDelete = (): void => {
    mutateBody((body, path) => {
      let arr: TreeNode[] = body;
      for (let i = 0; i < path.length - 1; i++) {
        const idx = path[i]!;
        const node = arr[idx];
        if (!node || !isBlockNode(node)) return null;
        arr = node.children ?? [];
      }
      const idx = path[path.length - 1]!;
      if (idx < 0 || idx >= arr.length) return null;
      arr.splice(idx, 1);
      return body;
    });
    setSelectedPath(null);
    setSelectedFingerprint(null);
  };

  // Backspace / Delete removes the selected block. Skipped while typing in a
  // form field or while Claude is writing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (q.locked) return;
      if (!selectedPathRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
      }
      e.preventDefault();
      onDelete();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [q.locked, onDelete]);

  // The bbox Map is an accumulator: the iframe re-emits geometry only for
  // currently-stamped paths, so entries for deleted nodes would otherwise
  // linger and paint ghost overlays. Gate render on the doc — the model is
  // the source of truth, bboxes are just the geometry cache for live nodes.
  // Custom MJML (mj-custom-passthrough) is stamped via its sentinel attr and
  // is a real, selectable node, so include it alongside modeled blocks; only
  // `__unknown__` (comments / stray text) should be filtered out.
  const liveBboxes = useMemo(() => {
    if (!doc) return bboxes;
    const out = new Map<string, Rect>();
    bboxes.forEach((rect, key) => {
      const path = key.split("/").map((s) => Number(s));
      if (path.some((n) => Number.isNaN(n))) return;
      const node = resolveNode(doc.body, path);
      if (!node) return;
      if (node.type === "__unknown__") return;
      out.set(key, rect);
    });
    return out;
  }, [doc, bboxes]);

  // Selection breadcrumb: ancestor chain ending at the selected node, e.g.
  // [{Section, "0"}, {Column, "0/0"}, {Image, "0/0/1"}]. Each segment is
  // clickable so the user can promote the selection up the tree (Stripo /
  // Beefree convention). The trailing entry is the current selection itself
  // and renders as the primary label.
  const breadcrumb = useMemo(() => {
    if (!doc || !selectedPath || selectedPath.length === 0) {
      return [] as Array<{ label: string; pathKey: string; isSelected: boolean }>;
    }
    const items: Array<{ label: string; pathKey: string; isSelected: boolean }> = [];
    for (let i = 1; i <= selectedPath.length; i++) {
      const p = selectedPath.slice(0, i);
      const node = resolveNode(doc.body, p);
      if (!node || node.type === "__unknown__") break;
      items.push({
        label: BLOCK_REGISTRY[node.type]?.label ?? node.type,
        pathKey: p.join("/"),
        isSelected: i === selectedPath.length,
      });
    }
    return items;
  }, [doc, selectedPath]);

  /**
   * Compute the insertion site that *would* result if the user dropped right
   * now. Returns null when the drop would be a no-op (invalid target,
   * dropping a block onto itself, passthrough, missing data).
   *
   * Palette → canvas: delegates to `resolveInsertion`.
   * Overlay reorder: validates via `reorderInDoc` (cycle + allowedChildren);
   * preview is always "after" the over target since that is reorder's
   * insertion semantic.
   */
  const computeDropPreview = (
    activeData:
      | { kind?: string; type?: BlockType; path?: string; columns?: number }
      | undefined,
    overData: { kind?: string; path?: string } | undefined
  ): Insertion | null => {
    const cur = docRef.current;
    if (!cur || !activeData || !overData) return null;

    // Layout preset: drop indicator at the end of the body (root-append) or
    // after the hovered block's section.
    if (activeData.kind === "palette-layout") {
      if (overData.kind === "canvas-root") return { kind: "root-append" };
      if (overData.kind === "overlay-block" && overData.path) {
        const targetPath = parsePathKey(overData.path);
        const idx = targetPath[0] ?? Math.max(cur.body.length - 1, 0);
        return { kind: "after", anchorPath: [idx] };
      }
      return null;
    }

    if (activeData.kind === "palette" && activeData.type) {
      const draggedType = activeData.type;
      if (overData.kind === "canvas-root") {
        return resolveInsertion(cur.body, null, draggedType);
      }
      if (overData.kind === "overlay-block" && overData.path) {
        return resolveInsertion(
          cur.body,
          parsePathKey(overData.path),
          draggedType
        );
      }
      return null;
    }

    if (
      activeData.kind === "overlay-block" &&
      activeData.path &&
      overData.kind === "overlay-block" &&
      overData.path &&
      activeData.path !== overData.path
    ) {
      const sourcePath = parsePathKey(activeData.path);
      const overPath = parsePathKey(overData.path);
      const next = reorderInDoc(cur, sourcePath, overPath);
      if (!next) return null;
      return { kind: "after", anchorPath: overPath };
    }

    return null;
  };

  const handleDragOver = (event: DragOverEvent): void => {
    const activeData = event.active.data?.current as
      | { kind?: string; type?: BlockType; path?: string }
      | undefined;
    const overData = event.over?.data?.current as
      | { kind?: string; id?: string; type?: BlockType; path?: string }
      | undefined;
    setDropPreview(computeDropPreview(activeData, overData));
  };

  // Drag handler: palette drop into canvas, OR overlay-block reorder (H5).
  const handleDragEnd = (event: DragEndEvent) => {
    setDragActive(false);
    setDropPreview(null);
    const cur = docRef.current;
    if (!cur) return;

    const activeData = event.active.data?.current as
      | { kind?: string; type?: BlockType; path?: string; columns?: number }
      | undefined;
    const overData = event.over?.data?.current as
      | { kind?: string; id?: string; type?: BlockType; path?: string }
      | undefined;
    if (!activeData || !overData) return;

    // Layout preset: drop a full <mj-section> containing N empty <mj-column>s.
    if (activeData.kind === "palette-layout") {
      const cols = activeData.columns;
      if (!cols || !Number.isInteger(cols) || cols < 1 || cols > 3) return;
      const section = defaultBlock("mj-section");
      section.children = Array.from({ length: cols }, () => defaultBlock("mj-column"));

      let insertIdx: number;
      if (overData.kind === "canvas-root") {
        insertIdx = cur.body.length;
      } else if (overData.kind === "overlay-block" && overData.path) {
        const targetPath = parsePathKey(overData.path);
        insertIdx = (targetPath[0] ?? cur.body.length - 1) + 1;
      } else {
        return;
      }
      if (q.locked) return;
      const next: MjmlDocument = {
        ...cur,
        body: [...cur.body.slice(0, insertIdx), section, ...cur.body.slice(insertIdx)],
      };
      setDoc(next);
      void persistDoc(next);
      return;
    }

    // H5: in-canvas reorder — overlay-block dragged onto another overlay-block.
    if (
      activeData.kind === "overlay-block" &&
      overData.kind === "overlay-block"
    ) {
      const sourceKey = activeData.path;
      const overKey = overData.path;
      if (!sourceKey || !overKey) return;
      // Drop on self → no-op.
      if (sourceKey === overKey) return;
      const sourcePath = parsePathKey(sourceKey);
      const overPath = parsePathKey(overKey);
      // reorderInDoc handles cycle prevention + allowedChildren validation;
      // returns null on any invalid move.
      const next = reorderInDoc(cur, sourcePath, overPath);
      if (!next) return;
      if (q.locked) {
        // v2 has no in-flight buffer/replay — drops while Claude runs are
        // simply ignored. The UI is locked at the panel level too.
        return;
      }
      setDoc(next);
      void persistDoc(next);
      return;
    }

    const draggedType =
      activeData.kind === "palette" ? (activeData.type as BlockType) : null;
    if (!draggedType) return;

    let result: InsertResult;
    if (overData.kind === "canvas-root") {
      result = insertPaletteBlock(cur.body, null, draggedType);
    } else if (overData.kind === "overlay-block") {
      if (!overData.path) return;
      const targetPath = parsePathKey(overData.path);
      result = insertPaletteBlock(cur.body, targetPath, draggedType);
    } else {
      return;
    }
    if (result.insertedPath.length === 0) return;

    const next: MjmlDocument = { ...cur, body: result.body };

    if (q.locked) {
      return;
    }

    setDoc(next);

    if (draggedType === "mj-custom-passthrough") {
      setSelectedPath(result.insertedPath);
      setSelectedFingerprint(null);
    }

    void persistDoc(next);
  };

  /**
   * Compute the ordinal among same-type blocks for an inline-edit BEGIN.
   * The iframe's bootstrap script matches the Nth element by `expectedText`,
   * so we can simply pass `0` and trust textContent equality (both
   * mj-text/mj-button render to a leaf-like cell containing `node.text`). If
   * multiple blocks share the same text we fall back to the document-order
   * count of preceding same-type blocks with identical text.
   */
  const computeInlineOrdinal = (
    body: TreeNode[],
    targetPath: number[],
    targetText: string
  ): number => {
    let ordinal = 0;
    let stop = false;
    const walk = (arr: TreeNode[], path: number[]): void => {
      for (let i = 0; i < arr.length && !stop; i++) {
        const n = arr[i];
        if (!n) continue;
        const here = [...path, i];
        if (arraysEqual(here, targetPath)) {
          stop = true;
          return;
        }
        if (isBlockNode(n)) {
          if (
            (n.type === "mj-text" || n.type === "mj-button") &&
            (n.text ?? "") === targetText
          ) {
            ordinal++;
          }
          if (n.children) walk(n.children, here);
        }
      }
    };
    walk(body, []);
    return ordinal;
  };

  /** Double-click on overlay → begin inline edit, if applicable. */
  const handleOverlayDoubleClick = (key: string): void => {
    if (!docRef.current) return;
    if (q.locked) return; // can't begin while Claude is writing
    const path = parsePathKey(key);
    const node = resolveNode(docRef.current.body, path);
    if (!node || !isBlockNode(node)) return;
    if (node.type !== "mj-text" && node.type !== "mj-button") return;
    const text = node.text ?? "";
    if (!text) return;
    editingPathRef.current = path;
    const ordinal = computeInlineOrdinal(docRef.current.body, path, text);
    inlineEditControlRef.current?.beginEdit(ordinal, text);
  };

  /** Inline-edit commit (blur) — write back the new text, persist source. */
  const handleInlineCommit = (newText: string): void => {
    const cur = docRef.current;
    const editPath = editingPathRef.current;
    editingPathRef.current = null;
    if (!cur || !editPath) return;
    const cloned = structuredClone(cur.body) as TreeNode[];
    const target = resolveNode(cloned, editPath);
    if (!target || !isBlockNode(target)) return;
    if (target.type !== "mj-text" && target.type !== "mj-button") return;
    target.text = newText;
    const next: MjmlDocument = { ...cur, body: cloned };
    const nextSource = serializeMjml(next);
    setDoc(next);
    setSource(nextSource);
    void persistSource(nextSource, "browser-inline-text");
  };

  // Terminal: template was deleted (404 on PATCH). Bounce to /templates.
  if (data.templateDeleted) {
    return <Navigate to="/templates" replace />;
  }

  if (data.loadError) {
    return (
      <div className="canvas-error">
        Failed to load email: {data.loadError.status} {String(data.loadError.body)}
      </div>
    );
  }

  if (!doc) {
    return <div className="canvas-loading">Loading...</div>;
  }

  const selectedKey = selectedPath ? selectedPath.join("/") : null;
  const frameMaxWidth = viewportMode === "mobile" ? 320 : 600;
  // Content-derived render key — IframePreview's [source, currentRevision]
  // effect now only fires when source content actually changes (self-PATCH
  // version bumps no longer trigger spurious renders). Per ralplan §7.4.
  // Cheap djb2 hash; collisions are acceptable since we only need a value
  // that differs when content differs.
  let revToken = 5381;
  for (let i = 0; i < source.length; i++) revToken = (revToken * 33) ^ source.charCodeAt(i);
  revToken = revToken >>> 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={() => setDragActive(true)}
      onDragOver={handleDragOver}
      onDragCancel={() => {
        setDragActive(false);
        setDropPreview(null);
      }}
      onDragEnd={handleDragEnd}
    >
      <div className="canvas-shell">
        <IconRail />
        <CanvasMain outerRef={canvasMainRef}>
          {(data.status === "saving" || data.status === "saved" || data.status === "error") && (
            <div
              className={`save-status-chip save-status-chip-${data.status}`}
              role={data.status === "error" ? "alert" : "status"}
            >
              {data.status === "saving" && "Saving…"}
              {data.status === "saved" && "Saved"}
              {data.status === "error" && (
                <>
                  Save error <button type="button" onClick={() => void acts.forceSave()}>retry</button>
                </>
              )}
            </div>
          )}
          {data.apiKeyMissing && (
            <div className="canvas-banner" role="alert">
              ANTHROPIC_API_KEY is not set on the server. <a href="/settings">Open settings</a>
            </div>
          )}
          {q.locked && (
            <div className="canvas-banner canvas-banner-info">
              Claude is writing — DnD is paused
            </div>
          )}
          <DeviceToggle
            value={viewportMode}
            onChange={(mode) => {
              setViewportMode(mode);
            }}
          />
          <div
            ref={canvasFrameRef}
            className="canvas-frame"
            style={{ maxWidth: frameMaxWidth, position: "relative" }}
            onMouseLeave={() => setHoveredPath(null)}
          >
            <IframePreview
              ref={iframeRef}
              source={source}
              currentRevision={revToken}
              viewportMode={viewportMode}
              onBboxReport={onBboxReport}
              passThroughPointerEvents={dragActive}
            />
            <OverlayTree
              bboxes={liveBboxes}
              selectedPathKey={selectedKey}
              hoveredPathKey={hoveredPath}
              onSelect={selectByPathKey}
              onHover={(key) => setHoveredPath(key)}
              onDoubleClick={handleOverlayDoubleClick}
              toolbarHandlers={{
                onMoveUp,
                onMoveDown,
                onDuplicate,
                onDelete,
              }}
              breadcrumb={breadcrumb}
              onBreadcrumbSelect={selectByPathKey}
              inlineEditActive={false}
              dragActive={dragActive}
              dropIndicator={dropPreview}
            />
          </div>
          <InlineTextEditor
            iframeRef={iframeRef}
            controlRef={inlineEditControlRef}
            onCommit={handleInlineCommit}
          />
          {data.conflictToast && (
            <div className="toast-claude-mid-edit" data-testid="conflict-toast" role="alert">
              <span>This template was updated elsewhere. Latest server version loaded.</span>
              <div className="toast-claude-mid-edit-actions">
                <button type="button" onClick={() => acts.dismissConflictToast()}>Dismiss</button>
              </div>
            </div>
          )}
          {data.rateLimitToast && (
            <div className="toast-claude-mid-edit" data-testid="rate-limit-toast" role="alert">
              <span>Rate-limited. Try again in a few minutes.</span>
              <div className="toast-claude-mid-edit-actions">
                <button type="button" onClick={() => acts.dismissRateLimitToast()}>Dismiss</button>
              </div>
            </div>
          )}
        </CanvasMain>
        <RightPanel
          doc={doc}
          selectedPath={selectedPath}
          onSelectionChange={(path) => setSelectedPath(path)}
          onCommit={(newSource: string) => persistSource(newSource, "browser-attr-form")}
        />
      </div>
      <DragLayer />
    </DndContext>
  );
}

