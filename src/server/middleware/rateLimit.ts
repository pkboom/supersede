import type { Context, MiddlewareHandler } from "hono";
import type { Clock } from "../createWebApp.js";
import type { AppEnv } from "../types.js";

export interface RateLimitOptions {
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Maximum permitted hits per key per window. */
  max: number;
  /** Extracts the rate-limit bucket key (userId, IP, etc.) for a request. */
  keyFn: (c: Context<AppEnv>) => string;
  /** Injectable clock — production passes `Date.now`, tests pass a controllable counter. */
  clock: Clock;
  /** Identifies this limiter in the 429 body (debugging aid). */
  name?: string;
}

/**
 * Sliding-window rate limiter as a Hono middleware factory. State is held in a
 * per-instance Map and is therefore process-local — fine for a single-host
 * EC2 deploy; horizontal scale would require a shared store (Redis), out of
 * scope for v2.0.
 *
 * Tests inject a mutable clock; advancing it past `windowMs` clears old hits
 * deterministically without `setTimeout` or fake timers.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const hits = new Map<string, number[]>();
  const { windowMs, max, keyFn, clock, name } = opts;

  return async (c, next) => {
    const key = keyFn(c);
    const now = clock();
    const cutoff = now - windowMs;

    const arr = hits.get(key) ?? [];
    const fresh = arr.length > 0 ? arr.filter((t) => t > cutoff) : arr;

    if (fresh.length >= max) {
      hits.set(key, fresh);
      const retryAfterMs = fresh[0]! + windowMs - now;
      c.header("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      return c.json(
        {
          error: "Too many requests",
          limiter: name ?? "default",
          retryAfterMs,
        },
        429,
      );
    }

    fresh.push(now);
    hits.set(key, fresh);
    await next();
  };
}
