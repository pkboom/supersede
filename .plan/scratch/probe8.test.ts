import { describe, it } from "vitest";
// @ts-expect-error
import mjml2html from "mjml";
describe("residual silent-drop class the component guard structurally cannot see", () => {
  for (const [label, tag] of [
    ["typo'd reference", `<mj-compnent component-id="b/footer" revision="4" />`],
    ["unregistered tag", `<mj-footer-block />`],
    ["control: real mj-component", `<mj-component component-id="b/footer" revision="4" />`],
  ] as Array<[string,string]>) {
    it(label, () => {
      const src = `<mjml><mj-body><mj-section><mj-column><mj-text>above</mj-text></mj-column></mj-section>${tag}</mj-body></mjml>`;
      const r = mjml2html(src, { validationLevel: "soft" }) as { html: string; errors?: any[] };
      console.log(`\n${label}:`);
      console.log(`  errors: ${JSON.stringify((r.errors ?? []).map((e: any) => e.message))}`);
      console.log(`  tag survives into HTML? ${r.html.includes(tag.slice(1, 12))}`);
      console.log(`  rest still renders (=> HTTP 200, content gone)? ${r.html.includes("above")}`);
    });
  }
});
