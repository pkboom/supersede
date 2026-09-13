/**
 * Host / Origin guard — DNS-rebinding and cross-origin defence (plan §0.6).
 *
 * WHY THIS EXISTS
 * ---------------
 * `README.md` claimed this defence for a long time while it did not exist:
 * grepping `src/` for origin/host/csrf/cors returned only `originalTagName` in
 * the parser. The only middleware registered was rate limiting and a body-size
 * cap. A documented defence that is absent is worse than an acknowledged gap,
 * because it stops anyone looking.
 *
 * THE ACTUAL THREAT
 * -----------------
 * The app binds loopback and has no auth by design — the deployer owns the
 * SQLite file and every template in it. That makes **DNS rebinding** the live
 * vector, and it is worth being precise about why:
 *
 *   1. The victim loads `http://evil.test` in a browser. Attacker DNS answers
 *      with a short TTL.
 *   2. The TTL expires and `evil.test` is re-resolved to `127.0.0.1`.
 *   3. Script still running on the `evil.test` origin now issues same-origin
 *      requests that land on THIS server.
 *
 * CORS does not help: to the browser these are same-origin requests, so no
 * preflight is sent and no CORS headers are consulted. What survives the
 * rebind is the `Host` header — it still says `evil.test`, because that is the
 * name the browser connected to. Rejecting any `Host` that is not a loopback
 * name is therefore the defence, and it has to run on EVERY route including
 * reads: the interesting attack is exfiltrating templates with GET.
 *
 * Plain cross-origin CSRF is a secondary concern here and is partly blunted by
 * the browser's own preflight for JSON POST and DELETE — but that is the
 * browser's policy doing the work, not ours, which is exactly what this check
 * is supposed to guarantee independently. So `Origin`, when present, must also
 * be loopback.
 *
 * WHY NOT MATCH THE BOUND PORT
 * ----------------------------
 * Tempting, but wrong in a way that breaks real setups: the server does not
 * know the port the client dialled when it sits behind `vite`'s dev proxy, and
 * a rebind attacker gains nothing from a port mismatch — any port on a loopback
 * NAME is already under the deployer's control. The hostname is the security
 * boundary; the port is not.
 */
import type { Context, Next } from "hono";

/**
 * Hostnames that mean "this machine". `localhost` is included because browsers
 * and the dev proxy use it; raw IPv4/IPv6 loopback literals because tooling and
 * `curl` use those.
 */
const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
  "0.0.0.0",
]);

/**
 * Strip the port from a `Host` header value, preserving bracketed IPv6 form.
 * `example.com:3000` -> `example.com`; `[::1]:3000` -> `[::1]`.
 */
export function hostnameOf(hostHeader: string): string {
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    return close === -1 ? trimmed : trimmed.slice(0, close + 1);
  }
  const colon = trimmed.lastIndexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

export function isLoopbackHost(hostHeader: string | undefined | null): boolean {
  if (!hostHeader) return false;
  return LOOPBACK_HOSTNAMES.has(hostnameOf(hostHeader));
}

/**
 * `Origin` arrives as a full serialized origin (`http://localhost:5173`) or the
 * literal `null`. Anything we cannot parse is rejected rather than waved
 * through — an unparseable Origin is not evidence of safety.
 */
export function isLoopbackOrigin(origin: string): boolean {
  if (origin === "null") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase());
}

export interface OriginGuardOptions {
  /**
   * Requests with NO `Host` header at all. Real browsers and HTTP/1.1 clients
   * always send one; direct in-process calls (Hono's `app.request()`) may not.
   * Defaults to allowing them, because a request that never crossed a network
   * boundary cannot have been rebound.
   */
  allowMissingHost?: boolean;
}

/**
 * Reject requests whose `Host` (or, when present, `Origin`) is not loopback.
 * Mount BEFORE any route, including reads.
 */
export function originGuard(opts: OriginGuardOptions = {}) {
  const allowMissingHost = opts.allowMissingHost ?? true;

  return async function originGuardMiddleware(c: Context, next: Next) {
    const host = c.req.header("host");

    if (host === undefined) {
      if (!allowMissingHost) {
        return c.json({ error: "Missing Host header" }, 403);
      }
    } else if (!isLoopbackHost(host)) {
      // Do not echo the offending Host back — it is attacker-controlled and
      // this response may be rendered somewhere.
      return c.json(
        {
          error:
            "Forbidden: this server accepts loopback Host headers only (DNS-rebinding defence)",
        },
        403
      );
    }

    const origin = c.req.header("origin");
    if (origin !== undefined && !isLoopbackOrigin(origin)) {
      return c.json(
        {
          error:
            "Forbidden: this server accepts loopback Origin headers only (CSRF defence)",
        },
        403
      );
    }

    await next();
  };
}
