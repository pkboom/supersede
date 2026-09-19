import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    // Opt-in only: every file here spends real Luna calls, so `npm test` must never reach it.
    include: ["tests/e2e/**/*.e2e.{test,spec}.?(c|m)[jt]s?(x)"],
    setupFiles: ["tests/e2e/setup.js"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 60_000,
    retry: 1,
  },
});
