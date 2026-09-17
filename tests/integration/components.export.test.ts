import { describe, it, expect } from "vitest";
import {
  InMemoryComponentStore,
  expand,
} from "../../src/shared/components/index.js";

const BUTTON =
  `<a href="https://shoe.test/shop?utm_source=email&amp;utm_medium=cta" ` +
  `style="background:#1f6feb;color:#ffffff">Shop now</a>`;

function store(): InMemoryComponentStore {
  const s = new InMemoryComponentStore();
  s.publish("shoe-brand/primary-button", BUTTON);
  return s;
}

function ref(revision: number, overrides = ""): string {
  return `<x-component component-id="shoe-brand/primary-button" revision="${revision}"${overrides} />`;
}

function template(inner: string): string {
  return (
    `<html>\n  <body>\n    <table>\n      <tr><td>\n        ` +
    inner +
    `\n      </td></tr>\n    </table>\n  </body>\n</html>\n`
  );
}


describe("expanded export is portable HTML", () => {
  const cases: Array<[string, string]> = [
    ["plain reference", template(ref(1))],
    ["reference with an attribute override", template(ref(1, ` ov-style="background:#c0392b"`))],
    [
      "reference nested inside an unrelated wrapper",
      `<html><body><div><table><tr><td>${ref(1)}</td></tr></table></div></body></html>`,
    ],
  ];

  for (const [label, src] of cases) {
    it(`${label}: expands without throwing`, () => {
      expect(() => expand(src, store())).not.toThrow();
    });

    it(`${label}: leaves no reference behind`, () => {
      const { html } = expand(src, store());
      expect(html).not.toContain("x-component");
    });

    it(`${label}: actually contains the component content`, () => {
      const { html } = expand(src, store());
      expect(html).toContain("Shop now");
    });
  }

  it("preserves an entity-bearing tracking URL through export", () => {
    const { html } = expand(template(ref(1)), store());
    expect(html).toContain("utm_source=email&amp;utm_medium=cta");
    expect(html).not.toContain("&amp;amp;");
  });

  it("is deterministic — exporting twice yields identical bytes", () => {
    const s = store();
    const src = template(ref(1));
    expect(expand(src, s).html).toBe(expand(src, s).html);
  });

  it("an exported file no longer depends on the store at all", () => {
    const { html } = expand(template(ref(1)), store());
    expect(() => expand(html, new InMemoryComponentStore())).not.toThrow();
  });
});
