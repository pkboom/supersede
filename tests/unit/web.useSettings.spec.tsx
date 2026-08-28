// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../web/src/api/client.js";
import * as settingsApi from "../../web/src/api/settings.js";
import { useSettings, type UseSettingsResult } from "../../web/src/hooks/useSettings.js";

interface Captured {
  v: UseSettingsResult | null;
}
function makeProbe() {
  const captured: Captured = { v: null };
  function Probe() {
    captured.v = useSettings();
    return null;
  }
  return { Probe, captured };
}

const SETTINGS = {
  defaultProvider: "anthropic",
  defaultMode: "api",
  defaultModel: "claude-opus-4-7",
  apiKeyConfigured: true,
};

beforeEach(() => {
  vi.spyOn(settingsApi, "getSettings").mockResolvedValue(SETTINGS);
  vi.spyOn(settingsApi, "patchSettings").mockResolvedValue({
    ...SETTINGS,
    defaultModel: "claude-sonnet-4-6",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function tick(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useSettings", () => {
  it("loads settings on mount", async () => {
    const { Probe, captured } = makeProbe();
    render(<Probe />);
    await tick();
    expect(captured.v?.loading).toBe(false);
    expect(captured.v?.defaultModel).toBe("claude-opus-4-7");
    expect(captured.v?.apiKeyConfigured).toBe(true);
  });

  it("setDefaultModel optimistically updates and resolves on PATCH OK", async () => {
    const { Probe, captured } = makeProbe();
    render(<Probe />);
    await tick();
    let resolved = false;
    await act(async () => {
      const p = captured.v!.setDefaultModel("claude-sonnet-4-6").then(() => {
        resolved = true;
      });
      await p;
    });
    expect(resolved).toBe(true);
    expect(captured.v?.defaultModel).toBe("claude-sonnet-4-6");
  });

  it("setDefaultModel reverts on 400 and rejects with ApiError", async () => {
    (settingsApi.patchSettings as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(400, { error: "bad model" }),
    );
    const { Probe, captured } = makeProbe();
    render(<Probe />);
    await tick();
    await act(async () => {
      await expect(captured.v!.setDefaultModel("claude-bogus")).rejects.toBeInstanceOf(ApiError);
    });
    // Reverted to the previous (loaded) value.
    expect(captured.v?.defaultModel).toBe("claude-opus-4-7");
  });

  it("apiKeyConfigured: false propagates from server response", async () => {
    (settingsApi.getSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...SETTINGS,
      apiKeyConfigured: false,
    });
    const { Probe, captured } = makeProbe();
    render(<Probe />);
    await tick();
    expect(captured.v?.apiKeyConfigured).toBe(false);
  });
});
