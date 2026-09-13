/**
 * componentExpander — the reference model's core (plan §11 D-2, §12 weeks 2-4).
 *
 * The guard tests are not ceremony. An unexpanded reference compiles to HTTP
 * 200 with the content silently gone, so "did it throw" is the difference
 * between a loud failure and a footerless email to a client's list.
 */
import { describe, it, expect } from "vitest";
import mjml2html from "mjml";
import {
  InMemoryComponentStore,
  expand,
  locateInstances,
  findTag,
  findAllTags,
  ExpansionError,
  UnexpandedReferenceError,
  ComponentNotFoundError,
  MalformedTagError,
  UnterminatedCommentError,
  MAX_EXPANSION_DEPTH,
} from "../../src/shared/components/index.js";
import type { ComponentStore } from "../../src/shared/components/index.js";

const BUTTON_V1 =
  `<mj-button href="https://shoe.test/shop" background-color="#1f6feb" color="#ffffff">Shop now</mj-button>`;
const BUTTON_V2 =
  `<mj-button href="https://shoe.test/shop" background-color="#111111" color="#ffffff">Shop now</mj-button>`;

function storeWithButton(): InMemoryComponentStore {
  const s = new InMemoryComponentStore();
  s.publish("shoe-brand/primary-button", BUTTON_V1, { label: "Primary button" });
  return s;
}

function template(inner: string): string {
  return `<mjml><mj-body><mj-section><mj-column>${inner}</mj-column></mj-section></mj-body></mjml>`;
}

const REF = `<mj-component component-id="shoe-brand/primary-button" revision="1" />`;

describe("store — immutable revisions", () => {
  it("publishes monotonically from 1", () => {
    const s = new InMemoryComponentStore();
    expect(s.publish("a/b", `<mj-text>x</mj-text>`).revision).toBe(1);
    expect(s.publish("a/b", `<mj-text>y</mj-text>`).revision).toBe(2);
    expect(s.latest("a/b")!.revision).toBe(2);
  });

  it("keeps old revisions readable after a newer one is published", () => {
    const s = new InMemoryComponentStore();
    s.publish("a/b", `<mj-text>old</mj-text>`);
    s.publish("a/b", `<mj-text>new</mj-text>`);
    // This is the whole reference model: a template pinned to 1 is unaffected
    // by publishing 2, until someone bumps the pin deliberately.
    expect(s.get("a/b", 1)!.body).toContain("old");
    expect(s.get("a/b", 2)!.body).toContain("new");
  });

  it("rejects a multi-root body (single-root invariant)", () => {
    const s = new InMemoryComponentStore();
    expect(() =>
      s.publish("a/b", `<mj-text>one</mj-text><mj-text>two</mj-text>`)
    ).toThrow(ExpansionError);
  });

  it("accepts a single root that CONTAINS children", () => {
    const s = new InMemoryComponentStore();
    expect(() =>
      s.publish(
        "a/b",
        `<mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section>`
      )
    ).not.toThrow();
  });

  it("rejects an empty body", () => {
    const s = new InMemoryComponentStore();
    expect(() => s.publish("a/b", "   ")).toThrow(ExpansionError);
  });

  it("rejects a self-referencing component", () => {
    const s = new InMemoryComponentStore();
    expect(() =>
      s.publish(
        "a/b",
        `<mj-section><mj-component component-id="a/b" revision="1" /></mj-section>`
      )
    ).toThrow(/references itself/);
  });

  it("round-trips through JSON", () => {
    const s = storeWithButton();
    const back = InMemoryComponentStore.fromJSON(
      JSON.parse(JSON.stringify(s.toJSON()))
    );
    expect(back.get("shoe-brand/primary-button", 1)!.body).toBe(BUTTON_V1);
  });
});

