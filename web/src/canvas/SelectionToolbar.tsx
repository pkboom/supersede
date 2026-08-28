/**
 * SelectionToolbar — floating toolbar with EXACTLY 3 buttons.
 *
 * Layout (left → right): [move][duplicate][delete] — Lucide icons.
 *
 * The "move" button design choice (per AC #8 "exactly 3 buttons"): we use a
 * single combined ↕ button. Plain click → moveDown (most common reorder
 * gesture, advances list); Shift+click → moveUp. This keeps the toolbar at
 * exactly 3 root buttons while preserving both directions. Boundary
 * handling: when `onMoveUp` / `onMoveDown` is undefined the corresponding
 * gesture is a no-op; the button stays enabled iff EITHER direction is
 * reachable so the user can still attempt the other direction.
 *
 * (An alternative — a popover with up/down — was considered but adds an
 * extra render layer + click-outside handling for a v1 toolbar. We can
 * revisit if shift-click discovery proves too obscure in usability tests.)
 */
import type { MouseEvent } from "react";
import { ArrowUpDown, Copy, Trash2 } from "lucide-react";

interface SelectionToolbarProps {
  /** Undefined when the selected block is at the top boundary. */
  onMoveUp?: () => void;
  /** Undefined when the selected block is at the bottom boundary. */
  onMoveDown?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function SelectionToolbar({
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
}: SelectionToolbarProps) {
  const moveDisabled = !onMoveUp && !onMoveDown;
  const handleMoveClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.shiftKey) {
      onMoveUp?.();
    } else {
      // Default click → down. If down is unreachable (last item) but up is
      // reachable, fall back to up so a single click still does *something*.
      if (onMoveDown) onMoveDown();
      else onMoveUp?.();
    }
  };

  return (
    <div className="selection-toolbar" role="toolbar" aria-label="Block actions">
      <button
        type="button"
        className="selection-toolbar-btn"
        aria-label="Move (shift-click for up)"
        title="Click: move down. Shift+Click: move up."
        disabled={moveDisabled}
        onClick={handleMoveClick}
      >
        <ArrowUpDown size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="selection-toolbar-btn"
        aria-label="Duplicate"
        title="Duplicate block"
        onClick={onDuplicate}
      >
        <Copy size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="selection-toolbar-btn"
        aria-label="Delete"
        title="Delete block"
        onClick={onDelete}
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
