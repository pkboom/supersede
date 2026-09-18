import { describe, it, expect } from "vitest";
import {
  ExpansionError,
  UnexpandedReferenceError,
  ComponentNotFoundError,
  MAX_EXPANSION_DEPTH,
} from "../../src/types.js";
import {
  findTag,
  findAllTags,
  MalformedTagError,
  UnterminatedCommentError,
} from "../../src/tagScan.js";
import { InMemoryComponentStore } from "../../src/store.js";
import { expand } from "../../src/expander.js";
const BUTTON_V1 = `<a href="https://shoe.test/shop" background-color="#1f6feb" color="#ffffff">Shop now</a>`;
const BUTTON_V2 = `<a href="https://shoe.test/shop" background-color="#111111" color="#ffffff">Shop now</a>`;
function storeWithButton() {
  const s = new InMemoryComponentStore();
  s.publish("shoe-brand/primary-button", BUTTON_V1, { label: "Primary button" });
  return s;
}
function template(inner) {
  return `<html><body><table><tr><td>${inner}</td></tr></table></body></html>`;
}
const REF = `<x-component component-id="shoe-brand/primary-button" revision="1" />`;
describe("store — immutable revisions", () => {
  it("publishes monotonically from 1", () => {
    const s = new InMemoryComponentStore();
    expect(s.publish("a/b", `<p>x</p>`).revision).toBe(1);
    expect(s.publish("a/b", `<p>y</p>`).revision).toBe(2);
    expect(s.latest("a/b").revision).toBe(2);
  });
  it("keeps old revisions readable after a newer one is published", () => {
    const s = new InMemoryComponentStore();
    s.publish("a/b", `<p>old</p>`);
    s.publish("a/b", `<p>new</p>`);
    expect(s.get("a/b", 1).body).toContain("old");
    expect(s.get("a/b", 2).body).toContain("new");
  });
  it("rejects a multi-root body (single-root invariant)", () => {
    const s = new InMemoryComponentStore();
    expect(() => s.publish("a/b", `<p>one</p><p>two</p>`)).toThrow(ExpansionError);
  });
  it("accepts a single root that CONTAINS children", () => {
    const s = new InMemoryComponentStore();
    expect(() => s.publish("a/b", `<tr><td><p>x</p></td></tr>`)).not.toThrow();
  });
  it("rejects an empty body", () => {
    const s = new InMemoryComponentStore();
    expect(() => s.publish("a/b", "   ")).toThrow(ExpansionError);
  });
  it("rejects a self-referencing component", () => {
    const s = new InMemoryComponentStore();
    expect(() =>
      s.publish("a/b", `<tr><x-component component-id="a/b" revision="1" /></tr>`),
    ).toThrow(/references itself/);
  });
  it("round-trips through JSON", () => {
    const s = storeWithButton();
    const back = InMemoryComponentStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(back.get("shoe-brand/primary-button", 1).body).toBe(BUTTON_V1);
  });
});
describe("quote-aware tag scanning", () => {
  it("does NOT truncate on a raw > inside an attribute value", () => {
    const src = `<x-component component-id="a/b" revision="1" ov-content="a > b" />`;
    const tag = findTag(src, "x-component");
    expect(tag).not.toBeNull();
    expect(tag.end).toBe(src.length);
    expect(tag.attrs.find((a) => a.name === "ov-content").value).toBe("a > b");
  });
  it("does not match a longer tag that merely starts with the name", () => {
    const src = `<x-component-group foo="1" />`;
    expect(findTag(src, "x-component")).toBeNull();
  });
  it("finds multiple non-overlapping tags", () => {
    const src = `${REF}<p>x</p>${REF}`;
    expect(findAllTags(src, "x-component")).toHaveLength(2);
  });
  it("handles single-quoted values", () => {
    const tag = findTag(`<x-component component-id='a/b' revision='2' />`, "x-component");
    expect(tag.attrs.find((a) => a.name === "revision").value).toBe("2");
  });
});
describe("expand — substitution", () => {
  it("replaces the reference with the pinned revision's body", () => {
    const { html } = expand(template(REF), storeWithButton());
    expect(html).toContain("Shop now");
    expect(html).not.toContain("x-component");
  });
  it("expands three templates from ONE component (the slice's shape)", () => {
    const store = storeWithButton();
    const templates = [
      template(`<p>Welcome</p>${REF}`),
      template(`<p>Sale</p>${REF}`),
      template(`${REF}<p>Footer</p>`),
    ];
    for (const t of templates) {
      expect(expand(t, store).html).toContain("#1f6feb");
    }
  });
  it("records one region per instance, with provenance", () => {
    const { html, regions } = expand(template(`${REF}${REF}`), storeWithButton());
    expect(regions).toHaveLength(2);
    for (const r of regions) {
      expect(r.componentId).toBe("shoe-brand/primary-button");
      expect(r.revision).toBe(1);
      expect(r.instancePath).toHaveLength(1);
      expect(html.slice(r.start, r.end)).toContain("Shop now");
    }
  });
  it("gives two instances of the SAME component distinguishable chains", () => {
    const { regions } = expand(template(`${REF}${REF}`), storeWithButton());
    expect(regions[0].instancePath).not.toEqual(regions[1].instancePath);
  });
  it("expandedPathRange is the SIBLING index, not a count of references", () => {
    const { regions } = expand(template(`<p>first</p>${REF}`), storeWithButton());
    expect(regions[0].expandedPathRange).toEqual([1, 1]);
  });
  it("keeps expandedPathRange a RANGE even though it is always [n, n]", () => {
    const { regions } = expand(template(`${REF}${REF}`), storeWithButton());
    expect(regions[0].expandedPathRange).toEqual([0, 0]);
    expect(regions[1].expandedPathRange).toEqual([1, 1]);
  });
  it("rebases NESTED region offsets into the final output", () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/button", `<a href="#">GOMARKER</a>`);
    s.publish(
      "brand/card",
      `<tr><td><x-component component-id="brand/button" revision="1" /></td></tr>`,
    );
    const src =
      `<html><body>` +
      `<tr><td><p>PADDING PADDING PADDING</p></td></tr>` +
      `<x-component component-id="brand/card" revision="1" />` +
      `</body></html>`;
    const { html, regions } = expand(src, s);
    const inner = regions.find((r) => r.componentId === "brand/button");
    expect(html.slice(inner.start, inner.end)).toContain("GOMARKER");
  });
  it("leaves non-component HTML untouched", () => {
    const src = template(`<p>hello</p>`);
    expect(expand(src, storeWithButton()).html).toBe(src);
  });
});
describe("expand — the throw-on-survivor guard", () => {
  const leakyStore = {
    get: () => ({
      componentId: "leaky/x",
      revision: 1,
      body: `<tr><x-component component-id="ghost/y" revision="9" /></tr>`,
      publishedAt: new Date(),
    }),
    latest: () => undefined,
    list: () => [],
  };
  it("throws rather than returning HTML with a surviving reference", () => {
    const src = template(`<x-component component-id="leaky/x" revision="1" />`);
    expect(() => expand(src, leakyStore)).toThrow(ExpansionError);
  });
  it("refuses a malformed reference with a typed ExpansionError", () => {
    const src = `<html><body><x-component component-id="a/b revision="1" /></body></html>`;
    expect(() => expand(src, storeWithButton())).toThrow(MalformedTagError);
    expect(() => expand(src, storeWithButton())).toThrow(ExpansionError);
  });
  it("FIRES the survivor guard on a reference formed only by splicing", () => {
    const spliced = {
      get: () => ({
        componentId: "splice/x",
        revision: 1,
        body: `<tr><p>x</p></tr><x-comp`,
        publishedAt: new Date(),
      }),
      latest: () => undefined,
      list: () => [],
    };
    const src = `<html><body><x-component component-id="splice/x" revision="1" />onent component-id="ghost/y" revision="1" /></body></html>`;
    expect(() => expand(src, spliced)).toThrow(UnexpandedReferenceError);
  });
  it("refuses an unterminated comment rather than guessing", () => {
    const src = `<html><body><p>H</p><!-- note${REF}</body></html>`;
    expect(() => expand(src, storeWithButton())).toThrow(UnterminatedCommentError);
  });
  it("does NOT treat a <!-- inside an attribute value as a comment", () => {
    const src = `<html><body><table><tr><td><p alt="<!--">H</p>${REF}</td></tr></table></body></html>`;
    const { html } = expand(src, storeWithButton());
    expect(html).toContain("Shop now");
  });
  it("does NOT fire on a reference inside a comment", () => {
    const s = new InMemoryComponentStore();
    s.publish("c/m", `<p>EXPANDED</p>`);
    const src = `<html><body><!-- <x-component component-id="c/m" revision="1" /> --><tr><td><p>real</p></td></tr></table></body></html>`;
    const { html } = expand(src, s);
    expect(html).not.toContain("EXPANDED");
  });
  it("does not trip on an entity-encoded mention of the tag", () => {
    const sneaky = {
      get: () => ({
        componentId: "sneaky/x",
        revision: 1,
        body: `<tr data-x="&lt;x-component"><p>ok</p></tr>`,
        publishedAt: new Date(),
      }),
      latest: () => undefined,
      list: () => [],
    };
    expect(() =>
      expand(template(`<x-component component-id="sneaky/x" revision="1" />`), sneaky),
    ).not.toThrow();
  });
  it("UnexpandedReferenceError carries the survivors", () => {
    const smuggler = {
      get: () => ({
        componentId: "smuggle/x",
        revision: 1,
        body: `<tr>${"<"}x-component component-id="ghost/y" revision="1</tr>`,
        publishedAt: new Date(),
      }),
      latest: () => undefined,
      list: () => [],
    };
    let caught;
    try {
      expand(template(`<x-component component-id="smuggle/x" revision="1" />`), smuggler);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ExpansionError);
  });
  it("throws ComponentNotFoundError for an unknown component", () => {
    expect(() =>
      expand(template(`<x-component component-id="nope/x" revision="1" />`), storeWithButton()),
    ).toThrow(ComponentNotFoundError);
  });
  it("throws for a reference with no revision", () => {
    expect(() =>
      expand(
        template(`<x-component component-id="shoe-brand/primary-button" />`),
        storeWithButton(),
      ),
    ).toThrow(/no usable revision/);
  });
  it("throws for a reference with no component-id", () => {
    expect(() => expand(template(`<x-component revision="1" />`), storeWithButton())).toThrow(
      /no component-id/,
    );
  });
});
describe("expand — overrides (ov-*)", () => {
  it("overrides an attribute on the component root", () => {
    const src = template(
      `<x-component component-id="shoe-brand/primary-button" revision="1" ov-background-color="#ff0000" />`,
    );
    const { html } = expand(src, storeWithButton());
    expect(html).toContain(`background-color="#ff0000"`);
    expect(html).not.toContain("#1f6feb");
  });
  it("preserves attribute ORDER when overriding an existing attribute", () => {
    const src = template(
      `<x-component component-id="shoe-brand/primary-button" revision="1" ov-background-color="#ff0000" />`,
    );
    const { html } = expand(src, storeWithButton());
    const tag = findTag(html, "a");
    expect(tag.attrs.map((a) => a.name)).toEqual(["href", "background-color", "color"]);
  });
  it("appends an attribute the component did not have", () => {
    const src = template(
      `<x-component component-id="shoe-brand/primary-button" revision="1" ov-border-radius="8px" />`,
    );
    const { html } = expand(src, storeWithButton());
    expect(html).toContain(`border-radius="8px"`);
  });
  it("records the ov-key binding in the region's overridable map", () => {
    const src = template(
      `<x-component component-id="shoe-brand/primary-button" revision="1" ov-background-color="#ff0000" />`,
    );
    const { regions } = expand(src, storeWithButton());
    expect(regions[0].overridable.get("ov-background-color")).toBe("");
  });
  it("records EVERY root override, not just the last", () => {
    const src = template(
      `<x-component component-id="shoe-brand/primary-button" revision="1" ` +
        `ov-color="#fff" ov-background-color="#000" ov-padding="4px" />`,
    );
    const { regions } = expand(src, storeWithButton());
    expect([...regions[0].overridable.keys()].sort()).toEqual([
      "ov-background-color",
      "ov-color",
      "ov-padding",
    ]);
  });
  it("does not let one instance's override leak into another", () => {
    const src = template(
      `<x-component component-id="shoe-brand/primary-button" revision="1" ov-background-color="#ff0000" />` +
        REF,
    );
    const { html } = expand(src, storeWithButton());
    expect(html).toContain("#ff0000");
    expect(html).toContain("#1f6feb");
  });
  it("overrides a named text slot", () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/hero", `<tr><td><p data-slot="headline">Default</p></td></tr>`);
    const { html, regions } = expand(
      template(`<x-component component-id="brand/hero" revision="1" ov-slot-headline="Custom" />`),
      s,
    );
    expect(html).toContain("Custom");
    expect(html).not.toContain("Default");
    expect(regions[0].overridable.has("ov-slot-headline")).toBe(true);
  });
  it("strips the data-slot marker from expanded output when the slot IS overridden", () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/hero", `<tr><td><p data-slot="headline">Default</p></td></tr>`);
    const { html } = expand(
      template(`<x-component component-id="brand/hero" revision="1" ov-slot-headline="Custom" />`),
      s,
    );
    expect(html).toContain("Custom");
    expect(html).not.toContain("data-slot");
  });
  it("strips the data-slot marker even when the slot is NOT overridden", () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/hero", `<tr><td><p data-slot="headline">Default</p></td></tr>`);
    const { html } = expand(template(`<x-component component-id="brand/hero" revision="1" />`), s);
    expect(html).toContain("Default");
    expect(html).not.toContain("data-slot");
  });
  it("removes ONLY the marker, leaving surrounding attribute formatting verbatim", () => {
    const s = new InMemoryComponentStore();
    s.publish(
      "brand/odd",
      `<tr><td><p data-slot="h" color='#ff0000'   font-size="12px" >Hi</p></td></tr>`,
    );
    const { html } = expand(template(`<x-component component-id="brand/odd" revision="1" />`), s);
    expect(html).not.toContain("data-slot");
    expect(html).toContain(`<p color='#ff0000'   font-size="12px" >Hi</p>`);
  });
  it("does not touch a data-slot substring occurring inside another attribute value", () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/txt", `<tr><td><p alt="data-slot=notreal">x</p></td></tr>`);
    const { html } = expand(template(`<x-component component-id="brand/txt" revision="1" />`), s);
    expect(html).toContain(`alt="data-slot=notreal"`);
  });
  it("throws when a slot override targets a slot that does not exist", () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/hero", `<tr><td><p>x</p></td></tr>`);
    expect(() =>
      expand(
        template(`<x-component component-id="brand/hero" revision="1" ov-slot-nope="y" />`),
        s,
      ),
    ).toThrow(/no element with data-slot/);
  });
  it("keeps entity-encoded override values byte-stable across expansions", () => {
    const src = template(
      `<x-component component-id="shoe-brand/primary-button" revision="1" ov-href="https://x.test/?a=1&amp;b=2" />`,
    );
    const store = storeWithButton();
    const first = expand(src, store).html;
    expect(first).toContain(`href="https://x.test/?a=1&amp;b=2"`);
    expect(first).not.toContain("&amp;amp;");
  });
});
describe("expand — nesting and the depth cap", () => {
  it("expands a component that references another component", () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/button", `<a href="#">Go</a>`);
    s.publish(
      "brand/card",
      `<tr><td><x-component component-id="brand/button" revision="1" /></td></tr>`,
    );
    const { html, regions } = expand(
      template(`<x-component component-id="brand/card" revision="1" />`),
      s,
    );
    expect(html).toContain("Go");
    expect(html).not.toContain("x-component");
    expect(regions).toHaveLength(2);
  });
  it("gives a nested region an instancePath CHAIN, outermost first", () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/button", `<a href="#">Go</a>`);
    s.publish(
      "brand/card",
      `<tr><td><x-component component-id="brand/button" revision="1" /></td></tr>`,
    );
    const { regions } = expand(
      template(`<x-component component-id="brand/card" revision="1" />`),
      s,
    );
    const inner = regions.find((r) => r.componentId === "brand/button");
    expect(inner.instancePath).toHaveLength(2);
    expect(inner.instancePath[0]).toMatch(/^brand\/card@1#/);
    expect(inner.instancePath[1]).toMatch(/^brand\/button@1#/);
  });
  it("throws past the depth cap instead of recursing forever", () => {
    const cyclic = {
      get: (id) => ({
        componentId: id,
        revision: 1,
        body: `<tr><x-component component-id="${id === "x" ? "y" : "x"}" revision="1" /></tr>`,
        publishedAt: new Date(),
      }),
      latest: () => undefined,
      list: () => [],
    };
    expect(() => expand(template(`<x-component component-id="x" revision="1" />`), cyclic)).toThrow(
      new RegExp(`depth cap of ${MAX_EXPANSION_DEPTH}`),
    );
  });
});
describe("expand — pins (the dry-run diff)", () => {
  it("pins override the revision written in the template", () => {
    const s = storeWithButton();
    s.publish("shoe-brand/primary-button", BUTTON_V2);
    const src = template(REF);
    expect(expand(src, s).html).toContain("#1f6feb");
    expect(expand(src, s, { pins: { "shoe-brand/primary-button": 2 } }).html).toContain("#111111");
  });
  it("the diff is real before/after HTML, both pure functions of stored data", () => {
    const s = storeWithButton();
    s.publish("shoe-brand/primary-button", BUTTON_V2);
    const src = template(REF);
    const before = expand(src, s).html;
    const after = expand(src, s, { pins: { "shoe-brand/primary-button": 2 } }).html;
    expect(before).not.toBe(after);
    expect(src).toContain(`revision="1"`);
  });
});
describe("comment scanning agrees with htmlparser2 (html's parser)", () => {
  const store = () => {
    const s = new InMemoryComponentStore();
    s.publish("shoe/footer", `<p>FOOTERMARK</p>`);
    return s;
  };
  const REFF = `<x-component component-id="shoe/footer" revision="1" />`;
  it("treats <!--> as a COMPLETE comment, not one running to the next -->", () => {
    const src = `<html><body><table><tr><td><!--><p>Hello</p>${REFF}</td></tr><!-- footer --></body></html>`;
    expect(expand(src, store()).html).toContain("FOOTERMARK");
  });
  it("treats <!---> as a COMPLETE comment", () => {
    const src = `<html><body><table><tr><td><!---><p>Hello</p>${REFF}</td></tr><!-- footer --></body></html>`;
    expect(expand(src, store()).html).toContain("FOOTERMARK");
  });
  it("does not treat <!-- inside a raw-text element as a comment opener", () => {
    const src = `<html><body><table><tr><td><span><script><!--</script></span>${REFF}</td></tr><!-- t --></body></html>`;
    expect(expand(src, store()).html).toContain("FOOTERMARK");
  });
  it("still ignores a genuinely commented-out reference", () => {
    const src = `<html><body><table><tr><td><!-- ${REFF} --><p>vis</p></td></tr></table></body></html>`;
    const { html } = expand(src, store());
    expect(html).not.toContain("FOOTERMARK");
  });
  it("does NOT reject a stray <!-- in a template with no references", () => {
    const src = `<html><body><table><tr><td><p>Hello</p></td></tr></body><!-- note</html>`;
    expect(() => expand(src, store())).not.toThrow();
  });
  it("DOES reject a stray <!-- when the template carries a reference", () => {
    const src = `<html><body><table><tr><td><p>H</p><!-- note${REFF}</td></tr></table></body></html>`;
    expect(() => expand(src, store())).toThrow(UnterminatedCommentError);
  });
  it("expands a 200-reference document quickly enough for the render path", () => {
    const s = new InMemoryComponentStore();
    s.publish("b/btn", `<a href="#">Go</a>`);
    const pad = Array.from(
      { length: 300 },
      (_, i) => `<p>Filler ${i} with a realistic amount of body copy.</p>`,
    ).join("");
    const refs = Array.from(
      { length: 200 },
      () => `<x-component component-id="b/btn" revision="1" />`,
    ).join("");
    const src = `<html><body><table><tr><td>${pad}${refs}</td></tr></table></body></html>`;
    const t0 = performance.now();
    expand(src, s);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
describe("unterminated comments in component BODIES (the fourth silent-200 path)", () => {
  it("publish() rejects an unterminated comment in a body", () => {
    const s = new InMemoryComponentStore();
    expect(() => s.publish("c/bad", `<span><!-- oops</span>`)).toThrow(UnterminatedCommentError);
  });
  it("expansion still catches a body from a store that did not validate", () => {
    const unvalidated = {
      get: () => ({
        componentId: "c/bad",
        revision: 1,
        body: `<span><!-- oops</span>`,
        publishedAt: new Date(),
      }),
      latest: () => undefined,
      list: () => [],
    };
    const src = `<html><body><table><tr><td><x-component component-id="c/bad" revision="1" /><p>SIBLING</p></td></tr></table></body></html>`;
    expect(() => expand(src, unvalidated)).toThrow(UnterminatedCommentError);
  });
});
describe("CDATA is not markup", () => {
  it("a CDATA section containing > and <!-- does not create a phantom comment", () => {
    const s = new InMemoryComponentStore();
    s.publish("c/x", `<p>CMARK</p>`);
    const src = `<html><body><table><tr><td><span><![CDATA[a>b<!--]]></span><x-component component-id="c/x" revision="1" /><!-- t --></td></tr></table></body></html>`;
    expect(expand(src, s).html).toContain("CMARK");
  });
});
describe("the unterminated-comment rejection is scoped to references it could hide", () => {
  const store = () => {
    const s = new InMemoryComponentStore();
    s.publish("c/x", `<p>CMARK</p>`);
    return s;
  };
  it("does NOT reject when every reference precedes the stray <!--", () => {
    const src = `<html><body><table><tr><td><x-component component-id="c/x" revision="1" /></td></tr></body><!-- trailing</html>`;
    expect(() => expand(src, store())).not.toThrow();
  });
  it("DOES reject when a reference sits after the stray <!--", () => {
    const src = `<html><body><table><tr><td><!-- note<x-component component-id="c/x" revision="1" /></td></tr></table></body></html>`;
    expect(() => expand(src, store())).toThrow(UnterminatedCommentError);
  });
});
describe("below-root overrides (ov-at-<path>-<attr>)", () => {
  const card = () => {
    const s = new InMemoryComponentStore();
    s.publish(
      "brand/card",
      `<td><img src="/a.png" /><p>Copy</p><a href="https://default.test">Go</a></td>`,
    );
    return s;
  };
  const tpl = (ov) =>
    `<html><body><tr><x-component component-id="brand/card" revision="1"${ov} /></tr></body></html>`;
  it("overrides a nested CTA's href — the case §11 predicted would fail", () => {
    const { html } = expand(tpl(` ov-tag-2="a" ov-at-2-href="https://custom.test"`), card());
    expect(html).toContain(`href="https://custom.test"`);
    expect(html).not.toContain("https://default.test");
  });
  it("leaves sibling nodes untouched", () => {
    const { html } = expand(tpl(` ov-tag-2="a" ov-at-2-href="https://custom.test"`), card());
    expect(html).toContain(`src="/a.png"`);
    expect(html).toContain("Copy");
  });
  it("adds an attribute the nested node did not have", () => {
    const { html } = expand(tpl(` ov-tag-0="img" ov-at-0-alt="Product photo"`), card());
    expect(html).toContain(`alt="Product photo"`);
  });
  it("applies several overrides to different depths at once", () => {
    const { html } = expand(
      tpl(
        ` ov-tag-0="img" ov-at-0-alt="Photo" ov-tag-2="a" ov-at-2-href="https://x.test" ov-padding="4px"`,
      ),
      card(),
    );
    expect(html).toContain(`alt="Photo"`);
    expect(html).toContain(`href="https://x.test"`);
    expect(html).toContain(`padding="4px"`);
  });
  it("resolves a multi-segment path", () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/wrap", `<tr><td><a href="https://default.test">Go</a></td></tr>`);
    const src = `<html><body><x-component component-id="brand/wrap" revision="1" ov-tag-0.0="a" ov-at-0.0-href="https://deep.test" /></body></html>`;
    expect(expand(src, s).html).toContain(`href="https://deep.test"`);
  });
  it("does not count comments as children, so paths survive a comment", () => {
    const s = new InMemoryComponentStore();
    s.publish(
      "brand/c",
      `<td><!-- a note --><img src="/a.png" /><a href="https://default.test">Go</a></td>`,
    );
    const src = `<html><body><tr><x-component component-id="brand/c" revision="1" ov-tag-1="a" ov-at-1-href="https://custom.test" /></tr></body></html>`;
    expect(expand(src, s).html).toContain(`href="https://custom.test"`);
  });
  it("records the binding in the region's overridable map", () => {
    const { regions } = expand(tpl(` ov-tag-2="a" ov-at-2-href="https://x.test"`), card());
    expect(regions[0].overridable.get("ov-at-2-href")).toBe("2");
  });
  it("throws when the path does not resolve", () => {
    expect(() => expand(tpl(` ov-tag-9="a" ov-at-9-href="https://x.test"`), card())).toThrow(
      /no element at path 9/,
    );
  });
  it("rejects a malformed path", () => {
    expect(() => expand(tpl(` ov-at-abc-href="https://x.test"`), card())).toThrow(/Malformed path/);
  });
  it("rejects a path override with no attribute", () => {
    expect(() => expand(tpl(` ov-at-2="x"`), card())).toThrow(/Malformed path override/);
  });
  it("escapes a quote in a path override value, like the root path does", () => {
    const { html } = expand(tpl(` ov-tag-2="a" ov-at-2-alt='say "hi"'`), card());
    expect(html).toContain("&quot;hi&quot;");
  });
  it("does not change the stored template — blast radius is still the pin", () => {
    const src = tpl(` ov-tag-2="a" ov-at-2-href="https://x.test"`);
    expand(src, card());
    expect(src).toContain(`revision="1"`);
  });
  it("throws when the path resolves to a different tag than asserted", () => {
    const before = new InMemoryComponentStore();
    before.publish(
      "brand/card",
      `<td><img src="/a.png" /><p>Copy</p><a href="https://default.test">Go</a></td>`,
    );
    const after = new InMemoryComponentStore();
    after.publish(
      "brand/card",
      `<td><img src="/a.png" /><a href="https://default.test">Go</a><p>Copy</p></td>`,
    );
    const src = tpl(` ov-tag-2="a" ov-at-2-href="https://custom.test"`);
    expect(expand(src, before).html).toContain("https://custom.test");
    expect(() => expand(src, after)).toThrow(/resolves to <p>.*asserts <a>/s);
  });
  it("without the guard the same rearrangement would land on the wrong node", () => {
    const after = new InMemoryComponentStore();
    after.publish(
      "brand/card",
      `<td><img src="/a.png" /><a href="https://default.test">Go</a><p>Copy</p></td>`,
    );
    const { html } = expand(tpl(` ov-tag-2="p" ov-at-2-href="https://custom.test"`), after);
    expect(html).toMatch(/<p[^>]*href="https:\/\/custom.test"/);
    expect(html).toContain("https://default.test");
  });
  it("requires an assertion for every path override", () => {
    expect(() => expand(tpl(` ov-at-2-href="https://x.test"`), card())).toThrow(
      /has no ov-tag-2 assertion/,
    );
  });
  it("rejects an assertion with no matching override — a stale or mistyped guard", () => {
    expect(() =>
      expand(tpl(` ov-tag-2="a" ov-at-2-href="https://x.test" ov-tag-0="img"`), card()),
    ).toThrow(/ov-tag-0 .*no matching/);
  });
  it("rejects a malformed assertion path", () => {
    expect(() => expand(tpl(` ov-tag-abc="a"`), card())).toThrow(/Malformed tag assertion/);
  });
  it("rejects an assertion value that is not a tag name", () => {
    expect(() => expand(tpl(` ov-tag-2="not a tag"`), card())).toThrow(/Invalid tag name/);
  });
  it("does not treat ov-tag-* as a root attribute", () => {
    const { html } = expand(tpl(` ov-tag-2="a" ov-at-2-href="https://x.test"`), card());
    expect(html).not.toContain("tag-2=");
  });
});
