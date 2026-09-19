import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    // Explicit, so the default glob does not sweep up throwaway probe files and
    // make the pass rate depend on whatever scratch work is lying around.
    include: ["tests/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    // tests/e2e spends real Luna calls; it runs only through `npm run test:e2e`.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    environment: "node",
  },
});
