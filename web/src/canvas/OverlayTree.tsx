/**
 * OverlayTree — F3-prime piece 2 (absolute-positioned overlay layer).
 *
 * Receives a `bboxes` Map keyed by serialized path (e.g. "0/0/1") to a
 * `Rect`. Renders ONE `<div>` per entry positioned over the iframe at the
 * reported coordinates. The currently-selected path also renders the
 * `<SelectionToolbar>` inline.
 *
 * The container is `pointer-events: none` so the iframe still receives
 * clicks; each overlay div re-enables `pointer-events: auto` so click /
 * hover hits work for selection. The toolbar inside the selected overlay
 * also re-enables pointer events.
 *
 * H4 (hover): each overlay reports `mouseenter` / `mouseleave` to set the
 * store-level `hoveredPath`. Hover is gated on `!inlineEditActive &&
 * !dragActive` so a drag does not trigger cascade re-renders that would
 * shift `getBoundingClientRect()` mid-drag.
 *
 * H5 (drag-to-reorder): each overlay is BOTH `useDraggable` and
 * `useDroppable` (composed refs) under `kind: "overlay-block"`, with `path`
 * carrying the pathKey. `Canvas.handleDragEnd` consumes the
 * (active.path, over.path) pair and routes through `reorderInDoc`.
 *
 * Render-order is area-descending so smaller overlays paint last (and
 * `mouseenter` — which doesn't bubble — fires on the deepest element under
 * the cursor). Z-index keeps selected on top of hovered, which keeps
 * hovered on top of base.
 *
 * Selection breadcrumb: when `breadcrumb` is provided, renders a clickable
 * ancestor chain pinned just above the selected box — e.g.
 * `Section › Column › Image`. The trailing segment is the current selection
 * (rendered emphasized, non-interactive); preceding segments call
 * `onBreadcrumbSelect(pathKey)` to promote selection up the tree, matching
 * Stripo / Beefree conventions for nested-block navigation.
 */
import { useDraggable, useDroppable } from "@dnd-kit/core";
import SelectionToolbar from "./SelectionToolbar.js";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Drop indicator descriptor mirrored from `Canvas.Insertion`. Decoupled here
 * to avoid a circular import; the shape must stay in lockstep.
 *
 *   - `root-append`  → render a horizontal line at the bottom of the canvas
 *     content (or top when the canvas is empty).
 *   - `after`        → render a horizontal line at the bottom edge of
 *     `anchorPath`'s bbox.
 *   - `inside`       → render a dashed outline around `containerPath`'s bbox.
 */
export type DropIndicator =
  | { kind: "root-append" }
  | { kind: "after"; anchorPath: number[] }
  | { kind: "inside"; containerPath: number[] };

