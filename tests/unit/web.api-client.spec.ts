// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "../../web/src/api/client.js";

const realFetch = globalThis.fetch;

function mockFetch(status: number, body: string, contentType = "application/json"): void {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  // 204/205/304 forbid bodies per Fetch spec; pass null to avoid TypeError.
  const responseBody = status === 204 || status === 205 || status === 304 ? null : body;
  globalThis.fetch = vi.fn(
    async () =>
      new Response(responseBody, {
        status,
        headers,
      }),
  ) as unknown as typeof fetch;
}

describe("api/client.ts", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns parsed JSON body on 200", async () => {
    mockFetch(200, JSON.stringify({ ok: true, value: 42 }));
    const out = await request<{ ok: boolean; value: number }>("/api/x");
    expect(out).toEqual({ ok: true, value: 42 });
  });

  it("returns undefined on 204", async () => {
    mockFetch(204, "", "");
    const out = await request<void>("/api/x", { method: "DELETE" });
    expect(out).toBeUndefined();
  });

  for (const status of [400, 404, 409, 412, 413, 422, 429, 500, 502, 503]) {
    it(`surfaces HTTP ${status} as ApiError with parsed body`, async () => {
      mockFetch(status, JSON.stringify({ error: "boom" }));
      try {
        await request("/api/x");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const e = err as ApiError;
        expect(e.status).toBe(status);
        expect(e.body).toEqual({ error: "boom" });
      }
    });
  }

  it("surfaces malformed-JSON 502 as ApiError(502, rawText) — does NOT throw SyntaxError (B2)", async () => {
    mockFetch(502, "<html>bad gateway</html>", "application/json");
    try {
      await request("/api/x");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.status).toBe(502);
      expect(e.body).toBe("<html>bad gateway</html>");
    }
  });

  it("surfaces non-JSON content-type as raw text body even on 200", async () => {
    mockFetch(200, "hello world", "text/plain");
    const out = await request<string>("/api/x");
    expect(out).toBe("hello world");
  });

  it("propagates AbortSignal cancellations", async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(async (_input, init?: RequestInit) => {
      // mimic real fetch: throw AbortError if signal aborted
      if (init?.signal?.aborted) {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    }) as unknown as typeof fetch;
    const p = request("/api/x", { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sends POST body as JSON with correct content-type", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await request("/api/x", { method: "POST", body: { a: 1 } });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["accept"]).toBe("application/json");
  });

  it("sends GET without content-type header (no body)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await request("/api/x");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
    expect(headers["accept"]).toBe("application/json");
  });
});
