import { Navigate, useParams } from "react-router-dom";
import { Canvas } from "../canvas/Canvas.js";
import { useTemplateData } from "../hooks/useTemplate.js";

/**
 * Renders the canvas for `/templates/:id`. Provider mounting lives on
 * `<SidebarShell/>` so the sidebar's Ask-Claude input can consume the same
 * `useTemplate` + `useQueryRunner` instances. Here we only consume.
 *
 * The route still owns the load/error guards because the canvas should only
 * mount once data is available.
 */
export function TemplateRoute() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/templates" replace />;
  const data = useTemplateData();

  if (data.loading) return <div className="route-loading">Loading…</div>;
  if (data.loadError?.status === 404) return <Navigate to="/templates" replace />;
  if (data.loadError) {
    const body = data.loadError.body;
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : data.loadError.message;
    return <div className="route-error">Failed to load: {message}</div>;
  }

  return (
    <div className="template-editor">
      <Canvas />
    </div>
  );
}
