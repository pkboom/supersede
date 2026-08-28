/**
 * Vitest setup: ensures React Testing Library cleans up the DOM between
 * tests. Without this, multiple `render(...)` calls in the same file
 * accumulate into the same jsdom container, causing
 * "found multiple elements" failures on the second test in a file.
 *
 * Loaded only for web/jsdom test files via `setupFiles` in vitest.config.
 */
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
