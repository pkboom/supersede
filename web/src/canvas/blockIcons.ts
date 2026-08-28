import {
  Code2,
  Columns3,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  MoveVertical,
  Rows3,
  Share2,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { BlockType } from "../blocks/index.js";

export const BLOCK_ICON: Record<BlockType, LucideIcon> = {
  "mj-section": Rows3,
  "mj-column": Columns3,
  "mj-image": ImageIcon,
  "mj-text": Type,
  "mj-button": MousePointerClick,
  "mj-divider": Minus,
  "mj-spacer": MoveVertical,
  "mj-social": Share2,
  // Not surfaced in the icon rail (only spawned as a child of mj-social), but
  // BLOCK_ICON is keyed by every BlockType for type-system completeness.
  "mj-social-element": Share2,
  "mj-custom-passthrough": Code2,
};