interface ToolbarHandlers {
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export interface BreadcrumbItem {
  /** Human-readable type label, e.g. "Section", "Column", "Image". */
  label: string;
  /** Path key of this ancestor (parser format, e.g. "0/0/1"). */
  pathKey: string;
  /** True when this segment IS the current selection (terminal entry). */
  isSelected: boolean;
}

interface OverlayTreeProps {
  bboxes: Map<string, Rect>;
  selectedPathKey: string | null;
  /** H4: pathKey of the currently-hovered overlay (null when none). */
  hoveredPathKey: string | null;
  onSelect: (pathKey: string) => void;
  /** H4: called on mouseenter (with pathKey) and mouseleave (with null). */
  onHover: (pathKey: string | null) => void;
  /**
   * Optional double-click handler: triggered on the overlay div for `mj-text`
   * / `mj-button` paths. Canvas owns the inline-edit dispatch; this just
   * surfaces the path that was double-clicked.
   */
  onDoubleClick?: (pathKey: string) => void;
  toolbarHandlers: ToolbarHandlers;
  /**
   * Selection ancestor chain. The last entry is the current selection
   * (rendered as the primary label); earlier entries promote selection up the
   * tree on click.
   */
  breadcrumb?: BreadcrumbItem[];
  /** Click on a non-terminal breadcrumb segment → select that ancestor. */
  onBreadcrumbSelect?: (pathKey: string) => void;
  /**
   * When true, the overlay boxes pass pointer events through to the iframe
   * underneath so the user can position the caret, drag-select, and edit text
   * inside the active contenteditable element. The selected box still renders
   * the toolbar (with its own `pointer-events: auto`).
   */
  inlineEditActive?: boolean;
  /** H4: when true, suppress hover-state updates so a drag freezes hover. */
  dragActive?: boolean;
  /**
   * Live drop-target preview. When non-null, renders an industry-standard
   * blue insertion line ("after" / "root-append") or container outline
   * ("inside") at the resolved insertion site. The descriptor comes from
   * `Canvas.computeDropPreview`, which uses the same helpers that commit the
   * actual drop, so the preview cannot disagree with the result.
   */
  dropIndicator?: DropIndicator | null;
}

interface OverlayBoxProps {
  pathKey: string;
  rect: Rect;
  isSelected: boolean;
  isHovered: boolean;
  inlineEditActive: boolean;
  dragActive: boolean;
  onSelect: (pathKey: string) => void;
  onHover: (pathKey: string | null) => void;
  onDoubleClick?: (pathKey: string) => void;
  breadcrumb?: BreadcrumbItem[];
  onBreadcrumbSelect?: (pathKey: string) => void;
  toolbarHandlers: ToolbarHandlers;
}

function setRefs<T>(...refs: Array<(node: T | null) => void>) {
  return (node: T | null): void => {
    for (const r of refs) r(node);
  };
}

function OverlayBox({
  pathKey,
  rect,
  isSelected,
  isHovered,
  inlineEditActive,
  dragActive,
  onSelect,
  onHover,
  onDoubleClick,
  breadcrumb,
  onBreadcrumbSelect,
  toolbarHandlers,
}: OverlayBoxProps) {
  // H5: each overlay is BOTH a draggable source AND a drop target so
  // dragging one block onto another can reorder them.
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
  } = useDraggable({
    id: `overlay-drag-${pathKey}`,
    data: { kind: "overlay-block", path: pathKey },
    disabled: inlineEditActive,
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: `overlay-drop-${pathKey}`,
    data: { kind: "overlay-block", path: pathKey },
    disabled: inlineEditActive,
  });

