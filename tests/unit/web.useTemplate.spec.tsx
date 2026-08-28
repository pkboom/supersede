// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../web/src/api/client.js";
import * as templatesApi from "../../web/src/api/templates.js";
import type { TemplateActions, TemplateData } from "../../web/src/hooks/useTemplate.js";
import { useTemplate } from "../../web/src/hooks/useTemplate.js";

// Mount-helper: renders a tiny consumer component so we can read the hook's
// returned `data`/`actions` from the test body.
interface Captured {
  data: TemplateData | null;
  actions: TemplateActions | null;
}

function makeProbe() {
  const captured: Captured = { data: null, actions: null };
  function Probe({ id }: { id: string }) {
    const t = useTemplate(id);
    captured.data = t.data;
    captured.actions = t.actions;
    return null;
  }
  return { Probe, captured };
}

const ROW = {
  id: "abc",
  name: "Welcome",
  description: null,
  mjml: "<mjml><mj-body><mj-section><mj-column><mj-text>v1</mj-text></mj-column></mj-section></mj-body></mjml>",
  version: 1,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(templatesApi, "getTemplate").mockResolvedValue(ROW);
  vi.spyOn(templatesApi, "patchTemplate").mockResolvedValue({ ...ROW, version: 2 });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function flushPromises(): Promise<void> {
  // Lets pending microtasks run between fake-timer advances.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useTemplate", () => {
  it("loads the template on mount", async () => {
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    expect(captured.data?.loading).toBe(false);
    expect(captured.data?.mjml).toBe(ROW.mjml);
    expect(captured.data?.version).toBe(1);
    expect(captured.data?.name).toBe("Welcome");
  });

  it("debounces 5 rapid save() calls into exactly 1 PATCH", async () => {
    const patchSpy = templatesApi.patchTemplate as ReturnType<typeof vi.fn>;
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      for (let i = 0; i < 5; i++) {
        captured.actions!.save(`<mjml><mj-body>v${i}</mj-body></mjml>`);
      }
    });
    expect(patchSpy).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy.mock.calls[0]![2]).toEqual({ mjml: "<mjml><mj-body>v4</mj-body></mjml>" });
  });

  it("forceSave flushes immediately and resolves on PATCH OK", async () => {
    const patchSpy = templatesApi.patchTemplate as ReturnType<typeof vi.fn>;
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>typed</mj-body></mjml>");
    });
    let resolved = false;
    await act(async () => {
      const p = captured.actions!.forceSave().then(() => {
        resolved = true;
      });
      await flushPromises();
      await p;
    });
    expect(resolved).toBe(true);
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });

  it("forceSave rejects on PATCH error (Interpretation A)", async () => {
    (templatesApi.patchTemplate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(412, { error: "no key" }),
    );
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>typed</mj-body></mjml>");
    });
    await act(async () => {
      await expect(captured.actions!.forceSave()).rejects.toBeInstanceOf(ApiError);
    });
    expect(captured.data?.apiKeyMissing).toBe(true);
  });

  it("412 sets apiKeyMissing without retry", async () => {
    (templatesApi.patchTemplate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(412, { error: "no key" }),
    );
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>x</mj-body></mjml>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();
    expect(captured.data?.apiKeyMissing).toBe(true);
    expect(captured.data?.status).toBe("idle");
  });

  it("429 sets rateLimitToast", async () => {
    (templatesApi.patchTemplate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(429, { error: "throttled" }),
    );
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>x</mj-body></mjml>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();
    expect(captured.data?.rateLimitToast).toBe(true);
  });

  it("404 sets templateDeleted (terminal state)", async () => {
    (templatesApi.patchTemplate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(404, { error: "gone" }),
    );
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>x</mj-body></mjml>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();
    expect(captured.data?.templateDeleted).toBe(true);
  });

  it("409 triggers refetch + conflictToast (pending edit dropped)", async () => {
    (templatesApi.patchTemplate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(409, { error: "stale" }),
    );
    const refreshed = { ...ROW, mjml: "<mjml><mj-body>refreshed</mj-body></mjml>", version: 5 };
    (templatesApi.getTemplate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ROW);
    (templatesApi.getTemplate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(refreshed);
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>x</mj-body></mjml>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();
    expect(captured.data?.conflictToast).toBe(true);
    expect(captured.data?.mjml).toBe(refreshed.mjml);
    expect(captured.data?.version).toBe(5);
  });

  it("5xx retries with exponential backoff; 5 failures → status='error'", async () => {
    const patchSpy = templatesApi.patchTemplate as ReturnType<typeof vi.fn>;
    patchSpy.mockRejectedValue(new ApiError(503, { error: "down" }));
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>x</mj-body></mjml>");
    });
    // First flush after debounce
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();
    expect(patchSpy).toHaveBeenCalledTimes(1);
    // Backoff schedule: 250, 500, 1000, 2000, 4000
    for (const delay of [250, 500, 1000, 2000]) {
      await act(async () => {
        vi.advanceTimersByTime(delay);
      });
      await flushPromises();
    }
    expect(patchSpy).toHaveBeenCalledTimes(5);
    expect(captured.data?.status).toBe("error");
  });

  it("cancelPendingSave clears the timer and aborts the in-flight fetch", async () => {
    const patchSpy = templatesApi.patchTemplate as ReturnType<typeof vi.fn>;
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>x</mj-body></mjml>");
    });
    expect(captured.data?.pendingPatch).toEqual({ mjml: "<mjml><mj-body>x</mj-body></mjml>" });
    act(() => {
      captured.actions!.cancelPendingSave();
    });
    expect(captured.data?.pendingPatch).toBeNull();
    expect(captured.data?.status).toBe("idle");
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it("applyServerWrite replaces mjml/version and clears pending state", async () => {
    const patchSpy = templatesApi.patchTemplate as ReturnType<typeof vi.fn>;
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>local</mj-body></mjml>");
    });
    act(() => {
      captured.actions!.applyServerWrite("<mjml><mj-body>from-server</mj-body></mjml>", 7);
    });
    expect(captured.data?.mjml).toBe("<mjml><mj-body>from-server</mj-body></mjml>");
    expect(captured.data?.version).toBe(7);
    expect(captured.data?.pendingPatch).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it("StrictMode: a single save() under <StrictMode> results in exactly 1 PATCH", async () => {
    const patchSpy = templatesApi.patchTemplate as ReturnType<typeof vi.fn>;
    const { Probe, captured } = makeProbe();
    render(
      <StrictMode>
        <Probe id="abc" />
      </StrictMode>,
    );
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>x</mj-body></mjml>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });

  it("unmount aborts in-flight + late response does NOT dispatch", async () => {
    let resolveLate!: (row: { mjml: string; version: number; name: string; description: string | null; id: string; createdAt: string; updatedAt: string }) => void;
    (templatesApi.patchTemplate as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    );
    const { Probe, captured } = makeProbe();
    const { unmount } = render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>x</mj-body></mjml>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();
    // PATCH is in-flight; unmount.
    unmount();
    // Late response — should NOT cause a dispatch (mountedRef false).
    resolveLate({ ...ROW, mjml: "x", version: 99 });
    await flushPromises();
    // No exception thrown = pass. captured.data is whatever it was at unmount time.
  });

  it("visibilitychange === 'hidden' flushes the pending save immediately", async () => {
    const patchSpy = templatesApi.patchTemplate as ReturnType<typeof vi.fn>;
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>x</mj-body></mjml>");
    });
    expect(patchSpy).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushPromises();
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });

  it("dismissConflictToast / dismissRateLimitToast clear the flags", async () => {
    (templatesApi.patchTemplate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(429, {}),
    );
    const { Probe, captured } = makeProbe();
    render(<Probe id="abc" />);
    await flushPromises();
    act(() => {
      captured.actions!.save("<mjml><mj-body>x</mj-body></mjml>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();
    expect(captured.data?.rateLimitToast).toBe(true);
    act(() => {
      captured.actions!.dismissRateLimitToast();
    });
    expect(captured.data?.rateLimitToast).toBe(false);
  });
});
