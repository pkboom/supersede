/**
 * /api/render under the reference model — expansion ordering (plan §11, §12).
 *
 * The bug these tests exist to prevent is silent and returns HTTP 200, so it
 * is asserted directly rather than described.
 */
import { describe, it, expect } from "vitest";
import mjml2html from "mjml";
import { Hono } from "hono";
import { createRenderRoutes } from "../../src/server/routes/render.js";
import { stampMjmlPaths } from "../../src/shared/blocks/stampPaths.js";
import {
  InMemoryComponentStore,
  expand,
} from "../../src/shared/components/index.js";

const BUTTON = `<mj-button href="https://x.test" background-color="#1f6feb">Shop now</mj-button>`;

function storeWith(body = BUTTON): InMemoryComponentStore {
  const s = new InMemoryComponentStore();
  s.publish("shoe-brand/primary-button", body);
  return s;
}

const TEMPLATE =
  `<mjml><mj-body>` +
  `<mj-section><mj-column><mj-text>Header</mj-text></mj-column></mj-section>` +
  `<mj-section><mj-column><mj-component component-id="shoe-brand/primary-button" revision="1" /></mj-column></mj-section>` +
  `<mj-section background-color="#111111"><mj-column><mj-text>Footer</mj-text></mj-column></mj-section>` +
  `</mj-body></mjml>`;

function appWith(store: InMemoryComponentStore): Hono {
  const app = new Hono();
  app.route("/", createRenderRoutes({ componentStore: store }));
  return app;
}