describe("quote-aware tag scanning", () => {
  it("does NOT truncate on a raw > inside an attribute value", () => {
    // The exact case a naive /<mj-component[^>]*\/>/ gets wrong.
    const src = `<mj-component component-id="a/b" revision="1" ov-content="a > b" />`;
    const tag = findTag(src, "mj-component");
    expect(tag).not.toBeNull();
    expect(tag!.end).toBe(src.length);
    expect(tag!.attrs.find((a) => a.name === "ov-content")!.value).toBe("a > b");
  });

  it("does not match a longer tag that merely starts with the name", () => {
    const src = `<mj-component-group foo="1" />`;
    expect(findTag(src, "mj-component")).toBeNull();
  });

  it("finds multiple non-overlapping tags", () => {
    const src = `${REF}<mj-text>x</mj-text>${REF}`;
    expect(findAllTags(src, "mj-component")).toHaveLength(2);
  });

  it("handles single-quoted values", () => {
    const tag = findTag(`<mj-component component-id='a/b' revision='2' />`, "mj-component");
    expect(tag!.attrs.find((a) => a.name === "revision")!.value).toBe("2");
  });
});

describe("expand — substitution", () => {
  it("replaces the reference with the pinned revision's body", () => {
    const { mjml } = expand(template(REF), storeWithButton());
    expect(mjml).toContain("Shop now");
    expect(mjml).not.toContain("mj-component");
  });

  it("compiles to real HTML with the component content present", () => {
    const { mjml } = expand(template(REF), storeWithButton());
    const res = mjml2html(mjml, { validationLevel: "soft" }) as {
      html: string;
      errors?: unknown[];
    };
    expect(res.html).toContain("Shop now");
    expect(res.errors ?? []).toHaveLength(0);
  });

  it("expands three templates from ONE component (the slice's shape)", () => {
    const store = storeWithButton();
    const templates = [
      template(`<mj-text>Welcome</mj-text>${REF}`),
      template(`<mj-text>Sale</mj-text>${REF}`),
      template(`${REF}<mj-text>Footer</mj-text>`),
    ];
    for (const t of templates) {
      expect(expand(t, store).mjml).toContain("#1f6feb");
    }
  });

  it("records one region per instance, with provenance", () => {
    const { mjml, regions } = expand(template(`${REF}${REF}`), storeWithButton());
    expect(regions).toHaveLength(2);
    for (const r of regions) {
      expect(r.componentId).toBe("shoe-brand/primary-button");
      expect(r.revision).toBe(1);
      // Chains must DIFFER between the two instances — see below.
      expect(r.instancePath).toHaveLength(1);
      // The region's byte range must actually bracket its content in the
      // OUTPUT — this is what makes the range usable by a caller.
      expect(mjml.slice(r.start, r.end)).toContain("Shop now");
    }
  });

  it("gives two instances of the SAME component distinguishable chains", () => {
    const { regions } = expand(template(`${REF}${REF}`), storeWithButton());
    expect(regions[0]!.instancePath).not.toEqual(regions[1]!.instancePath);
  });

  it("expandedPathRange is the SIBLING index, not a count of references", () => {
    // The discriminating fixture: a non-component sibling first. A counter over
    // <mj-component/> tags reports 0 here; the node is sibling 1.
    const { regions } = expand(
      template(`<mj-text>first</mj-text>${REF}`),
      storeWithButton()
    );
    expect(regions[0]!.expandedPathRange).toEqual([1, 1]);
  });

  it("keeps expandedPathRange a RANGE even though it is always [n, n]", () => {
    const { regions } = expand(template(`${REF}${REF}`), storeWithButton());
    expect(regions[0]!.expandedPathRange).toEqual([0, 0]);
    expect(regions[1]!.expandedPathRange).toEqual([1, 1]);
  });

  it("rebases NESTED region offsets into the final output", () => {
    // Regression: a nested region's offsets were computed against the component
    // body's own coordinate space and never rebased, so slicing the final MJML
    // with them did not yield the component.
    const s = new InMemoryComponentStore();
    s.publish("brand/button", `<mj-button href="#">GOMARKER</mj-button>`);
    s.publish(
      "brand/card",
      `<mj-section><mj-column><mj-component component-id="brand/button" revision="1" /></mj-column></mj-section>`
    );
    const src =
      `<mjml><mj-body>` +
      `<mj-section><mj-column><mj-text>PADDING PADDING PADDING</mj-text></mj-column></mj-section>` +
      `<mj-component component-id="brand/card" revision="1" />` +
      `</mj-body></mjml>`;
    const { mjml, regions } = expand(src, s);
    const inner = regions.find((r) => r.componentId === "brand/button")!;
    expect(mjml.slice(inner.start, inner.end)).toContain("GOMARKER");
  });

  it("leaves non-component MJML untouched", () => {
    const src = template(`<mj-text>hello</mj-text>`);
    expect(expand(src, storeWithButton()).mjml).toBe(src);
  });
});

