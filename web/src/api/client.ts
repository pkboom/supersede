/**
 * Single fetch primitive used by every typed wrapper. No axios, no
 * interceptors, no library. Industry-standard React fetch.
 *
 * Body discrimination on `ApiError`:
 *   - When the server returns valid JSON: `body` is the parsed object.
 *   - When the server returns malformed JSON (proxy-injected HTML, upstream
 *     crash with `content-type: application/json` but invalid body, etc.):
 *     `body` is the raw text response (truncated to 1KB by the server log
 *     pipeline upstream of us; we keep whatever bytes arrived).
 * Consumers should `typeof body === "string"` to discriminate.
 */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`HTTP ${status}`);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: opts.method ?? "GET",
    signal: opts.signal,
    headers: {
      accept: "application/json",
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;

  const ct = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  let body: unknown = raw;
  if (ct.includes("application/json") && raw.length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      // Keep raw text — proxy injected HTML or upstream crash with bad JSON.
    }
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return (raw.length === 0 ? (undefined as T) : (body as T));
}
