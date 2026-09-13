import { describe, it } from "vitest";
import { parseMjml, serializeMjml } from "../../src/shared/blocks/index.js";
// @ts-expect-error
import mjml2html from "mjml";

function makeTemplate(sections: number): string {
  const secs = Array.from({ length: sections }, (_, i) => `
    <mj-section data-cmp="brand/section" data-cmp-v="2" background-color="#ffffff" padding="20px 0">
      <mj-column width="50%">
        <mj-image src="https://cdn.test/img${i}.png" alt="img ${i}" width="280px" />
        <mj-text font-size="14px" color="#333333" line-height="1.5">Body copy for section ${i} with some reasonable length of prose that a real email would carry.</mj-text>
        <mj-button data-cmp="brand/primary-button" data-cmp-v="7" href="https://x.test/c/${i}" background-color="#1f6feb" color="#ffffff" border-radius="4px" font-size="16px" padding="12px 24px">Shop now</mj-button>
      </mj-column>
      <mj-column width="50%">
        <mj-divider border-color="#dddddd" border-width="1px" />
        <mj-spacer height="20px" />
        <mj-social mode="horizontal" icon-size="24px"><mj-social-element name="facebook" href="#" /><mj-social-element name="x" href="#" /></mj-social>
      </mj-column>
    </mj-section>`).join("");
  return `<mjml><mj-head><mj-title>T</mj-title><mj-attributes><mj-all font-family="Arial, sans-serif" /></mj-attributes></mj-head><mj-body width="600px">${secs}</mj-body></mjml>`;
}

describe("bench", () => {
  it("parse+serialize timings", () => {
    for (const n of [6, 20, 60]) {
      const src = makeTemplate(n);
      const kb = (src.length / 1024).toFixed(1);
      // warm
      for (let i = 0; i < 20; i++) serializeMjml(parseMjml(src));
      const t0 = performance.now();
      const ITER = 200;
      for (let i = 0; i < ITER; i++) serializeMjml(parseMjml(src));
      const per = (performance.now() - t0) / ITER;
      const tp0 = performance.now();
      for (let i = 0; i < ITER; i++) parseMjml(src);
      const perParse = (performance.now() - tp0) / ITER;
      console.log(`sections=${String(n).padStart(2)} size=${kb.padStart(6)}KB  parse=${perParse.toFixed(3)}ms  parse+serialize=${per.toFixed(3)}ms  x480 templates=${(per*480).toFixed(0)}ms`);
    }
  });
  it("mjml2html render cost (for validation-on-propagate)", () => {
    const src = makeTemplate(20);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) mjml2html(src, { validationLevel: "soft" });
    console.log(`mjml2html 20-section: ${((performance.now()-t0)/10).toFixed(1)}ms each -> x480 = ${(((performance.now()-t0)/10)*480/1000).toFixed(1)}s`);
  });
});
