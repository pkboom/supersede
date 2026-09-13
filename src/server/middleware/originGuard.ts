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
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
// A bare `::1` is NOT listed: `hostnameOf` splits on the last colon for any
// unbracketed value, so `::1` would arrive here as `":"` and could never match.
// An entry that cannot fire is worse than absent — it reads as coverage.
// NOT in the list, deliberately: `0.0.0.0`. It is not a loopback NAME — it is
// the unspecified address, and it is the published "0.0.0.0 Day" bypass target
// for exactly this class of local-server guard. It was in an earlier draft of
// this file, which also made the code disagree with the README sentence that
// enumerates the accepted names — reintroducing, in the same commit that fixed
// it, the §0.6 sin of a documented control differing from the real one.

/**
 * Strip the port from a `Host` header value, preserving bracketed IPv6 form.
 * `example.com:3000` -> `example.com`; `[::1]:3000` -> `[::1]`.
 */
export function hostnameOf(hostHeader: string): string {
  const trimmed = hostHeader.trim().toLowerCase();
  // Userinfo and path characters have no place in an authority. Without this,
  // `localhost:80@evil.test` splits on the LAST colon to `"localhost"` and is
  // allowed. Node's own parser rejects that shape with 400 before we see it,
  // but this helper is exported and unit-tested as if it were authoritative,
  // so it must not depend on someone else's validation.
  if (trimmed.includes("@") || trimmed.includes("/")) return "\0";
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
   * Escape hatch for a request carrying NO usable authority at all — neither a
   * `Host` header nor a resolvable host in the request URL.
   *
   * Defaults to **false**: fail closed. An earlier draft defaulted this to
   * `true` so that in-process `app.request()` calls would pass, which made a
   * test-harness convenience into the production posture of a security control.
   * The authority fallback below removes the need for that.
   */
  allowMissingHost?: boolean;
}

/**
 * The authority this request was addressed to.
 *
 * Prefers the `Host` header, which is what survives a DNS rebind and therefore
 * what the check is really about. Falls back to the host component of the
 * request URL, which is NOT a weakening: `@hono/node-server` builds `c.req.url`
 * from the very same `Host` header, so on a real network request the two agree
 * by construction. The fallback exists because Hono's in-process
 * `app.request()` populates the URL but sends no header — and tests that have
 * to disable a security control to pass are tests that stop testing it.
 */
function authorityOf(c: Context): string | undefined {
  const header = c.req.header("host");
  if (header) return header;
  try {
    const { host } = new URL(c.req.url);
    return host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reject requests whose `Host` (or, when present, `Origin`) is not loopback.
 * Mount BEFORE any route, including reads.
 */
export function originGuard(opts: OriginGuardOptions = {}) {
  const allowMissingHost = opts.allowMissingHost ?? false;

  return async function originGuardMiddleware(c: Context, next: Next) {
    const host = authorityOf(c);

    if (host === undefined) {
      if (!allowMissingHost) {
        return c.json({ error: "Missing or unusable Host" }, 403);
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