describe("expand — the throw-on-survivor guard", () => {
  /** A store that silently returns a body still containing a reference. */
  const leakyStore: ComponentStore = {
    get: () => ({
      componentId: "leaky/x",
      revision: 1,
      // Deliberately smuggles a reference past substitution.
      body: `<mj-section><mj-component component-id="ghost/y" revision="9" /></mj-section>`,
      publishedAt: new Date(),
    }),
    latest: () => undefined,
    list: () => [],
  };

  it("throws rather than returning MJML with a surviving reference", () => {
    const src = template(`<mj-component component-id="leaky/x" revision="1" />`);
    // The nested ghost/y is not in the store, so expansion fails there first —
    // which is itself the correct loud failure.
    expect(() => expand(src, leakyStore)).toThrow(ExpansionError);
  });

  it("refuses a malformed reference with a typed ExpansionError", () => {
    // Asserting bare `.toThrow()` hid WHICH error fired. This one is raised by
    // the scanner during substitution, and it must be an ExpansionError or it
    // escapes every caller's catch — which produced an unhandled HTTP 500
    // instead of a 422.
    const src = `<mjml><mj-body><mj-component component-id="a/b revision="1" /></mj-body></mjml>`;
    expect(() => expand(src, storeWithButton())).toThrow(MalformedTagError);
    expect(() => expand(src, storeWithButton())).toThrow(ExpansionError);
  });

  it("FIRES the survivor guard on a reference formed only by splicing", () => {
    // The one input that reaches findSurvivors rather than the substitution
    // scanner: the body ends mid-tag, and the template text after the reference
    // completes it. The tag therefore does not exist in either input — only in
    // the concatenated output — so nothing but the exit guard can catch it.
    const spliced: ComponentStore = {
      get: () => ({
        componentId: "splice/x",
        revision: 1,
        body: `<mj-section><mj-text>x</mj-text></mj-section><mj-comp`,
        publishedAt: new Date(),
      }),
      latest: () => undefined,
      list: () => [],
    };
    const src = `<mjml><mj-body><mj-component component-id="splice/x" revision="1" />onent component-id="ghost/y" revision="1" /></mj-body></mjml>`;
    expect(() => expand(src, spliced)).toThrow(UnexpandedReferenceError);
  });

  it("refuses an unterminated comment rather than guessing", () => {
    // Both the substitution scanner and the guard previously used a backward
    // `lastIndexOf("<!--")`, so an unterminated comment made BOTH treat the
    // rest of the document as commented out. mjml agrees and swallows it, so
    // the reference vanished at HTTP 200 with no diagnostic.
    const src = `<mjml><mj-body><mj-text>H</mj-text><!-- note${REF}</mj-body></mjml>`;
    expect(() => expand(src, storeWithButton())).toThrow(UnterminatedCommentError);
  });

  it("does NOT treat a <!-- inside an attribute value as a comment", () => {
    // A backward search finds this `<!--` and wrongly concludes the reference
    // that follows is commented out, so it was neither expanded nor reported.
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text alt="<!--">H</mj-text>${REF}</mj-column></mj-section></mj-body></mjml>`;
    const { mjml } = expand(src, storeWithButton());
    expect(mjml).toContain("Shop now");
  });

  it("does NOT fire on a reference inside a comment", () => {
    // A commented-out reference loses no content — mjml never renders it — so
    // the guard must not false-positive on it, and it must not be expanded.
    const s = new InMemoryComponentStore();
    s.publish("c/m", `<mj-text>EXPANDED</mj-text>`);
    const src = `<mjml><mj-body><!-- <mj-component component-id="c/m" revision="1" /> --><mj-section><mj-column><mj-text>real</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const { mjml } = expand(src, s);
    expect(mjml).not.toContain("EXPANDED");
  });

  it("does not trip on an entity-encoded mention of the tag", () => {
    const sneaky: ComponentStore = {
      get: () => ({
        componentId: "sneaky/x",
        revision: 1,
        body: `<mj-section data-x="&lt;mj-component"><mj-text>ok</mj-text></mj-section>`,
        publishedAt: new Date(),
      }),
      latest: () => undefined,
      list: () => [],
    };
    // Entity-encoded, so it is NOT a real tag and must NOT trip the guard.
    expect(() =>
      expand(template(`<mj-component component-id="sneaky/x" revision="1" />`), sneaky)
    ).not.toThrow();
  });

  it("UnexpandedReferenceError carries the survivors", () => {
    // A store that hands back a body containing a reference assembled so the
    // substitution pass has already finished with it.
    const smuggler: ComponentStore = {
      get: () => ({
        componentId: "smuggle/x",
        revision: 1,
        body: `<mj-section>${"<"}mj-component component-id="ghost/y" revision="1</mj-section>`,
        publishedAt: new Date(),
      }),
      latest: () => undefined,
      list: () => [],
    };
    let caught: unknown;
    try {
      expand(template(`<mj-component component-id="smuggle/x" revision="1" />`), smuggler);
    } catch (e) {
      caught = e;
    }
    // Asserted OUTSIDE a conditional. Guarding the assertion on the type meant
    // the block never ran when a different error fired, leaving `toBeDefined`
    // as the only live check — a test that could not fail.
    expect(caught).toBeInstanceOf(ExpansionError);
  });

  it("PROVES the failure the guard prevents: mjml drops it at HTTP-200 silently", () => {
    // This is the justification for the guard existing at all, asserted rather
    // than described. An unexpanded reference does NOT fail compilation.
    const res = mjml2html(template(REF), { validationLevel: "soft" }) as {
      html: string;
      errors?: unknown[];
    };
    expect(res.html).not.toContain("Shop now");
    expect(res.html).not.toContain("mj-component");
    // The rest of the email still renders — which is what makes it silent.
    expect(res.html.length).toBeGreaterThan(0);
    // And the diagnostic exists but lives somewhere render.ts never reads.
    expect((res.errors ?? []).length).toBeGreaterThan(0);
  });

  it("throws ComponentNotFoundError for an unknown component", () => {
    expect(() =>
      expand(template(`<mj-component component-id="nope/x" revision="1" />`), storeWithButton())
    ).toThrow(ComponentNotFoundError);
  });

  it("throws for a reference with no revision", () => {
    expect(() =>
      expand(template(`<mj-component component-id="shoe-brand/primary-button" />`), storeWithButton())
    ).toThrow(/no usable revision/);
  });

  it("throws for a reference with no component-id", () => {
    expect(() => expand(template(`<mj-component revision="1" />`), storeWithButton())).toThrow(
      /no component-id/
    );
  });
});

