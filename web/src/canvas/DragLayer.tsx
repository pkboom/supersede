import { DragOverlay, useDndMonitor } from "@dnd-kit/core";
import { useState } from "react";
import { BLOCK_REGISTRY } from "../blocks/index.js";
import type { BlockType } from "../blocks/index.js";
import { BLOCK_ICON } from "./blockIcons.js";

export function DragLayer() {
  const [activeType, setActiveType] = useState<BlockType | null>(null);

  useDndMonitor({
    onDragStart(event) {
      const data = event.active.data?.current as { type?: BlockType } | undefined;
      if (data?.type) setActiveType(data.type);
    },
    onDragEnd() {
      setActiveType(null);
    },
    onDragCancel() {
      setActiveType(null);
    },
  });

  const Icon = activeType ? BLOCK_ICON[activeType] : null;
  const label = activeType ? BLOCK_REGISTRY[activeType].label : null;

  return (
    <DragOverlay dropAnimation={null}>
      {activeType && Icon ? (
        <div className="drag-preview" role="presentation">
          <Icon className="drag-preview-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="drag-preview-label">{label}</span>
        </div>
      ) : null}
    </DragOverlay>
  );
}
