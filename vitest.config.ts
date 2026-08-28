/**
 * Repo-root Vitest config.
 *
 * Created by Lane H to support:
 *   - jsdom environment for `tests/unit/web.*.test.tsx` (per-file
 *     `// @vitest-environment jsdom` pragma still works; this just removes
 *     the burden of repeating it AND ensures DOM globals are available for
 *     React Testing Library at the right paths).
 *   - `@shared/*` alias resolution (mirrors `web/vite.config.ts`) so web
 *     components like `RightPanel.tsx` that import from `@shared/blocks/...`
 *     can be loaded by Vitest without bundler help.
 *
 * Server-side / pure-Node tests (the existing corpus) are unaffected: they
 * don't import the alias, and their default environment (`node`) is the
 * Vitest default — only files with the explicit pragma flip to jsdom.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    // Default to node; per-file `// @vitest-environment jsdom` overrides for
    // web component tests.
    environment: "node",
    // Auto-cleanup React Testing Library DOM between tests. Loaded for every
    // test file but only relevant inside jsdom — the `cleanup()` call is a
    // no-op when document is undefined.
    setupFiles: ["./tests/setup.web.ts"],
  },
});
