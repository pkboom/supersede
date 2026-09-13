/**
 * /api/render — server-side MJML compile.
 *
 * Body: { source: string } → { html: string, unstamped: string[] }.
 * Cached in-memory by source string with a small LRU (cap 32). Caller is
 * expected to debounce client-side (PreviewPane debounces 200ms).
 */
import { Hono } from "hono";
// mjml ships ESM/CJS hybrid; the default export is the compile function.
// @ts-expect-error — no @types/mjml; see web/declarations.d.ts for web side.
import mjml2html from "mjml";
import { stampMjmlPaths } from "../../shared/blocks/stampPaths.js";

interface CacheEntry {
  source: string;
  html: string;
  /**
   * Path keys whose detector found no matching rendered element, so the canvas
   * cannot make them selectable. Cached alongside the HTML because it is a
   * property of this render, not of this request.
   */
  unstamped: string[];
  ts: number;
}

const CACHE_CAP = 32;
const cache: CacheEntry[] = [];

function getCached(source: string): CacheEntry | null {
  const idx = cache.findIndex((e) => e.source === source);
  if (idx === -1) return null;
  // Touch to LRU-front.
  const e = cache.splice(idx, 1)[0]!;
  cache.unshift(e);
  return e;
}

function setCached(source: string, html: string, unstamped: string[]): void {
  cache.unshift({ source, html, unstamped, ts: Date.now() });
  while (cache.length > CACHE_CAP) cache.pop();
}

export function createRenderRoutes(): Hono {
  const app = new Hono();

  app.post("/api/render", async (c) => {
    let body: { source?: string };
    try {
      body = await c.req.json();
    } catch {
      c.status(400);
      return c.json({ error: "Invalid JSON body" });
    }
    const source = body?.source;
    if (typeof source !== "string") {
      c.status(400);
      return c.json({ error: "Body must be { source: string }" });
    }

    const cached = getCached(source);
    if (cached !== null) {
      return c.json({ html: cached.html, unstamped: cached.unstamped });
    }

    try {
      const result = mjml2html(source, { validationLevel: "soft" }) as {
        html: string;
        errors?: unknown[];
      };
      // Stamp `data-mjml-path` attrs on rendered elements so the iframe
      // bootstrap can echo them back as overlay anchors. Plan §2.2.3:
      // cache key remains source-only; cached value is the stamped HTML.
      // Warn-once-per-cache-miss when matchers fail to cover every parser
      // block (mjml drift); the iframe silently skips unstamped blocks.
      const stamped = stampMjmlPaths(source, result.html);
      if (stamped.stamped < stamped.expected) {
        // eslint-disable-next-line no-console
        console.warn(
          `[stampMjmlPaths] ${stamped.stamped}/${stamped.expected} stamped, missing: [${stamped.missing.join(",")}]`
        );
      }
      // Return `unstamped` rather than spending it on a console.warn (§0.5).
      // The browser was previously not merely un-warned but STRUCTURALLY BLIND:
      // it had no way to know which blocks are unselectable, so the failure
      // surfaced as "selection mysteriously stopped working", reported weeks
      // later, by a user.
      //
      // Know its limit: this is a COMPLETENESS check, not a correctness one. It
      // cannot catch mis-targeting that still counts stamped === expected (see
      // §11) — that needs the structural fix of stamping the same string that
      // was compiled. It is still worth returning, for the registry-gap class
      // and as the smoke alarm for the deferred mjml 4->5 bump (§0.4), whose
      // most likely casualty is exactly this code path.
      setCached(source, stamped.html, stamped.missing);
      return c.json({ html: stamped.html, unstamped: stamped.missing });
    } catch (err) {
      c.status(500);
      return c.json({ error: `MJML compile failed: ${(err as Error).message}` });
    }
  });

  return app;
}
