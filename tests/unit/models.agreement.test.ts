/**
 * ALLOWED_MODELS / ALLOWED_MODES have exactly one definition (plan §0.6).
 *
 * They were previously duplicated as identical literals in the server service
 * and the settings page, with nothing asserting they agreed. The failure is
 * user-visible the moment they drift: the page offers a radio button the server
 * rejects. This test exists so the duplication cannot silently come back.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ALLOWED_MODELS, ALLOWED_MODES } from "../../src/shared/models.js";
import {
  ALLOWED_MODELS as SERVICE_MODELS,
  ALLOWED_MODES as SERVICE_MODES,
} from "../../src/server/services/settingsService.js";

describe("model list agreement", () => {
  it("the settings service re-exports the shared list, not a copy", () => {
    expect(SERVICE_MODELS).toBe(ALLOWED_MODELS);
    expect(SERVICE_MODES).toBe(ALLOWED_MODES);
  });

  it("the settings page does not redefine the list", () => {
    const src = readFileSync("web/src/settings/Settings.tsx", "utf8");
    expect(src).not.toMatch(/const\s+ALLOWED_MODELS\s*=/);
    expect(src).toMatch(/import\s*\{\s*ALLOWED_MODELS\s*\}/);
  });

  it("every default is a member of its list", () => {
    // A default outside the allowed list is rejected by its own validator.
    expect(ALLOWED_MODES).toContain("cli");
    expect(ALLOWED_MODELS).toContain("claude-opus-4-7");
  });
});
