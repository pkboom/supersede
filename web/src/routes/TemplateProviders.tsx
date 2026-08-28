import type { ReactNode } from "react";
import {
  TemplateActionsContext,
  TemplateDataContext,
  useTemplate,
} from "../hooks/useTemplate.js";
import { QueryRunnerContext, useQueryRunner } from "../hooks/useQueryRunner.js";

/**
 * Mounts `useTemplate(id)` + `useQueryRunner(id)` and exposes them via three
 * Contexts. Lifted out of `TemplateRoute` so the sidebar (above the
 * `<Outlet/>`) can also consume the same instances — without this, the
 * "Ask Claude" textarea in the rail would have no QueryRunner to dispatch
 * against.
 *
 * The two-Context split for `useTemplate` (data vs actions) keeps
 * deeply-nested form descendants (RightPanel) from re-rendering on every
 * keystroke (per ralplan §4).
 */
export function TemplateProviders({ id, children }: { id: string; children: ReactNode }) {
  const { data, actions } = useTemplate(id);
  const q = useQueryRunner(id, {
    getVersion: () => data.version,
    onSuccess: actions.applyServerWrite,
    cancelPendingSave: actions.cancelPendingSave,
    refetch: actions.refetch,
  });

  return (
    <TemplateDataContext.Provider value={data}>
      <TemplateActionsContext.Provider value={actions}>
        <QueryRunnerContext.Provider value={q}>
          {children}
        </QueryRunnerContext.Provider>
      </TemplateActionsContext.Provider>
    </TemplateDataContext.Provider>
  );
}
