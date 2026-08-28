// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as templatesApi from "../../web/src/api/templates.js";
import { SidebarShell } from "../../web/src/sidebar/SidebarShell.js";

const SUMMARIES = [
  { id: "a", name: "First", description: null, updatedAt: new Date(0).toISOString() },
  { id: "b", name: "Second", description: null, updatedAt: new Date(0).toISOString() },
];

beforeEach(() => {
  vi.spyOn(templatesApi, "listTemplates").mockResolvedValue(SUMMARIES);
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

function PlaceholderA() {
  const nav = useNavigate();
  return (
    <div data-testid="route-a">
      A
      <button type="button" onClick={() => nav("/templates/b")}>go-b</button>
    </div>
  );
}
function PlaceholderB() {
  return <div data-testid="route-b">B</div>;
}

describe("<SidebarShell/>", () => {
  it("does not remount the rail across /templates/:id swaps (single GET total)", async () => {
    render(
      <MemoryRouter initialEntries={["/templates/a"]}>
        <Routes>
          <Route element={<SidebarShell />}>
            <Route path="/templates/a" element={<PlaceholderA />} />
            <Route path="/templates/b" element={<PlaceholderB />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await tick();
    expect(screen.getByTestId("route-a")).toBeTruthy();
    expect(screen.getByText("First")).toBeTruthy();

    // Programmatic navigation through useNavigate keeps the same router root
    // mounted; only the <Outlet/> child swaps. The sidebar (parent route)
    // must not remount.
    await act(async () => {
      fireEvent.click(screen.getByText("go-b"));
    });
    await tick();
    expect(screen.getByTestId("route-b")).toBeTruthy();
    // listTemplates is called once total (one GET on initial mount). If the
    // sibling-layout in SidebarShell remounted on navigation, this would be 2+.
    expect(templatesApi.listTemplates).toHaveBeenCalledTimes(1);
  });
});
