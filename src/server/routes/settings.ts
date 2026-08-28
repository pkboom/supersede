import { Hono } from "hono";
import type { DbHandle } from "../../db/index.js";
import { SettingsService, UnknownModeError, UnknownModelError } from "../services/settingsService.js";
import type { AppEnv } from "../types.js";

export interface SettingsRoutesOptions {
  db: DbHandle;
  /** True when ANTHROPIC_API_KEY is set in the host env at boot. Surfaced to the UI. */
  apiKeyConfigured: boolean;
}

/**
 *   GET   /api/settings   → 200 { defaultProvider, defaultMode, defaultModel, apiKeyConfigured }
 *   PATCH /api/settings   → 200 row | 400 (rejected model | rejected mode)
 *
 * `apiKeyConfigured` reflects whether `ANTHROPIC_API_KEY` was set at process
 * start. The frontend uses this only when `defaultMode === "api"` to render
 * the "set the env var" banner. CLI mode authenticates via `claude auth
 * login` (OS keychain) so the env-var banner is hidden in that mode.
 */
export function createSettingsRoutes(opts: SettingsRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const svc = new SettingsService(opts.db);

  app.get("/api/settings", (c) => {
    const row = svc.get();
    return c.json({
      defaultProvider: row.defaultProvider,
      defaultMode: row.defaultMode,
      defaultModel: row.defaultModel,
      apiKeyConfigured: opts.apiKeyConfigured,
    });
  });

  app.patch("/api/settings", async (c) => {
    let body: { defaultModel?: unknown; defaultMode?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const patch: { defaultModel?: string; defaultMode?: string } = {};
    if (body.defaultModel !== undefined) {
      if (typeof body.defaultModel !== "string") {
        return c.json({ error: "`defaultModel` must be a string" }, 400);
      }
      patch.defaultModel = body.defaultModel;
    }
    if (body.defaultMode !== undefined) {
      if (typeof body.defaultMode !== "string") {
        return c.json({ error: "`defaultMode` must be a string" }, 400);
      }
      patch.defaultMode = body.defaultMode;
    }
    let updated;
    try {
      updated = svc.update(patch);
    } catch (err) {
      if (err instanceof UnknownModelError) return c.json({ error: err.message }, 400);
      if (err instanceof UnknownModeError) return c.json({ error: err.message }, 400);
      throw err;
    }
    return c.json({
      defaultProvider: updated.defaultProvider,
      defaultMode: updated.defaultMode,
      defaultModel: updated.defaultModel,
      apiKeyConfigured: opts.apiKeyConfigured,
    });
  });

  return app;
}
