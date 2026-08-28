// @vitest-environment jsdom
/**
 * web.SelectionToolbar.test — assert the toolbar has exactly 3 buttons in
 * order [move, duplicate, delete] and that clicking the delete button fires
 * onDelete.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import SelectionToolbar from "../../web/src/canvas/SelectionToolbar.js";

afterEach(() => {
  cleanup();
});

describe("<SelectionToolbar />", () => {
  it("renders exactly 3 buttons in the order [Move, Duplicate, Delete]", () => {
    const onMoveDown = vi.fn();
    const onMoveUp = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();

    render(
      <SelectionToolbar
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    );

    const toolbar = screen.getByRole("toolbar");
    const buttons = toolbar.querySelectorAll("button");
    expect(buttons.length).toBe(3);

    expect(buttons[0]!.getAttribute("aria-label")).toMatch(/move/i);
    expect(buttons[1]!.getAttribute("aria-label")).toMatch(/duplicate/i);
    expect(buttons[2]!.getAttribute("aria-label")).toMatch(/delete/i);
  });

  it("clicking the delete button calls onDelete", () => {
    const onDelete = vi.fn();
    render(
      <SelectionToolbar
        onDuplicate={() => {}}
        onDelete={onDelete}
      />
    );

    const deleteBtn = screen.getByRole("button", { name: /delete/i });
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("clicking the duplicate button calls onDuplicate", () => {
    const onDuplicate = vi.fn();
    render(
      <SelectionToolbar
        onDuplicate={onDuplicate}
        onDelete={() => {}}
      />
    );
    const dup = screen.getByRole("button", { name: /duplicate/i });
    fireEvent.click(dup);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });
});