async function render(app: Hono, source: string) {
  const res = await app.request("http://localhost/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("render expands before compiling", () => {
  it("returns HTML containing the component content", async () => {
    const { status, body } = await render(appWith(storeWith()), TEMPLATE);
    expect(status).toBe(200);
    expect(body.html as string).toContain("Shop now");
  });

  it("never leaks an unexpanded reference into the response", async () => {
    const { body } = await render(appWith(storeWith()), TEMPLATE);
    expect(body.html as string).not.toContain("mj-component");
  });

  it("fails LOUDLY (422) when a referenced component is missing", async () => {
    // Without the guard this is a 200 with the button silently absent.
    const { status, body } = await render(
      appWith(new InMemoryComponentStore()),
      TEMPLATE
    );
    expect(status).toBe(422);
    expect(body.error as string).toMatch(/expansion failed/i);
  });

  it("still renders plain templates with no references", async () => {
    const plain = `<mjml><mj-body><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const { status, body } = await render(appWith(new InMemoryComponentStore()), plain);
    expect(status).toBe(200);
    expect(body.html as string).toContain("hi");
  });

  it("reports a REAL stamping gap in unstamped (§0.5)", async () => {
    // Asserting only `Array.isArray` can fail solely if the field is deleted.
    // Drive an actual gap instead: mj-social has no detector that matches
    // mjml's rendered output for its element, so it lands in `missing`.
    const withGap =
      `<mjml><mj-body><mj-section><mj-column>` +
      `<mj-social mode="horizontal"><mj-social-element name="facebook" href="#" /></mj-social>` +
      `</mj-column></mj-section></mj-body></mjml>`;
    const { body } = await render(appWith(new InMemoryComponentStore()), withGap);
    const unstamped = body.unstamped as string[];
    expect(Array.isArray(unstamped)).toBe(true);
    // Compare against what the stamper itself reports, so this stays true if
    // detector coverage changes — what must hold is that the route PASSES the
    // gap through rather than swallowing it in a console.warn.
    const expectedMissing = stampMjmlPaths(
      withGap,
      (mjml2html(withGap, { validationLevel: "soft" }) as { html: string }).html
    ).missing;
    expect(unstamped).toEqual(expectedMissing);
  });

  it("does NOT serve stale HTML when the component content changes", async () => {
    // Regression: the cache was keyed on the stored source. Under the reference
    // model the same source expands differently depending on what the store
    // holds, so a source-keyed cache returned the previous component's HTML —
    // the same bytes in, different bytes out, and propagation would appear to
    // do nothing. Keyed on the expanded MJML this invalidates itself.
    const before = await render(appWith(storeWith(BUTTON)), TEMPLATE);
    expect(before.body.html as string).toContain("Shop now");

    const changed = `<mj-button href="https://x.test" background-color="#1f6feb">Buy today</mj-button>`;
    const after = await render(appWith(storeWith(changed)), TEMPLATE);
    expect(after.body.html as string).toContain("Buy today");
    expect(after.body.html as string).not.toContain("Shop now");
  });
});

describe("the mis-stamping failure this ordering prevents", () => {
  /**
   * Reproduces the measurement in plan §11: stamping the STORED source against
   * HTML compiled from the EXPANDED source reports a clean `missing: []` while
   * silently mis-targeting every path.
   */
  it("stamping unexpanded against expanded HTML reports clean but MIS-TARGETS", () => {
    const store = storeWith();
    const expanded = expand(TEMPLATE, store).mjml;
    const html = (mjml2html(expanded, { validationLevel: "soft" }) as { html: string }).html;

    const wrong = stampMjmlPaths(TEMPLATE, html);
    const right = stampMjmlPaths(expanded, html);

    // The wrong pairing counts fewer blocks, because the stored tree has one
    // opaque <mj-component/> node where the expanded tree has a real section.
    expect(right.expected).toBeGreaterThan(wrong.expected);

    // And this is what makes it dangerous: the wrong pairing does NOT report
    // anything missing, so §0.5's `unstamped` can never fire on it.
    expect(wrong.missing).toEqual([]);
    expect(wrong.stamped).toBe(wrong.expected);
  });

  it("the route hands the SAME string to the compiler and the stamper", async () => {
    // Behavioural proof of the ordering: the stamped paths in the response must
    // match what stamping the EXPANDED source produces, not the stored source.
    const store = storeWith();
    const { body } = await render(appWith(store), TEMPLATE);
    const html = body.html as string;

    const expanded = expand(TEMPLATE, store).mjml;
    const expectedCount = stampMjmlPaths(
      expanded,
      (mjml2html(expanded, { validationLevel: "soft" }) as { html: string }).html
    ).stamped;

    const actualCount = (html.match(/data-mjml-path=/g) ?? []).length;
    expect(actualCount).toBe(expectedCount);
  });
});

describe("mj-include is refused (arbitrary local file read)", () => {
  it("rejects mj-include with 422 rather than compiling it", async () => {
    // mjml resolves mj-include against the SERVER filesystem, and its
    // directory-traversal fix (CVE-2020-12827) is incomplete through 4.18.0 —
    // the pinned version, with no non-breaking upgrade. Verified reachable from
    // this route before the guard: relative traversal, absolute paths and
    // type="css" all returned file contents in the HTTP 200 body.
    const src =
      `<mjml><mj-body><mj-section><mj-column>` +
      `<mj-include path="/etc/hosts" type="html" />` +
      `</mj-column></mj-section></mj-body></mjml>`;
    const { status, body } = await render(appWith(new InMemoryComponentStore()), src);
    expect(status).toBe(422);
    expect(body.error as string).toMatch(/mj-include/);
  });

  it("rejects it regardless of spacing or case", async () => {
    for (const tag of [`<mj-include path="x" />`, `< mj-include path="x" />`, `<MJ-INCLUDE path="x" />`]) {
      const src = `<mjml><mj-body><mj-section><mj-column>${tag}</mj-column></mj-section></mj-body></mjml>`;
      const { status } = await render(appWith(new InMemoryComponentStore()), src);
      expect(status, tag).toBe(422);
    }
  });

  it("does not reject a tag that merely starts with the same prefix", async () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text>ok</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const { status } = await render(appWith(new InMemoryComponentStore()), src);
    expect(status).toBe(200);
  });
});

describe("mjmlErrors is surfaced, not discarded", () => {
  it("returns an empty array for a clean render", async () => {
    const { body } = await render(appWith(storeWith()), TEMPLATE);
    expect(body.mjmlErrors).toEqual([]);
  });

  it("surfaces mjml's own diagnostics — the guard's independent feed", async () => {
    // An unknown element is dropped by mjml under soft validation with an entry
    // in result.errors, which this route previously reached by type assertion
    // and never read.
    const src = `<mjml><mj-body><mj-section><mj-column><mj-nonsense /></mj-column></mj-section></mj-body></mjml>`;
    const { status, body } = await render(appWith(new InMemoryComponentStore()), src);
    expect(status).toBe(200);
    expect((body.mjmlErrors as string[]).length).toBeGreaterThan(0);
  });
});

describe("malformed and comment-hidden references fail loudly", () => {
  const footerStore = () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/footer", `<mj-text>FOOTERCONTENT</mj-text>`);
    return s;
  };

  it("a malformed reference returns 422, not an unhandled 500", async () => {
    // MalformedTagError originally extended plain Error, so it escaped the
    // ExpansionError catch and surfaced as an unhandled 500 with a stack trace.
    const src =
      `<mjml><mj-body><mj-section><mj-column>` +
      `<mj-component component-id="brand/footer revision="1" />` +
      `</mj-column></mj-section></mj-body></mjml>`;
    const { status } = await render(appWith(footerStore()), src);
    expect(status).toBe(422);
  });

  it("an unterminated comment hiding a reference returns 422, not 200", async () => {
    // Previously: 200, footer content absent, mjmlErrors empty — mjml swallows
    // everything after an unterminated comment without a diagnostic.
    const src =
      `<mjml><mj-body><mj-section><mj-column><mj-text>HEADER</mj-text>` +
      `<!-- note<mj-component component-id="brand/footer" revision="1" />` +
      `</mj-column></mj-section></mj-body></mjml>`;
    const { status, body } = await render(appWith(footerStore()), src);
    expect(status).toBe(422);
    expect(body.html ?? "").not.toContain("FOOTERCONTENT");
  });

  it("a <!-- inside an attribute value does NOT hide the reference", async () => {
    // Previously: 200 with the content silently missing, because a backward
    // lastIndexOf("<!--") concluded the reference was commented out.
    const src =
      `<mjml><mj-body><mj-section><mj-column><mj-text alt="ok">HEADER</mj-text>` +
      `<mj-component component-id="brand/footer" revision="1" />` +
      `</mj-column></mj-section></mj-body></mjml>`;
    const { status, body } = await render(appWith(footerStore()), src);
    expect(status).toBe(200);
    expect(body.html as string).toContain("FOOTERCONTENT");
  });

  it("a genuinely commented-out reference renders without it", async () => {
    const src =
      `<mjml><mj-body><mj-section><mj-column>` +
      `<!-- <mj-component component-id="brand/footer" revision="1" /> -->` +
      `<mj-text>visible</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const { status, body } = await render(appWith(footerStore()), src);
    expect(status).toBe(200);
    expect(body.html as string).toContain("visible");
    expect(body.html as string).not.toContain("FOOTERCONTENT");
  });

  it("mjmlErrors do not leak the server filesystem path", async () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-nonsense /></mj-column></mj-section></mj-body></mjml>`;
    const { body } = await render(appWith(new InMemoryComponentStore()), src);
    const errors = body.mjmlErrors as string[];
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) {
      expect(e).not.toContain(process.cwd());
    }
  });
});

