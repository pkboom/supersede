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

  it("returns unstamped as an array (§0.5)", async () => {
    const { body } = await render(appWith(storeWith()), TEMPLATE);
    expect(Array.isArray(body.unstamped)).toBe(true);
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
