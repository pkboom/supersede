import mjml2html from "mjml";
const cases: Array<[string,string]> = [
  ["typo'd reference", `<mj-compnent component-id="b/footer" revision="4" />`],
  ["unregistered tag", `<mj-footer-block />`],
  ["control: real mj-component", `<mj-component component-id="b/footer" revision="4" />`],
];
for (const [label, tag] of cases) {
  const src = `<mjml><mj-body><mj-section><mj-column><mj-text>above</mj-text></mj-column></mj-section>${tag}</mj-body></mjml>`;
  const r = mjml2html(src, { validationLevel: "soft" }) as { html: string; errors?: any[] };
  const marker = tag.slice(1, 12);
  console.log(`\n${label}:`);
  console.log(`  errors: ${JSON.stringify((r.errors ?? []).map((e: any) => e.message))}`);
  console.log(`  tag survives into HTML? ${r.html.includes(marker)}`);
  console.log(`  rest still renders (=> 200, content gone)? ${r.html.includes("above")}`);
}
