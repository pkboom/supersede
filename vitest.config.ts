/**
 * Repo-root Vitest config.
 *
 * Node-only since the browser UI was removed: there is no jsdom environment,
 * no React plugin and no DOM setup file. What remains under test is the MJML
 * parser/serializer and the component expander, both plain Node modules.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    // Collect ONLY the real suite. Without an explicit `include`, Vitest's
    // default glob sweeps the whole repo and picks up throwaway probe files,
    // so the reported pass rate depends on whatever scratch work happens to
    // be lying around.
    include: ["tests/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    environment: "node",
  },
});
