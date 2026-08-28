// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../web/src/api/client.js";
import * as templatesApi from "../../web/src/api/templates.js";
import {
  type UseQueryRunnerOptions,
  type UseQueryRunnerResult,
  useQueryRunner,
} from "../../web/src/hooks/useQueryRunner.js";

interface Captured {
  q: UseQueryRunnerResult | null;
}

function makeProbe(opts: UseQueryRunnerOptions) {
  const captured: Captured = { q: null };
  function Probe() {
    captured.q = useQueryRunner("abc", opts);
    return null;
  }
  return { Probe, captured };
}

beforeEach(() => {
  vi.spyOn(templatesApi, "runQuery").mockResolvedValue({
    mjml: "<mjml>updated</mjml>",
    reply: "ok",
    version: 2,
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

describe("useQueryRunner", () => {
  it("happy path: locks, calls runQuery, fires onSuccess, sets lastReply", async () => {
    const onSuccess = vi.fn();
    const { Probe, captured } = makeProbe({
      getVersion: () => 5,
      onSuccess,
      cancelPendingSave: vi.fn(),
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    render(<Probe />);
    await act(async () => {
      await captured.q!.run("make button blue");
    });
    await tick();
    expect(captured.q?.locked).toBe(false);
    expect(captured.q?.lastReply).toBe("ok");
    expect(onSuccess).toHaveBeenCalledWith("<mjml>updated</mjml>", 2);
    expect(templatesApi.runQuery).toHaveBeenCalledWith("abc", 5, "make button blue", expect.anything());
  });

  it("calls cancelPendingSave SYNCHRONOUSLY before POST (Architect Synthesis #1)", async () => {
    const callOrder: string[] = [];
    const cancelPendingSave = vi.fn(() => callOrder.push("cancel"));
    (templatesApi.runQuery as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("post");
      return { mjml: "<mjml/>", reply: "x", version: 2 };
    });
    const { Probe, captured } = makeProbe({
      getVersion: () => 1,
      onSuccess: vi.fn(),
      cancelPendingSave,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    render(<Probe />);
    await act(async () => {
      await captured.q!.run("x");
    });
    expect(cancelPendingSave).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["cancel", "post"]);
  });

  it("412 sets apiKeyMissing", async () => {
    (templatesApi.runQuery as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(412, { error: "no key" }),
    );
    const { Probe, captured } = makeProbe({
      getVersion: () => 1,
      onSuccess: vi.fn(),
      cancelPendingSave: vi.fn(),
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    render(<Probe />);
    await act(async () => {
      await captured.q!.run("x");
    });
    expect(captured.q?.apiKeyMissing).toBe(true);
    expect(captured.q?.locked).toBe(false);
  });

  it("429 sets rateLimited", async () => {
    (templatesApi.runQuery as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(429, { error: "throttled" }),
    );
    const { Probe, captured } = makeProbe({
      getVersion: () => 1,
      onSuccess: vi.fn(),
      cancelPendingSave: vi.fn(),
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    render(<Probe />);
    await act(async () => {
      await captured.q!.run("x");
    });
    expect(captured.q?.rateLimited).toBe(true);
  });

  it("413 sets payloadTooLarge", async () => {
    (templatesApi.runQuery as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(413, { error: "too long" }),
    );
    const { Probe, captured } = makeProbe({
      getVersion: () => 1,
      onSuccess: vi.fn(),
      cancelPendingSave: vi.fn(),
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    render(<Probe />);
    await act(async () => {
      await captured.q!.run("x");
    });
    expect(captured.q?.payloadTooLarge).toBe(true);
  });

  it("409 calls refetch", async () => {
    (templatesApi.runQuery as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(409, { error: "stale" }),
    );
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { Probe, captured } = makeProbe({
      getVersion: () => 1,
      onSuccess: vi.fn(),
      cancelPendingSave: vi.fn(),
      refetch,
    });
    render(<Probe />);
    await act(async () => {
      await captured.q!.run("x");
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("validation: empty query throws synchronously", async () => {
    const { Probe, captured } = makeProbe({
      getVersion: () => 1,
      onSuccess: vi.fn(),
      cancelPendingSave: vi.fn(),
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    render(<Probe />);
    await expect(captured.q!.run("   ")).rejects.toThrow(/non-empty/);
  });

  it("validation: query > 4000 chars throws synchronously", async () => {
    const { Probe, captured } = makeProbe({
      getVersion: () => 1,
      onSuccess: vi.fn(),
      cancelPendingSave: vi.fn(),
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    render(<Probe />);
    await expect(captured.q!.run("x".repeat(4001))).rejects.toThrow(/exceeds/);
  });

  it("abort cancels in-flight POST", async () => {
    let abortedSeen = false;
    (templatesApi.runQuery as ReturnType<typeof vi.fn>).mockImplementation(
      (_id, _v, _q, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            abortedSeen = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );
    const { Probe, captured } = makeProbe({
      getVersion: () => 1,
      onSuccess: vi.fn(),
      cancelPendingSave: vi.fn(),
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    render(<Probe />);
    let pending: Promise<void>;
    await act(async () => {
      pending = captured.q!.run("x");
      await Promise.resolve();
      captured.q!.abort();
      await pending.catch(() => undefined);
    });
    expect(abortedSeen).toBe(true);
    expect(captured.q?.locked).toBe(false);
  });
});