describe("expand — overrides (ov-*)", () => {
  it("overrides an attribute on the component root", () => {
    const src = template(
      `<mj-component component-id="shoe-brand/primary-button" revision="1" ov-background-color="#ff0000" />`
    );
    const { mjml } = expand(src, storeWithButton());
    expect(mjml).toContain(`background-color="#ff0000"`);
    expect(mjml).not.toContain("#1f6feb");
  });

  it("preserves attribute ORDER when overriding an existing attribute", () => {
    const src = template(
      `<mj-component component-id="shoe-brand/primary-button" revision="1" ov-background-color="#ff0000" />`
    );
    const { mjml } = expand(src, storeWithButton());
    const tag = findTag(mjml, "mj-button")!;
    expect(tag.attrs.map((a) => a.name)).toEqual([
      "href",
      "background-color",
      "color",
    ]);
  });

  it("appends an attribute the component did not have", () => {
    const src = template(
      `<mj-component component-id="shoe-brand/primary-button" revision="1" ov-border-radius="8px" />`
    );
    const { mjml } = expand(src, storeWithButton());
    expect(mjml).toContain(`border-radius="8px"`);
  });

  it("records the ov-key binding in the region's overridable map", () => {
    const src = template(
      `<mj-component component-id="shoe-brand/primary-button" revision="1" ov-background-color="#ff0000" />`
    );
    const { regions } = expand(src, storeWithButton());
    expect(regions[0]!.overridable.get("ov-background-color")).toBe("");
  });

  it("records EVERY root override, not just the last", () => {
    // Regression: the map was keyed by inner path, and every root override
    // targets the same path (""), so N overrides collapsed to 1.
    const src = template(
      `<mj-component component-id="shoe-brand/primary-button" revision="1" ` +
        `ov-color="#fff" ov-background-color="#000" ov-padding="4px" />`
    );
    const { regions } = expand(src, storeWithButton());
    expect([...regions[0]!.overridable.keys()].sort()).toEqual([
      "ov-background-color",
      "ov-color",
      "ov-padding",
    ]);
  });

  it("does not let one instance's override leak into another", () => {
    const src = template(
      `<mj-component component-id="shoe-brand/primary-button" revision="1" ov-background-color="#ff0000" />` +
        REF
    );
    const { mjml } = expand(src, storeWithButton());
    expect(mjml).toContain("#ff0000");
    expect(mjml).toContain("#1f6feb");
  });

  it("overrides a named text slot", () => {
    const s = new InMemoryComponentStore();
    s.publish(
      "brand/hero",
      `<mj-section><mj-column><mj-text data-slot="headline">Default</mj-text></mj-column></mj-section>`
    );
    const { mjml, regions } = expand(
      template(`<mj-component component-id="brand/hero" revision="1" ov-slot-headline="Custom" />`),
      s
    );
    expect(mjml).toContain("Custom");
    expect(mjml).not.toContain("Default");
    expect(regions[0]!.overridable.has("ov-slot-headline")).toBe(true);
  });

  it("throws when a slot override targets a slot that does not exist", () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/hero", `<mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section>`);
    expect(() =>
      expand(template(`<mj-component component-id="brand/hero" revision="1" ov-slot-nope="y" />`), s)
    ).toThrow(/no element with data-slot/);
  });

  it("keeps entity-encoded override values byte-stable across expansions", () => {
    // D-2 locks: all ov-* values must be entity-encoded. Verify the value is
    // not re-escaped or decoded on the way through.
    const src = template(
      `<mj-component component-id="shoe-brand/primary-button" revision="1" ov-href="https://x.test/?a=1&amp;b=2" />`
    );
    const store = storeWithButton();
    const first = expand(src, store).mjml;
    expect(first).toContain(`href="https://x.test/?a=1&amp;b=2"`);
    // The entity must not compound the way §0.2's bug did.
    expect(first).not.toContain("&amp;amp;");
  });
});

