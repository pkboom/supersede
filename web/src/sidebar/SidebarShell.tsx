import { Outlet, useMatch } from "react-router-dom";
import { SidebarQueryInput } from "../claude/SidebarQueryInput.js";
import { TemplateProviders } from "../routes/TemplateProviders.js";
import { TemplateList } from "./TemplateList.js";

/**
 * Persistent left rail wrapping `<Outlet/>`. Because this component parents
 * `/templates`, `/templates/:id`, and `/settings`, the `<TemplateList/>` to
 * the left does NOT remount on `:id` swaps — it keeps focus, scroll
 * position, and the open-template highlight intact (per pre-mortem §7.5).
 *
 * When `/templates/:id` is active, the rail also renders the Ask-Claude
 * input at the bottom; both the input and the canvas (inside `<Outlet/>`)
 * consume the same `useTemplate` + `useQueryRunner` instances via
 * `<TemplateProviders>`. The provider mount-point sits above both panes
 * because the input lives outside the Outlet.
 *
 * Sibling layout (NOT nested): `<TemplateList/>` and `<Outlet/>` are
 * children of the same flex container. A nested layout (sidebar wrapping
 * Outlet) was the original mistake that caused the remount; sibling
 * isolates the parent re-render to just the right pane.
 */
export function SidebarShell() {
  const match = useMatch("/templates/:id");
  const id = match?.params.id;

  const layout = (
    <div className="sidebar-shell">
      <aside className="sidebar-shell-rail">
        <TemplateList />
        {id && <SidebarQueryInput />}
      </aside>
      <section className="sidebar-shell-main">
        <Outlet />
      </section>
    </div>
  );

  if (id) {
    return <TemplateProviders id={id}>{layout}</TemplateProviders>;
  }
  return layout;
}
