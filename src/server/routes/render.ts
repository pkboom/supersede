/**
 * /api/render — server-side MJML compile.
 *
 * Body: { source: string } → { html: string }.
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
  ts: number;
}

const CACHE_CAP = 32;
const cache: CacheEntry[] = [];

function getCached(source: string): string | null {
  const idx = cache.findIndex((e) => e.source === source);
  if (idx === -1) return null;
  // Touch to LRU-front.
  const e = cache.splice(idx, 1)[0]!;
  cache.unshift(e);
  return e.html;
}

function setCached(source: string, html: string): void {
  cache.unshift({ source, html, ts: Date.now() });
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
      return c.json({ html: cached });
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
      setCached(source, stamped.html);
      return c.json({ html: stamped.html });
    } catch (err) {
      c.status(500);
      return c.json({ error: `MJML compile failed: ${(err as Error).message}` });
    }
  });

  return app;
}
