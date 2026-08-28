// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../web/src/api/client.js";
import * as settingsApi from "../../web/src/api/settings.js";
import { Settings } from "../../web/src/settings/Settings.js";

const BASE = {
  defaultProvider: "anthropic",
  defaultMode: "api",
  defaultModel: "claude-opus-4-7",
  apiKeyConfigured: true,
};

afterEach(() => {
  vi.restoreAllMocks();
});

async function tick(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

describe("<Settings/>", () => {
  it("hides the API-key banner when apiKeyConfigured: true", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue({ ...BASE, apiKeyConfigured: true });
    renderSettings();
    await tick();
    expect(screen.queryByTestId("api-key-banner")).toBeNull();
  });

  it("shows the API-key banner when apiKeyConfigured: false", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue({ ...BASE, apiKeyConfigured: false });
    renderSettings();
    await tick();
    expect(screen.getByTestId("api-key-banner")).toBeTruthy();
  });

  it("PATCH on model change", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(BASE);
    const patchSpy = vi
      .spyOn(settingsApi, "patchSettings")
      .mockResolvedValue({ ...BASE, defaultModel: "claude-sonnet-4-6" });
    renderSettings();
    await tick();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Default Claude model"), {
        target: { value: "claude-sonnet-4-6" },
      });
      await Promise.resolve();
    });
    await tick();
    expect(patchSpy).toHaveBeenCalledWith({ defaultModel: "claude-sonnet-4-6" });
    const select = screen.getByLabelText("Default Claude model") as HTMLSelectElement;
    expect(select.value).toBe("claude-sonnet-4-6");
  });

  it("hides the API-key banner when defaultMode === 'cli' even with key unset", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue({
      ...BASE,
      defaultMode: "cli",
      apiKeyConfigured: false,
    });
    renderSettings();
    await tick();
    expect(screen.queryByTestId("api-key-banner")).toBeNull();
  });

  it("flipping the mode radio PATCHes defaultMode", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(BASE);
    const patchSpy = vi
      .spyOn(settingsApi, "patchSettings")
      .mockResolvedValue({ ...BASE, defaultMode: "cli" });
    renderSettings();
    await tick();
    const cliRadio = screen.getByRole("radio", { name: /Claude CLI/i }) as HTMLInputElement;
    await act(async () => {
      fireEvent.click(cliRadio);
      await Promise.resolve();
    });
    await tick();
    expect(patchSpy).toHaveBeenCalledWith({ defaultMode: "cli" });
    expect((screen.getByRole("radio", { name: /Claude CLI/i }) as HTMLInputElement).checked).toBe(true);
  });

  it("400 reverts the select to the previous value (no toast)", async () => {
    vi.spyOn(settingsApi, "getSettings").mockResolvedValue(BASE);
    vi.spyOn(settingsApi, "patchSettings").mockRejectedValueOnce(new ApiError(400, { error: "bad" }));
    renderSettings();
    await tick();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Default Claude model"), {
        target: { value: "claude-sonnet-4-6" },
      });
    });
    await tick();
    const select = screen.getByLabelText("Default Claude model") as HTMLSelectElement;
    expect(select.value).toBe("claude-opus-4-7");
  });
});
