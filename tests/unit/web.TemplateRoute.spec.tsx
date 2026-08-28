// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../web/src/api/client.js";
import * as templatesApi from "../../web/src/api/templates.js";
import { TemplateRoute } from "../../web/src/routes/TemplateRoute.js";
import { TemplateEmpty } from "../../web/src/routes/TemplateEmpty.js";
import { TemplateProviders } from "../../web/src/routes/TemplateProviders.js";

/**
 * TemplateRoute renders <Canvas/> from the data Context provided by
 * <TemplateProviders/> (now lifted up to <SidebarShell/>). The full canvas
 * is too heavy for jsdom (iframe + DnD + postMessage), so these tests cover
 * the surface that doesn't reach Canvas: loading, 404→Navigate, other-load-
 * error fallback. We wrap TemplateRoute with TemplateProviders directly so
 * the hooks can run without booting the whole SidebarShell.
 */

beforeEach(() => {
  // Default: never resolves. Tests override per-case.
  vi.spyOn(templatesApi, "getTemplate").mockImplementation(() => new Promise(() => undefined));
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

function WrappedTemplateRoute() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <TemplateEmpty />;
  return (
    <TemplateProviders id={id}>
      <TemplateRoute />
    </TemplateProviders>
  );
}

function renderRoute(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/templates" element={<TemplateEmpty />} />
        <Route path="/templates/:id" element={<WrappedTemplateRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("<TemplateRoute/>", () => {
  it("renders Loading… while the GET is in-flight", async () => {
    renderRoute("/templates/abc");
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("on 404 → Navigate to /templates (TemplateEmpty)", async () => {
    (templatesApi.getTemplate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(404, { error: "gone" }),
    );
    renderRoute("/templates/missing");
    await tick();
    expect(screen.getByTestId("route-empty")).toBeTruthy();
  });

  it("on other load errors → renders the error fallback", async () => {
    (templatesApi.getTemplate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(500, { error: "boom" }),
    );
    renderRoute("/templates/abc");
    await tick();
    expect(screen.getByText(/Failed to load:/)).toBeTruthy();
  });
});
