/**
 * /api/render — server-side MJML compile.
 *
 * Body: { source: string } → { html, unstamped[], mjmlErrors[] }.
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
  COMPONENT_TAG,
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
  /** Diagnostics mjml reported under soft validation. See the read site. */
  mjmlErrors: string[];
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

function setCached(
  expanded: string,
  html: string,
  unstamped: string[],
  mjmlErrors: string[]
): void {
  cache.unshift({ expanded, html, unstamped, mjmlErrors, ts: Date.now() });
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

    // ---- Refuse mj-include: it reads server-local files ----
    //
    // mjml resolves `<mj-include path="..."/>` against the server filesystem,
    // and its directory-traversal fix (CVE-2020-12827) is incomplete through
    // 4.18.0 — the version this project is pinned to, with no non-breaking
    // upgrade available. Verified reachable from this route: relative
    // traversal, absolute paths, and `type="css"` all return file contents in
    // the HTTP 200 body, which is then rendered in the canvas and persisted
    // into the template on the next save.
    //
    // The realistic chain is not a remote attacker — the guard above blocks
    // those — it is the user pasting a third-party brief into the AI pane,
    // Claude emitting an <mj-include/>, and the file coming back. This app has
    // no legitimate use for includes: the only mentions in src/ are comments
    // describing the tag as unmodeled passthrough. So refusing costs nothing.
    if (/<\s*mj-include(?![\w-])/i.test(expanded)) {
      c.status(422);
      return c.json({
        error:
          "<mj-include/> is not supported: it reads files from the server filesystem.",
      });
    }

    const cached = getCached(expanded);
    if (cached !== null) {
      // Every field must be returned on the cache-hit path too, or the first
      // request after a restart behaves differently from every later one.
      return c.json({
        html: cached.html,
        unstamped: cached.unstamped,
        mjmlErrors: cached.mjmlErrors,
      });
    }

    try {
      const result = mjml2html(expanded, { validationLevel: "soft" }) as {
        html: string;
        errors?: unknown[];
      };
      // Stamp `data-mjml-path` attrs on rendered elements so the iframe
      // bootstrap can echo them back as overlay anchors. Plan §2.2.3:
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
      // Read `result.errors` instead of discarding it.
      //
      // This is the expander guard's only INDEPENDENT feed. The guard proves a
      // reference did not survive OUR scan; mjml's own errors prove it did not
      // survive the COMPILER. A second check that fails whenever the first does
      // is decoration — this one fails differently, which is the point. It is
      // also where the silent HTTP-200 content loss announces itself today:
      // mjml reports "Element mj-component doesn't exist" in here, under soft
      // validation, and this route used to reach the field by type assertion
      // and never look at it.
      const mjmlErrors = (result.errors ?? []).map((e) => {
        const raw =
          typeof e === "string"
            ? e
            : String(
                (e as { formattedMessage?: string; message?: string })
                  ?.formattedMessage ??
                  (e as { message?: string })?.message ??
                  e
              );
        // mjml embeds the process CWD in its messages ("Line 1 of /abs/path
        // (mj-text) — ..."). These now reach the client, so strip the path:
        // the line number and element are the useful part, the server's
        // filesystem layout is not.
        return raw.replace(/^Line (\d+) of \S+ /, "Line $1 ");
      });

      // ---- The authoritative survivor check ----
      //
      // Our own guard proves a reference did not survive OUR scan. This proves
      // it did not survive the COMPILER, which is the only opinion that decides
      // what reaches the recipient. If mjml says `mj-component` is unregistered,
      // a reference reached it — regardless of which parser quirk our scanner
      // got wrong this time.
      //
      // That distinction is not hypothetical: every leak found in review so far
      // was our comment model disagreeing with htmlparser2 (a `<!--` inside an
      // attribute value; an unterminated comment; the short forms `<!-->` and
      // `<!--->`; `<!--` inside a <script>). In at least one of them mjml DID
      // report the error and this route returned 200 anyway. Escalating here
      // closes the class rather than the instance, so the next quirk fails
      // loudly instead of shipping a footerless email.
      const survived = mjmlErrors.filter((e) => e.includes(COMPONENT_TAG));
      if (survived.length > 0) {
        c.status(422);
        return c.json({
          error:
            `A <${COMPONENT_TAG}/> reference reached the compiler unexpanded, which would ` +
            `render as HTTP 200 with the content silently missing: ${survived.join("; ")}`,
        });
      }

      setCached(expanded, stamped.html, stamped.missing, mjmlErrors);
      return c.json({
        html: stamped.html,
        unstamped: stamped.missing,
        mjmlErrors,
      });
    } catch (err) {
      // A compile failure here means mjml could not turn THIS REQUEST'S source
      // into HTML, and that source is the only input this route has. So it is
      // the client's document that needs changing, which makes it a 422 like
      // every other bad-input path here — not a 500, which should mean "we
      // broke" and which a caller can do nothing about.
      //
      // Matching on the message text was tried and is the wrong shape: mjml
      // surfaces structural problems inconsistently ("Malformed MJML..." for a
      // parse failure, but "component.htmlAttributes is not a function" for
      // <mj-style> in an illegal position). Both are the same class of problem
      // and pattern-matching prose to tell them apart would need updating every
      // time mjml rewords an error.
      //
      // The message is passed through verbatim so a genuine mjml bug is still
      // diagnosable rather than flattened into a generic 4xx.
      c.status(422);
      return c.json({
        error: `MJML could not be compiled: ${(err as Error).message}`,
      });
    }
  });

  return app;
}
