/**
 * Allowed Claude models and modes — ONE definition (plan §0.6).
 *
 * These were duplicated as identical literals in `settingsService.ts` and
 * `web/src/settings/Settings.tsx`, with no shared import and no test asserting
 * they agreed. The asymmetry is user-visible the moment they drift: the
 * settings page offers a radio button the server then rejects.
 *
 * Lives in `src/shared/` because the web bundle already resolves that via the
 * `@shared` alias (web/vite.config.ts, web/tsconfig.json, vitest.config.ts).
 */
export const ALLOWED_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];

export const ALLOWED_MODES = ["api", "cli"] as const;
export type AllowedMode = (typeof ALLOWED_MODES)[number];