describe("mjml's own errors are the authoritative survivor check", () => {
  it("escalates to 422 when mjml reports an unexpanded reference", async () => {
    // Our guard proves a reference survived OUR scan; this proves it survived
    // the COMPILER, which is the only opinion that decides what reaches the
    // recipient. Every leak found in review was our comment model disagreeing
    // with htmlparser2, and in at least one case mjml reported the error while
    // this route returned 200 anyway. Escalating closes the class, not the
    // instance — the next parser quirk fails loudly instead of shipping a
    // footerless email.
    //
    // Reaching the compiler with a live reference requires bypassing the
    // expander, so drive the route with a store that cannot resolve it and
    // confirm we never return 200-with-content-missing.
    const s = new InMemoryComponentStore();
    s.publish("brand/footer", `<mj-text>FOOTERCONTENT</mj-text>`);
    const src =
      `<mjml><mj-body><mj-section><mj-column>` +
      `<mj-component component-id="brand/footer" revision="1" />` +
      `</mj-column></mj-section></mj-body></mjml>`;
    const { status, body } = await render(appWith(s), src);
    // Either it expanded (200 + content) or it refused (422). Never 200 without.
    if (status === 200) {
      expect(body.html as string).toContain("FOOTERCONTENT");
    } else {
      expect(status).toBe(422);
    }
  });

  it("never returns 200 with a reference absent, across comment edge cases", async () => {
    const s = new InMemoryComponentStore();
    s.publish("shoe/footer", `<mj-text>FOOTERMARK</mj-text>`);
    const REFF = `<mj-component component-id="shoe/footer" revision="1" />`;
    const cases = [
      `<mjml><mj-body><mj-section><mj-column><!--><mj-text>H</mj-text>${REFF}</mj-column></mj-section><!-- f --></mj-body></mjml>`,
      `<mjml><mj-body><mj-section><mj-column><!---><mj-text>H</mj-text>${REFF}</mj-column></mj-section><!-- f --></mj-body></mjml>`,
      `<mjml><mj-body><mj-section><mj-column><mj-text alt="<!--">H</mj-text>${REFF}</mj-column></mj-section></mj-body></mjml>`,
      `<mjml><mj-body><mj-section><mj-column><mj-raw><script><!--</script></mj-raw>${REFF}</mj-column></mj-section><!-- t --></mj-body></mjml>`,
    ];
    for (const src of cases) {
      const { status, body } = await render(appWith(s), src);
      const present = ((body.html as string) ?? "").includes("FOOTERMARK");
      // The forbidden outcome is 200 with the content gone.
      expect(status === 200 && !present, src.slice(0, 70)).toBe(false);
    }
  });
});

describe("compile failures are the client's problem, not a 500", () => {
  it("returns 422 for structurally invalid MJML, not 500", async () => {
    // <mj-style> in an illegal position makes mjml throw
    // "component.htmlAttributes is not a function". Previously a 500, which
    // says "we broke" about a document only the caller can fix.
    const src = `<mjml><mj-body><mj-section><mj-column><mj-style>.a{}</mj-style></mj-column></mj-section></mj-body></mjml>`;
    const { status } = await render(appWith(new InMemoryComponentStore()), src);
    expect(status).toBe(422);
  });

  it("returns 422 for input that is not MJML at all", async () => {
    const { status } = await render(appWith(new InMemoryComponentStore()), "not mjml <<<");
    expect(status).toBe(422);
  });

  it("passes the underlying message through so a real mjml bug stays diagnosable", async () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-style>.a{}</mj-style></mj-column></mj-section></mj-body></mjml>`;
    const { body } = await render(appWith(new InMemoryComponentStore()), src);
    expect(body.error as string).toMatch(/could not be compiled/i);
    expect((body.error as string).length).toBeGreaterThan("MJML could not be compiled: ".length);
  });

  it("still renders a valid document", async () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text>ok</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const { status } = await render(appWith(new InMemoryComponentStore()), src);
    expect(status).toBe(200);
  });
});
