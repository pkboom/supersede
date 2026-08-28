// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../web/src/api/client.js";
import * as templatesApi from "../../web/src/api/templates.js";
import { TemplateList } from "../../web/src/sidebar/TemplateList.js";

const SUMMARIES = [
  { id: "a", name: "First", description: null, updatedAt: new Date(0).toISOString() },
  { id: "b", name: "Second", description: null, updatedAt: new Date(0).toISOString() },
];

beforeEach(() => {
  vi.spyOn(templatesApi, "listTemplates").mockResolvedValue(SUMMARIES);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function tick(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderList() {
  return render(
    <MemoryRouter>
      <TemplateList />
    </MemoryRouter>,
  );
}

describe("<TemplateList/>", () => {
  it("loads + renders templates from GET /api/templates", async () => {
    renderList();
    await tick();
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
  });

  it("'+ New' calls createTemplate and prepends the new row", async () => {
    const created = {
      id: "new",
      name: "Untitled",
      description: null,
      mjml: "<mjml/>",
      version: 1,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    vi.spyOn(templatesApi, "createTemplate").mockResolvedValue(created);
    renderList();
    await tick();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    });
    await tick();
    expect(templatesApi.createTemplate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Untitled")).toBeTruthy();
  });

  it("delete optimistically removes the row + rolls back on failure", async () => {
    vi.spyOn(templatesApi, "deleteTemplate").mockRejectedValueOnce(new ApiError(500, {}));
    renderList();
    await tick();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete First" }));
    });
    await tick();
    // Rolled back — still in the list.
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Delete failed");
  });

  it("delete success removes the row permanently", async () => {
    vi.spyOn(templatesApi, "deleteTemplate").mockResolvedValueOnce(undefined as unknown as void);
    renderList();
    await tick();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete First" }));
    });
    await tick();
    expect(screen.queryByText("First")).toBeNull();
    expect(screen.getByText("Second")).toBeTruthy();
  });

  it("renders an empty state when GET returns []", async () => {
    (templatesApi.listTemplates as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    renderList();
    await tick();
    expect(screen.getByText("No templates yet.")).toBeTruthy();
  });
});
