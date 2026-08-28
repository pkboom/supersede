/**
 * IconRail — narrow icon-only block palette (left rail).
 *
 * Split into two groups:
 *   • Layout — preset rows (1-, 2-, 3-column section templates). Dragging
 *     one creates a full `<mj-section>` with N empty `<mj-column>` children
 *     in a single drop.
 *   • Content — leaf blocks (text, image, button, …). Dragging one drops
 *     into an existing column, synthesizes a column inside an existing
 *     section, or synthesizes section+column at the root — whatever the
 *     drop target needs to land cleanly. The user never has to "create a
 *     section first."
 *
 * Drag payload (`data.current` on the active draggable):
 *   • { kind: "palette",        type: BlockType }            ← content
 *   • { kind: "palette-layout", columns: 1 | 2 | 3 }         ← layout preset
 */
import { useDraggable } from "@dnd-kit/core";
import { Columns2, Columns3, Square, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BlockType } from "../blocks/index.js";
import { BLOCK_REGISTRY } from "../blocks/index.js";
import { BLOCK_ICON } from "./blockIcons.js";

const CONTENT_TYPES: BlockType[] = [
  "mj-image",
  "mj-text",
  "mj-button",
  "mj-divider",
  "mj-spacer",
  "mj-social",
  "mj-custom-passthrough",
];

interface LayoutPreset {
  id: string;
  columns: 1 | 2 | 3;
  label: string;
  Icon: LucideIcon;
}

const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: "row-1", columns: 1, label: "1 column",  Icon: Square },
  { id: "row-2", columns: 2, label: "2 columns", Icon: Columns2 },
  { id: "row-3", columns: 3, label: "3 columns", Icon: Columns3 },
];

interface RailDragItemProps {
  id: string;
  label: string;
  Icon: LucideIcon;
  data: Record<string, unknown>;
  dataAttr?: string;
}

function RailDragItem({ id, label, Icon, data, dataAttr }: RailDragItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data });
  const itemRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<{ left: number; top: number } | null>(null);

  const setRefs = (node: HTMLDivElement | null): void => {
    setNodeRef(node);
    itemRef.current = node;
  };

  const showTooltip = (): void => {
    const rect = itemRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ left: rect.right + 6, top: rect.top + rect.height / 2 });
  };

  const hideTooltip = (): void => setTooltip(null);

  return (
    <>
      <div
        ref={setRefs}
        {...listeners}
        {...attributes}
        className="icon-rail-item"
        data-block-type={dataAttr}
        style={{ opacity: isDragging ? 0.4 : 1 }}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        aria-label={label}
      >
        <Icon className="icon-rail-glyph" size={20} strokeWidth={1.75} aria-hidden="true" />
      </div>
      {tooltip && !isDragging
        ? createPortal(
            <div
              className="icon-rail-tooltip"
              role="tooltip"
              style={{ left: tooltip.left, top: tooltip.top }}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export default function IconRail() {
  return (
    <aside className="icon-rail" aria-label="Block palette">
      <div className="icon-rail-group" role="group" aria-label="Layout">
        {LAYOUT_PRESETS.map((p) => (
          <RailDragItem
            key={p.id}
            id={`palette-${p.id}`}
            label={p.label}
            Icon={p.Icon}
            data={{ kind: "palette-layout", columns: p.columns }}
          />
        ))}
      </div>
      <div className="icon-rail-divider" aria-hidden="true" />
      <div className="icon-rail-group" role="group" aria-label="Content">
        {CONTENT_TYPES.map((t) => (
          <RailDragItem
            key={t}
            id={`palette-${t}`}
            label={BLOCK_REGISTRY[t].label}
            Icon={BLOCK_ICON[t]}
            data={{ kind: "palette", type: t }}
            dataAttr={t}
          />
        ))}
      </div>
    </aside>
  );
}
