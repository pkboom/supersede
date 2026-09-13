import { describe, it } from "vitest";
import { stampMjmlPaths } from "../../src/shared/blocks/stampPaths.js";
// @ts-expect-error
import mjml2html from "mjml";
const compile = (s: string) => (mjml2html(s, { validationLevel: "soft" }) as { html: string }).html;

describe("EXACT — which element carries data-mjml-path, and does it carry css-class?", () => {
  for (const [name, frag] of [
    ["mj-section", `<mj-section css-class="mjcmp-test" background-color="#eee"><mj-column><mj-text>c</mj-text></mj-column></mj-section>`],
    ["mj-column",  `<mj-section><mj-column css-class="mjcmp-test"><mj-text>c</mj-text></mj-column></mj-section>`],
  ] as Array<[string,string]>) {
    it(name, () => {
      const src = `<mjml><mj-body>${frag}</mj-body></mjml>`;
      const st = stampMjmlPaths(src, compile(src));
      console.log(`\n--- ${name} ---`);
      for (const m of st.html.matchAll(/<(\w+)([^>]*data-mjml-path="[^"]*"[^>]*)>/g)) {
        const tag = m[1], attrs = m[2];
        const path = /data-mjml-path="([^"]*)"/.exec(attrs)?.[1];
        const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? "(no class attr)";
        console.log(`  path="${path}" on <${tag}> class="${cls}"  hasCssClass=${cls.includes("mjcmp-test")}`);
      }
    });
  }
});

describe("EXACT — the off-by-one, checking the path that actually exists", () => {
  it("stored tree index 1 stamps onto the WRONG rendered section", () => {
    const stored   = `<mjml><mj-body><mj-component component-id="b/footer" revision="4" /><mj-section background-color="#abcabc"><mj-column><mj-text>REAL</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const expanded = `<mjml><mj-body><mj-section background-color="#111111"><mj-column><mj-text>FOOTER</mj-text></mj-column></mj-section><mj-section background-color="#abcabc"><mj-column><mj-text>REAL</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const html = compile(expanded);
    const st = stampMjmlPaths(stored, html);
    console.log(`stamped=${st.stamped}/${st.expected} missing=${JSON.stringify(st.missing)}  <- render.ts warns only if stamped<expected`);
    for (const m of st.html.matchAll(/<(\w+)([^>]*data-mjml-path="[^"]*"[^>]*)>/g)) {
      const path = /data-mjml-path="([^"]*)"/.exec(m[2])?.[1];
      const bg = /background:\s*(#[0-9a-f]{6})/i.exec(m[2])?.[1] ?? "";
      if (path && !path.includes("/")) console.log(`  top-level path="${path}" -> <${m[1]}> background=${bg}  ${bg==="#111111"?"<<< FOOTER (WRONG)":bg==="#abcabc"?"<<< REAL (right)":""}`);
    }
  });
});
