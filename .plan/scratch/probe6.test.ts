/**
 * Settles verdict-model.md's only unverified load-bearing claim (its §6 /
 * "what would make me switch" item 2): does `css-class` survive compilation
 * onto the element stampPaths matches, per allowed component root type — and
 * does a non-stampable reference tag cause SILENT off-by-one overlay stamping?
 */
import { describe, it, expect } from "vitest";
import { stampMjmlPaths } from "../../src/shared/blocks/stampPaths.js";
// @ts-expect-error
import mjml2html from "mjml";

const compile = (s: string) => (mjml2html(s, { validationLevel: "soft" }) as { html: string }).html;

describe("CLAIM 1 — does css-class reach the element stampPaths matches?", () => {
  const roots: Array<[string, string]> = [
    ["mj-section", `<mj-section css-class="mjcmp-test" background-color="#eee"><mj-column><mj-text>c</mj-text></mj-column></mj-section>`],
    ["mj-wrapper", `<mj-wrapper css-class="mjcmp-test"><mj-section><mj-column><mj-text>c</mj-text></mj-column></mj-section></mj-wrapper>`],
    ["mj-hero",    `<mj-hero css-class="mjcmp-test" background-color="#eee"><mj-text>c</mj-text></mj-hero>`],
    ["mj-column",  `<mj-section><mj-column css-class="mjcmp-test"><mj-text>c</mj-text></mj-column></mj-section>`],
  ];
  for (const [name, frag] of roots) {
    it(name, () => {
      const html = compile(`<mjml><mj-body>${frag}</mj-body></mjml>`);
      const hits = [...html.matchAll(/<(\w+)[^>]*class="([^"]*mjcmp-test[^"]*)"[^>]*>/g)];
      console.log(`\n${name}: css-class occurrences = ${hits.length}`);
      for (const h of hits) console.log(`   <${h[1]} class="${h[2]}">`);
      // Which element does stampPaths put data-mjml-path on, for the same input?
      const st = stampMjmlPaths(`<mjml><mj-body>${frag}</mj-body></mjml>`, html);
      const stamped = [...st.html.matchAll(/<(\w+)[^>]*data-mjml-path="([^"]*)"[^>]*class="([^"]*)"[^>]*>/g)];
      console.log(`   stampPaths: stamped=${st.stamped}/${st.expected} missing=${JSON.stringify(st.missing)}`);
      for (const s of stamped) console.log(`   STAMPED <${s[1]} path="${s[2]}" class="${s[3]}">`);
      const sameEl = st.html.includes('data-mjml-path') &&
        /<\w+[^>]*(data-mjml-path="[^"]*"[^>]*class="[^"]*mjcmp-test|class="[^"]*mjcmp-test[^"]*"[^>]*data-mjml-path)/.test(st.html);
      console.log(`   >>> css-class and data-mjml-path on the SAME element? ${sameEl}`);
    });
  }
});

describe("CLAIM 2 — the silent off-by-one: unexpanded source vs expanded HTML", () => {
  it("a non-stampable reference tag ahead of a real section", () => {
    // Stored form: reference tag, then a plain section.
    const stored = `<mjml><mj-body><mj-component component-id="b/footer" revision="4" /><mj-section background-color="#abc"><mj-column><mj-text>REAL</mj-text></mj-column></mj-section></mj-body></mjml>`;
    // Expanded form: what actually gets compiled.
    const expanded = `<mjml><mj-body><mj-section background-color="#111"><mj-column><mj-text>FOOTER</mj-text></mj-column></mj-section><mj-section background-color="#abc"><mj-column><mj-text>REAL</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const html = compile(expanded);

    const wrong = stampMjmlPaths(stored, html);
    console.log(`\nstamp(STORED source, EXPANDED html): stamped=${wrong.stamped}/${wrong.expected} missing=${JSON.stringify(wrong.missing)}`);
    const p0 = wrong.html.indexOf('data-mjml-path="0"');
    const ctx = p0 >= 0 ? wrong.html.slice(p0 - 220, p0 + 60).replace(/\s+/g, " ") : "(path 0 not stamped)";
    console.log(`   what path "0" landed on: …${ctx}…`);
    console.log(`   >>> does path "0" sit on the FOOTER (#111) instead of REAL (#abc)? ${/#111/.test(ctx)}`);
    console.log(`   >>> silent? (stamped === expected, so render.ts never warns): ${wrong.stamped === wrong.expected}`);

    const right = stampMjmlPaths(expanded, html);
    console.log(`stamp(EXPANDED source, EXPANDED html): stamped=${right.stamped}/${right.expected} missing=${JSON.stringify(right.missing)}`);
    expect(right.expected).toBeGreaterThan(wrong.expected);
  });
});

describe("CLAIM 3 — does an UNEXPANDED reference silently vanish from output?", () => {
  it("mjml soft-validation on a surviving mj-component", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text>above</mj-text></mj-column></mj-section><mj-component component-id="b/footer" revision="4" /></mj-body></mjml>`;
    const r = mjml2html(src, { validationLevel: "soft" }) as { html: string; errors?: any[] };
    console.log("errors:", JSON.stringify((r.errors ?? []).map((e: any) => e.message)));
    console.log("component-id reaches HTML?", r.html.includes("component-id"));
    console.log("rest of the email still renders?", r.html.includes("above"));
    console.log(">>> a missed expansion = silently footerless email, HTTP 200:", !r.html.includes("component-id") && r.html.includes("above"));
  });
});