describe("expand — nesting and the depth cap", () => {
  it("expands a component that references another component", () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/button", `<mj-button href="#">Go</mj-button>`);
    s.publish(
      "brand/card",
      `<mj-section><mj-column><mj-component component-id="brand/button" revision="1" /></mj-column></mj-section>`
    );
    const { mjml, regions } = expand(
      template(`<mj-component component-id="brand/card" revision="1" />`),
      s
    );
    expect(mjml).toContain("Go");
    expect(mjml).not.toContain("mj-component");
    // Two regions: the card, and the button nested inside it.
    expect(regions).toHaveLength(2);
  });

  it("gives a nested region an instancePath CHAIN, outermost first", () => {
    const s = new InMemoryComponentStore();
    s.publish("brand/button", `<mj-button href="#">Go</mj-button>`);
    s.publish(
      "brand/card",
      `<mj-section><mj-column><mj-component component-id="brand/button" revision="1" /></mj-column></mj-section>`
    );
    const { regions } = expand(
      template(`<mj-component component-id="brand/card" revision="1" />`),
      s
    );
    const inner = regions.find((r) => r.componentId === "brand/button")!;
    // "Click inside a footer that contains a button: footer, or button?" — the
    // chain is what makes that answerable. Each element is
    // `id@revision#siblingIndex`.
    expect(inner.instancePath).toHaveLength(2);
    expect(inner.instancePath[0]).toMatch(/^brand\/card@1#/);
    expect(inner.instancePath[1]).toMatch(/^brand\/button@1#/);
  });

  it("throws past the depth cap instead of recursing forever", () => {
    const cyclic: ComponentStore = {
      get: (id) => ({
        componentId: id,
        revision: 1,
        body: `<mj-section><mj-component component-id="${id === "x" ? "y" : "x"}" revision="1" /></mj-section>`,
        publishedAt: new Date(),
      }),
      latest: () => undefined,
      list: () => [],
    };
    expect(() =>
      expand(template(`<mj-component component-id="x" revision="1" />`), cyclic)
    ).toThrow(new RegExp(`depth cap of ${MAX_EXPANSION_DEPTH}`));
  });
});

describe("expand — pins (the dry-run diff)", () => {
  it("pins override the revision written in the template", () => {
    const s = storeWithButton();
    s.publish("shoe-brand/primary-button", BUTTON_V2);
    const src = template(REF);
    expect(expand(src, s).mjml).toContain("#1f6feb");
    expect(
      expand(src, s, { pins: { "shoe-brand/primary-button": 2 } }).mjml
    ).toContain("#111111");
  });

  it("the diff is real before/after MJML, both pure functions of stored data", () => {
    const s = storeWithButton();
    s.publish("shoe-brand/primary-button", BUTTON_V2);
    const src = template(REF);
    const before = expand(src, s).mjml;
    const after = expand(src, s, { pins: { "shoe-brand/primary-button": 2 } }).mjml;
    expect(before).not.toBe(after);
    // And critically: the STORED template is untouched by either.
    expect(src).toContain(`revision="1"`);
  });
});

describe("locateInstances — detect-and-report is mandatory", () => {
  it("reports a plain instance as reachable", () => {
    const r = locateInstances(template(REF));
    expect(r.summary).toMatchObject({ total: 1, reachable: 1, unreachable: 0 });
  });

  it("reports an instance buried in mj-wrapper as OPAQUE, not missing", () => {
    const src = `<mjml><mj-body><mj-wrapper><mj-section><mj-column>${REF}</mj-column></mj-section></mj-wrapper></mj-body></mjml>`;
    const r = locateInstances(src);
    expect(r.summary.total).toBe(1);
    expect(r.summary.unreachable).toBe(1);
    expect(r.instances[0]!.status).toBe("opaque");
    expect(r.instances[0]!.opaqueReason).toContain("mj-wrapper");
  });

  it("reproduces the plan's measurement: 1 of 2 reachable", () => {
    const src =
      `<mjml><mj-body>` +
      `<mj-section><mj-column>${REF}</mj-column></mj-section>` +
      `<mj-wrapper><mj-section><mj-column>${REF}</mj-column></mj-section></mj-wrapper>` +
      `</mj-body></mjml>`;
    const r = locateInstances(src);
    expect(r.summary.total).toBe(2);
    expect(r.summary.reachable).toBe(1);
    expect(r.summary.unreachable).toBe(1);
  });

  it("never silently drops an unreachable instance from the total", () => {
    const src = `<mjml><mj-body><mj-wrapper>${REF}</mj-wrapper></mj-body></mjml>`;
    const r = locateInstances(src);
    expect(r.summary.total).toBe(r.summary.reachable + r.summary.unreachable);
  });

  it("attributes the cause so the report is actionable", () => {
    const src = `<mjml><mj-body><mj-wrapper><mj-section><mj-column>${REF}</mj-column></mj-section></mj-wrapper></mj-body></mjml>`;
    const r = locateInstances(src);
    expect(Object.keys(r.summary.unreachableBy)[0]).toContain("mj-wrapper");
  });

  it("still EXPANDS correctly even when the instance is unreachable", () => {
    // The asymmetry that decided D-2: reference substitutes a fixed-shape token
    // and runs straight through an opaque wrapper. Copy could not.
    const src = `<mjml><mj-body><mj-wrapper><mj-section><mj-column>${REF}</mj-column></mj-section></mj-wrapper></mj-body></mjml>`;
    expect(locateInstances(src).summary.unreachable).toBe(1);
    const { mjml } = expand(src, storeWithButton());
    expect(mjml).toContain("Shop now");
    const res = mjml2html(mjml, { validationLevel: "soft" }) as {
      html: string;
      errors?: unknown[];
    };
    expect(res.html).toContain("Shop now");
  });
});

describe("comment scanning agrees with htmlparser2 (mjml's parser)", () => {
  // Any disagreement is a leak in one direction or a false rejection in the
  // other, and both have happened here.
  const store = () => {
    const s = new InMemoryComponentStore();
    s.publish("shoe/footer", `<mj-text>FOOTERMARK</mj-text>`);
    return s;
  };
  const REFF = `<mj-component component-id="shoe/footer" revision="1" />`;

  it("treats <!--> as a COMPLETE comment, not one running to the next -->", () => {
    // htmlparser2 closes short comments immediately (Tokenizer.js: "Allow short
    // comments (eg. <!-->)"). Searching for `-->` from lt+4 misses that and runs
    // the comment on to any later `-->`, swallowing every reference between —
    // which surfaced as HTTP 200 with the content silently gone.
    const src = `<mjml><mj-body><mj-section><mj-column><!--><mj-text>Hello</mj-text>${REFF}</mj-column></mj-section><!-- footer --></mj-body></mjml>`;
    expect(expand(src, store()).mjml).toContain("FOOTERMARK");
  });

  it("treats <!---> as a COMPLETE comment", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><!---><mj-text>Hello</mj-text>${REFF}</mj-column></mj-section><!-- footer --></mj-body></mjml>`;
    expect(expand(src, store()).mjml).toContain("FOOTERMARK");
  });

  it("does not treat <!-- inside a raw-text element as a comment opener", () => {
    // Inside <script>/<style>/<title>/<textarea> the content is TEXT, so `<!--`
    // opens no comment. Reading it as one swallowed everything to the next -->.
    const src = `<mjml><mj-body><mj-section><mj-column><mj-raw><script><!--</script></mj-raw>${REFF}</mj-column></mj-section><!-- t --></mj-body></mjml>`;
    expect(expand(src, store()).mjml).toContain("FOOTERMARK");
  });

  it("still ignores a genuinely commented-out reference", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><!-- ${REFF} --><mj-text>vis</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const { mjml } = expand(src, store());
    expect(mjml).not.toContain("FOOTERMARK");
  });

  it("does NOT reject a stray <!-- in a template with no references", () => {
    // The mirror defect of the leak: throwing unconditionally rejected
    // templates mjml renders without complaint. The throw is only warranted
    // when an unterminated comment could HIDE a reference.
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text>Hello</mj-text></mj-column></mj-section></mj-body><!-- note</mjml>`;
    expect(() => expand(src, store())).not.toThrow();
  });

  it("DOES reject a stray <!-- when the template carries a reference", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text>H</mj-text><!-- note${REFF}</mj-column></mj-section></mj-body></mjml>`;
    expect(() => expand(src, store())).toThrow(UnterminatedCommentError);
  });

  it("expands a 200-reference document quickly enough for the render path", () => {
    // Regression: findTag was called without the precomputed comment ranges, so
    // every reference rescanned the whole document. That took ~8s here, inside
    // /api/render, which the preview pane hits on a 200ms keystroke debounce.
    const s = new InMemoryComponentStore();
    s.publish("b/btn", `<mj-button href="#">Go</mj-button>`);
    const pad = Array.from({ length: 300 }, (_, i) => `<mj-text>Filler ${i} with a realistic amount of body copy.</mj-text>`).join("");
    const refs = Array.from({ length: 200 }, () => `<mj-component component-id="b/btn" revision="1" />`).join("");
    const src = `<mjml><mj-body><mj-section><mj-column>${pad}${refs}</mj-column></mj-section></mj-body></mjml>`;
    const t0 = performance.now();
    expand(src, s);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("unterminated comments in component BODIES (the fourth silent-200 path)", () => {
  // This is the one content-loss path the compiler-authority check in render.ts
  // structurally CANNOT catch: the reference expands successfully, so mjml
  // reports nothing, while the body's stray `<!--` truncates every template
  // that references it. One bad publish silently poisons the whole corpus.

  it("publish() rejects an unterminated comment in a body", () => {
    const s = new InMemoryComponentStore();
    expect(() => s.publish("c/bad", `<mj-raw><!-- oops</mj-raw>`)).toThrow(
      UnterminatedCommentError
    );
  });

  it("expansion still catches a body from a store that did not validate", () => {
    // ComponentStore is an interface; a body can reach the expander from an
    // implementation that never called assertSingleRoot. Publish-time
    // validation alone is therefore not sufficient.
    const unvalidated: ComponentStore = {
      get: () => ({
        componentId: "c/bad",
        revision: 1,
        body: `<mj-raw><!-- oops</mj-raw>`,
        publishedAt: new Date(),
      }),
      latest: () => undefined,
      list: () => [],
    };
    const src = `<mjml><mj-body><mj-section><mj-column><mj-component component-id="c/bad" revision="1" /><mj-text>SIBLING</mj-text></mj-column></mj-section></mj-body></mjml>`;
    expect(() => expand(src, unvalidated)).toThrow(UnterminatedCommentError);
  });
});

describe("CDATA is not markup", () => {
  it("a CDATA section containing > and <!-- does not create a phantom comment", () => {
    // mjml enables recognizeCDATA. Without handling it, the generic tag-skip
    // stopped at the `>` INSIDE the CDATA and read the following `<!--` as a
    // comment opener — which both hid a reference AND falsely rejected a
    // template mjml compiles.
    const s = new InMemoryComponentStore();
    s.publish("c/x", `<mj-text>CMARK</mj-text>`);
    const src = `<mjml><mj-body><mj-section><mj-column><mj-raw><![CDATA[a>b<!--]]></mj-raw><mj-component component-id="c/x" revision="1" /><!-- t --></mj-column></mj-section></mj-body></mjml>`;
    expect(expand(src, s).mjml).toContain("CMARK");
  });
});

describe("the unterminated-comment rejection is scoped to references it could hide", () => {
  const store = () => {
    const s = new InMemoryComponentStore();
    s.publish("c/x", `<mj-text>CMARK</mj-text>`);
    return s;
  };

  it("does NOT reject when every reference precedes the stray <!--", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-component component-id="c/x" revision="1" /></mj-column></mj-section></mj-body><!-- trailing</mjml>`;
    expect(() => expand(src, store())).not.toThrow();
  });

  it("DOES reject when a reference sits after the stray <!--", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><!-- note<mj-component component-id="c/x" revision="1" /></mj-column></mj-section></mj-body></mjml>`;
    expect(() => expand(src, store())).toThrow(UnterminatedCommentError);
  });
});
