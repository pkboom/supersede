/**
 * Bulk expanded-MJML export — the escape hatch (plan §12, weeks 2-4).
 *
 * The export exists so the corpus outlives this tool: if the expander is buggy
 * or the company disappears, every template is still plain, portable MJML. That
 * promise is only worth something if the exported files actually COMPILE, with
 * no references left in them — so this asserts compilation, not just that a
 * string was written.
 */
import { describe, it, expect } from "vitest";
import mjml2html from "mjml";
import {
  InMemoryComponentStore,
  expand,
} from "../../src/shared/components/index.js";

const BUTTON =
  `<mj-button href="https://shoe.test/shop?utm_source=email&amp;utm_medium=cta" ` +
  `background-color="#1f6feb" color="#ffffff">Shop now</mj-button>`;

function store(): InMemoryComponentStore {
  const s = new InMemoryComponentStore();
  s.publish("shoe-brand/primary-button", BUTTON);
  return s;
}

function ref(revision: number, overrides = ""): string {
  return `<mj-component component-id="shoe-brand/primary-button" revision="${revision}"${overrides} />`;
}

function template(inner: string): string {
  return (
    `<mjml>\n  <mj-body>\n    <mj-section>\n      <mj-column>\n        ` +
    inner +
    `\n      </mj-column>\n    </mj-section>\n  </mj-body>\n</mjml>\n`
  );
}

function compile(src: string) {
  return mjml2html(src, { validationLevel: "soft" }) as {
    html: string;
    errors?: unknown[];
  };
}

describe("expanded export is portable MJML", () => {
  const cases: Array<[string, string]> = [
    ["plain reference", template(ref(1))],
    ["reference with an attribute override", template(ref(1, ` ov-background-color="#c0392b"`))],
    [
      "reference buried in mj-wrapper (unreachable but renderable)",
      `<mjml><mj-body><mj-wrapper><mj-section><mj-column>${ref(1)}</mj-column></mj-section></mj-wrapper></mj-body></mjml>`,
    ],
  ];

  for (const [label, src] of cases) {
    it(`${label}: compiles with zero errors`, () => {
      const { mjml } = expand(src, store());
      const res = compile(mjml);
      expect(res.errors ?? []).toHaveLength(0);
    });

    it(`${label}: leaves no reference behind`, () => {
      const { mjml } = expand(src, store());
      expect(mjml).not.toContain("mj-component");
    });

    it(`${label}: actually contains the component content`, () => {
      const { mjml } = expand(src, store());
      expect(compile(mjml).html).toContain("Shop now");
    });
  }

  it("preserves an entity-bearing tracking URL through export", () => {
    // The §0.2 corruption would have compounded here, once per export.
    const { mjml } = expand(template(ref(1)), store());
    expect(mjml).toContain("utm_source=email&amp;utm_medium=cta");
    expect(mjml).not.toContain("&amp;amp;");
  });

  it("is deterministic — exporting twice yields identical bytes", () => {
    const s = store();
    const src = template(ref(1));
    expect(expand(src, s).mjml).toBe(expand(src, s).mjml);
  });

  it("an exported file no longer depends on the store at all", () => {
    // The actual escape-hatch property: re-expanding the EXPORTED output
    // against an EMPTY store must succeed, because nothing references anything.
    const { mjml } = expand(template(ref(1)), store());
    expect(() => expand(mjml, new InMemoryComponentStore())).not.toThrow();
  });
});
