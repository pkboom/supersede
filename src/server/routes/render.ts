/**
 * /api/render — server-side MJML compile.
 *
 * Body: { source: string } → { html: string, unstamped: string[] }.
 * Cached in-memory with a small LRU (cap 32). Caller is expected to debounce
 * client-side (PreviewPane debounces 200ms).
 *
 * **The cache is keyed on the EXPANDED MJML, not the stored source.** Under the
 * reference model the same stored template expands to different MJML depending
 * on what the component store holds, so a source-keyed cache returns stale HTML
 * after a revision is published — the same bytes in, different bytes out. The
 * expanded string is the real input to compilation, so keying on it is correct
 * by construction and invalidates itself whenever a pin or a revision changes.
 */
import { Hono } from "hono";
// mjml ships ESM/CJS hybrid; the default export is the compile function.
// @ts-expect-error — no @types/mjml; see web/declarations.d.ts for web side.
import mjml2html from "mjml";
import { stampMjmlPaths } from "../../shared/blocks/stampPaths.js";
import {
  InMemoryComponentStore,
  expand,
  ExpansionError,
} from "../../shared/components/index.js";
import type { ComponentStore } from "../../shared/components/index.js";

interface CacheEntry {
  /** The EXPANDED MJML — see the cache note in the module header. */
  expanded: string;
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

function getCached(expanded: string): CacheEntry | null {
  const idx = cache.findIndex((e) => e.expanded === expanded);
  if (idx === -1) return null;
  // Touch to LRU-front.
  const e = cache.splice(idx, 1)[0]!;
  cache.unshift(e);
  return e;
}

function setCached(expanded: string, html: string, unstamped: string[]): void {
  cache.unshift({ expanded, html, unstamped, ts: Date.now() });
  while (cache.length > CACHE_CAP) cache.pop();
}

export interface RenderRouteOptions {
  /**
   * Component store used to expand `<mj-component/>` references before
   * compiling. Defaults to an empty store, which is a no-op for templates that
   * carry no references — the current shape of every stored template.
   */
  componentStore?: ComponentStore;
}

export function createRenderRoutes(opts: RenderRouteOptions = {}): Hono {
  const app = new Hono();
  const componentStore = opts.componentStore ?? new InMemoryComponentStore();

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

    // ---- Expand FIRST, then hand the SAME string to both consumers ----
    //
    // This ordering is load-bearing and its violation is silent. Stamping the
    // STORED (unexpanded) source against HTML compiled from the EXPANDED source
    // returns `stamped=3/3 missing=[]` — a clean bill of health — while every
    // path is off by the difference between one `<mj-component/>` token and the
    // several nodes it expands into. The canvas then selects and edits the
    // WRONG block on every click, and §0.5's `unstamped` cannot warn, because
    // nothing is missing. Only stamping the compiled string prevents it.
    let expanded: string;
    try {
      expanded = expand(source, componentStore).mjml;
    } catch (err) {
      if (err instanceof ExpansionError) {
        // Fail loudly. The alternative is mjml silently dropping the reference
        // and returning 200 with the content gone.
        c.status(422);
        return c.json({ error: `Component expansion failed: ${err.message}` });
      }
      throw err;
    }

    const cached = getCached(expanded);
    if (cached !== null) {
      return c.json({ html: cached.html, unstamped: cached.unstamped });
    }

    try {
      const result = mjml2html(expanded, { validationLevel: "soft" }) as {
        html: string;
        errors?: unknown[];
      };
      // Stamp `data-mjml-path` attrs on rendered elements so the iframe
      // bootstrap can echo them back as overlay anchors. Plan §2.2.3:
      // cache key remains source-only; cached value is the stamped HTML.
      // Warn-once-per-cache-miss when matchers fail to cover every parser
      // block (mjml drift); the iframe silently skips unstamped blocks.
      const stamped = stampMjmlPaths(expanded, result.html);
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
      setCached(expanded, stamped.html, stamped.missing);
      return c.json({ html: stamped.html, unstamped: stamped.missing });
    } catch (err) {
      c.status(500);
      return c.json({ error: `MJML compile failed: ${(err as Error).message}` });
    }
  });

  return app;
}