  // PointerSensor is configured in Canvas with activationConstraint
  // { distance: 4 }, so spreading drag listeners on this div lets a click
  // remain a click (hold + move > 4px starts the drag).
  return (
    <div
      ref={setRefs<HTMLDivElement>(setDragRef, setDropRef)}
      data-path={pathKey}
      className={`overlay-box${isSelected ? " selected" : ""}${
        isHovered ? " hovered" : ""
      }`}
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        pointerEvents: inlineEditActive ? "none" : "auto",
      }}
      {...attributes}
      {...listeners}
      onMouseEnter={(e) => {
        if (inlineEditActive || dragActive) return;
        e.stopPropagation();
        onHover(pathKey);
      }}
      onMouseLeave={(e) => {
        if (inlineEditActive || dragActive) return;
        e.stopPropagation();
        onHover(null);
      }}
      onClick={(e) => {
        if (inlineEditActive) return;
        e.stopPropagation();
        onSelect(pathKey);
      }}
      onDoubleClick={(e) => {
        if (inlineEditActive) return;
        if (!onDoubleClick) return;
        e.stopPropagation();
        onDoubleClick(pathKey);
      }}
    >
      {isSelected && breadcrumb && breadcrumb.length > 0 ? (
        <div
          className="overlay-breadcrumb"
          role="navigation"
          aria-label="Selection path"
          // Stop pointer/drag escalation so clicking a crumb doesn't also
          // re-trigger the overlay-box select handler or start a drag.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{ pointerEvents: "auto" }}
        >
          {breadcrumb.map((item, i) => (
            <span key={item.pathKey} className="overlay-breadcrumb-segment">
              {i > 0 ? (
                <span className="overlay-breadcrumb-sep" aria-hidden="true">
                  ›
                </span>
              ) : null}
              <button
                type="button"
                className={`overlay-breadcrumb-item${
                  item.isSelected ? " current" : ""
                }`}
                disabled={item.isSelected}
                onClick={() => {
                  if (!item.isSelected) onBreadcrumbSelect?.(item.pathKey);
                }}
              >
                {item.label}
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {isSelected && !inlineEditActive ? (
        <div
          className="overlay-toolbar-wrap"
          onClick={(e) => e.stopPropagation()}
          style={{ pointerEvents: "auto" }}
        >
          <SelectionToolbar
            onMoveUp={toolbarHandlers.onMoveUp}
            onMoveDown={toolbarHandlers.onMoveDown}
            onDuplicate={toolbarHandlers.onDuplicate}
            onDelete={toolbarHandlers.onDelete}
          />
        </div>
      ) : null}
    </div>
  );
}

function renderDropIndicator(
  indicator: DropIndicator,
  bboxes: Map<string, Rect>
): JSX.Element | null {
  if (indicator.kind === "root-append") {
    // Anchor at the bottom of the deepest top-level bbox so the line lands at
    // the seam *after* the last block. Empty canvas → top-of-frame.
    let maxBottom = 0;
    bboxes.forEach((r, key) => {
      // Only consider top-level (root section) bboxes — paths like "0", "1".
      // Children would yield a higher bottom only when the section's own
      // bbox is missing, which shouldn't happen in steady state.
      if (!key.includes("/")) {
        const bottom = r.y + r.h;
        if (bottom > maxBottom) maxBottom = bottom;
      }
    });
    return (
      <div
        className="drop-indicator-line drop-indicator-line-root"
        data-testid="drop-indicator"
        style={{ top: maxBottom }}
      />
    );
  }
  if (indicator.kind === "after") {
    const key = indicator.anchorPath.join("/");
    const rect = bboxes.get(key);
    if (!rect) return null;
    return (
      <div
        className="drop-indicator-line"
        data-testid="drop-indicator"
        style={{ left: rect.x, top: rect.y + rect.h - 1, width: rect.w }}
      />
    );
  }
  // inside
  const key = indicator.containerPath.join("/");
  const rect = bboxes.get(key);
  if (!rect) return null;
  return (
    <div
      className="drop-indicator-outline"
      data-testid="drop-indicator"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    />
  );
}

export default function OverlayTree({
  bboxes,
  selectedPathKey,
  hoveredPathKey,
  onSelect,
  onHover,
  onDoubleClick,
  toolbarHandlers,
  breadcrumb,
  onBreadcrumbSelect,
  inlineEditActive,
  dragActive,
  dropIndicator,
}: OverlayTreeProps) {
  // H4: render in area-descending order so smaller overlays paint LAST
  // (i.e. on top in DOM order). Combined with `mouseenter` not bubbling,
  // this ensures the cursor entering a small box wins the hover hit.
  const sorted = Array.from(bboxes.entries()).sort(
    ([, a], [, b]) => b.w * b.h - a.w * a.h
  );
  return (
    <div
      className="overlay-tree"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
      }}
    >
      {sorted.map(([pathKey, rect]) => {
        const isSelected = pathKey === selectedPathKey;
        const isHovered = pathKey === hoveredPathKey;
        return (
          <OverlayBox
            key={pathKey}
            pathKey={pathKey}
            rect={rect}
            isSelected={isSelected}
            isHovered={isHovered}
            inlineEditActive={!!inlineEditActive}
            dragActive={!!dragActive}
            onSelect={onSelect}
            onHover={onHover}
            onDoubleClick={onDoubleClick}
            breadcrumb={breadcrumb}
            onBreadcrumbSelect={onBreadcrumbSelect}
            toolbarHandlers={toolbarHandlers}
          />
        );
      })}
      {dropIndicator ? renderDropIndicator(dropIndicator, bboxes) : null}
    </div>
  );
}
