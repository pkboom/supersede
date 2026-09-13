/**
 * Scratch-only Vitest config. The root config deliberately scopes `include` to
 * `tests/**` so these probes don't pollute the real suite (vitest.config.ts:32).
 * Run the evidence behind .plan/propagation.md with:
 *     npx vitest run --config .plan/scratch/vitest.config.ts
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  resolve: { alias: { "@shared": resolve(__dirname, "../../src/shared") } },
  test: { environment: "node", include: [".plan/scratch/**/*.test.ts"] },
});
