// @vitest-environment jsdom
/**
 * web.IconRail.test — assert the icon rail's two-group shape:
 *   • Layout group: 3 row-preset draggables (1-, 2-, 3-column).
 *   • Content group: 7 leaf draggables (one per modeled content type +
 *     mj-custom-passthrough). Each carries a `data-block-type` attribute
 *     for the DnD palette dispatcher.
 *
 * mj-section and mj-column are intentionally absent from the rail in v2 —
 * the user picks a Layout preset instead, and content blocks auto-find or
 * synthesize their wrapping section + column on drop.
 */
import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { DndContext } from "@dnd-kit/core";
import IconRail from "../../web/src/canvas/IconRail.js";

afterEach(() => {
  cleanup();
});

describe("<IconRail />", () => {
  it("renders 7 content items with data-block-type covering every leaf type", () => {
    const { container } = render(
      <DndContext>
        <IconRail />
      </DndContext>,
    );
    const items = container.querySelectorAll("[data-block-type]");
    expect(items.length).toBe(7);
    const types = Array.from(items).map((el) => el.getAttribute("data-block-type"));
    expect(types).toEqual([
      "mj-image",
      "mj-text",
      "mj-button",
      "mj-divider",
      "mj-spacer",
      "mj-social",
      "mj-custom-passthrough",
    ]);
  });

  it("renders 3 layout-preset draggables in a separate group", () => {
    const { container } = render(
      <DndContext>
        <IconRail />
      </DndContext>,
    );
    const groups = container.querySelectorAll(".icon-rail-group");
    expect(groups.length).toBe(2);
    const layoutGroup = groups[0]!;
    const layoutItems = layoutGroup.querySelectorAll(".icon-rail-item");
    expect(layoutItems.length).toBe(3);
    const labels = Array.from(layoutItems).map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual(["1 column", "2 columns", "3 columns"]);
  });
});
