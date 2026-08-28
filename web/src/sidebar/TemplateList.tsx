import { useCallback, useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client.js";
import {
  type TemplateSummary,
  createTemplate,
  deleteTemplate,
  listTemplates,
} from "../api/templates.js";

/**
 * Sidebar template list — GET on mount, optimistic create + delete with
 * rollback on failure. Persists across `/templates/:id` swaps because it
 * lives inside `<SidebarShell/>` (a parent route).
 */
export function TemplateList() {
  const [rows, setRows] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const ctrl = new AbortController();
    listTemplates(ctrl.signal)
      .then((r) => {
        if (!mountedRef.current) return;
        setRows(r);
        setLoading(false);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof ApiError ? `HTTP ${err.status}` : String(err));
        setLoading(false);
      });
    return () => {
      mountedRef.current = false;
      ctrl.abort();
    };
  }, []);

  const onCreate = useCallback(async () => {
    const name = `Untitled ${new Date().toLocaleDateString()}`;
    try {
      const row = await createTemplate({ name });
      if (!mountedRef.current) return;
      setRows((rs) => [
        { id: row.id, name: row.name, description: row.description, updatedAt: row.updatedAt },
        ...rs,
      ]);
      navigate(`/templates/${row.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? `Create failed: HTTP ${err.status}` : String(err));
    }
  }, [navigate]);

  const onDelete = useCallback(async (id: string) => {
    if (!window.confirm("Delete this template?")) return;
    const previous = rows;
    setRows(rows.filter((r) => r.id !== id));
    try {
      await deleteTemplate(id);
    } catch (err) {
      if (!mountedRef.current) return;
      // Rollback.
      setRows(previous);
      setError(err instanceof ApiError ? `Delete failed: HTTP ${err.status}` : String(err));
    }
  }, [rows]);

  return (
    <nav className="template-list" aria-label="Templates">
      <header className="template-list-header">
        <span className="app-brand-title">Email Designer</span>
        <div className="template-list-header-actions">
          <button type="button" onClick={onCreate} className="template-list-new">
            + New
          </button>
          <Link to="/settings" className="template-list-settings-icon" aria-label="Settings" title="Settings">
            <SettingsIcon size={16} aria-hidden="true" />
          </Link>
        </div>
      </header>
      {loading && <p className="template-list-loading">Loading…</p>}
      {error && <p className="template-list-error" role="alert">{error}</p>}
      {!loading && rows.length === 0 && !error && (
        <p className="template-list-empty">No templates yet.</p>
      )}
      <ul className="template-list-items">
        {rows.map((r) => (
          <li key={r.id} className="template-list-item">
            <NavLink
              to={`/templates/${r.id}`}
              className={({ isActive }) =>
                isActive ? "template-list-link template-list-link-active" : "template-list-link"
              }
            >
              {r.name}
            </NavLink>
            <button
              type="button"
              aria-label={`Delete ${r.name}`}
              className="template-list-delete"
              onClick={() => onDelete(r.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
