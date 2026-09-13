/**
 * blocks.roundTrip.property — the fidelity gate (plan §0.3).
 *
 * WHY THIS EXISTS, AND WHY IT IS N-GENERATION
 * -------------------------------------------
 * `blocks.passthrough.test.ts` is a *classification* smoke test: 6 hand-picked
 * literals, every assertion `normalizeWhitespace(out) === normalizeWhitespace(src)`,
 * and — decisively — **one generation only**. It never does
 * parse->serialize->parse->serialize.
 *
 * That is precisely why the entity double-escape bug (§0.2) survived: a single
 * round-trip normalizes `&amp;` -> `&amp;amp;` and *looks* fine under whitespace
 * normalization, because both sides are compared once. The corruption is only
 * visible when you iterate — it grows +4 characters per generation, forever,
 * once per save.
 *
 * So the invariant this file asserts is **idempotency**, not round-trip:
 *
 *     gen1 = serialize(parse(src))
 *     gen1 === gen2 === ... === genN                (N >= 4)
 *
 * The serializer is allowed to re-indent and re-format on the FIRST pass —
 * that is its job. What it may never do is keep changing the document on
 * subsequent passes. A serializer that reaches a fixpoint at gen1 is lossless
 * in the only sense that matters for a system that rewrites N templates
 * unattended.
 *
 * `assertRoundTrip` in roundTrip.ts had ZERO call sites before this file, and
 * `fast-check` was wired only to headEdit/attrsHelpers, never to the parser.
 *
 * SOURCE-REALISTIC VALUES
 * -----------------------
 * The parser runs fast-xml-parser with `processEntities: false`, so attribute
 * values and text arrive as the *literal source characters* — `&amp;` is five
 * characters, not `&`. Generators here therefore emit values as they would
 * legitimately appear in MJML source: entities stay encoded, and a raw `<` or a
 * raw `"` inside an attribute value is never generated because it cannot occur
 * in well-formed source.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseMjml, serializeMjml } from "../../src/shared/blocks/index.js";
import {
  assertRoundTrip,
  normalizeWhitespace,
} from "../../src/shared/blocks/roundTrip.js";

const GENERATIONS = 5;

/**
 * Run parse->serialize N times and return every generation. Index 0 is the
 * input; index 1 is the first serialized form; the fixpoint claim is about
 * indices 1..N.
 */
function generations(src: string, n = GENERATIONS): string[] {
  const out: string[] = [src];
  let cur = src;
  for (let i = 0; i < n; i++) {
    cur = serializeMjml(parseMjml(cur));
    out.push(cur);
  }
  return out;
}

/**
 * The gate. Asserts the serializer reaches a fixpoint at gen1 and stays there
 * for N generations, reporting the first divergent generation with a diff that
 * points at the actual drift rather than dumping two whole documents.
 */
function assertIdempotent(src: string, n = GENERATIONS): void {
  const gens = generations(src, n);
  const fixpoint = gens[1]!;
  for (let i = 2; i < gens.length; i++) {
    if (gens[i] !== fixpoint) {
      // Locate the first differing offset so the failure names the drift.
      let at = 0;
      while (at < fixpoint.length && fixpoint[at] === gens[i]![at]) at++;
      throw new Error(
        `Serializer is not idempotent: generation ${i} differs from generation 1.\n` +
          `  source:  ${src.slice(0, 160)}\n` +
          `  gen1 @${at}: ...${fixpoint.slice(Math.max(0, at - 40), at + 40)}...\n` +
          `  gen${i} @${at}: ...${gens[i]!.slice(Math.max(0, at - 40), at + 40)}...\n` +
          `  gen1 length ${fixpoint.length}, gen${i} length ${gens[i]!.length}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Adversarial corpus — values that actually occur in production email and that
// the previous single-generation test never exercised.
// ---------------------------------------------------------------------------

const ADVERSARIAL_ATTR_VALUES: Array<[string, string]> = [
  ["ampersand entity", "a&amp;b"],
  ["utm tracking url", "https://x.test/c?utm_source=n&amp;utm_medium=email&amp;utm_campaign=q4"],
  ["quote entity", "say &quot;hi&quot;"],
  ["lt entity", "3 &lt; 5"],
  ["gt entity", "5 &gt; 3"],
  ["double-encoded on purpose", "a&amp;amp;b"],
  ["json in attribute", "{&quot;k&quot;:[1,2],&quot;v&quot;:&quot;x&amp;y&quot;}"],
  ["unicode", "café — naïve ✨ 日本語"],
  ["emoji", "Buy now 🎉🛒"],
  ["numeric-looking", "0.50"],
  ["leading zeroes", "007"],
  ["empty", ""],
  ["whitespace only", "   "],
  ["css with quotes", "url(&quot;https://x.test/i.png&quot;)"],
  ["semicolons", "font-family: Helvetica, Arial, sans-serif;"],
  ["percent", "100%"],
  ["hash color", "#ff0000"],
  ["newline inside value", "line1\nline2"],
];

const ADVERSARIAL_TEXT: Array<[string, string]> = [
  ["ampersand entity", "Tom &amp; Jerry"],
  ["multiple entities", "&lt;b&gt;bold&lt;/b&gt; &amp; more"],
  ["double-encoded", "a &amp;amp; b"],
  ["unicode", "café — naïve ✨"],
  ["emoji", "Ship it 🚀"],
  ["quote entity", "she said &quot;yes&quot;"],
  ["empty", ""],
  ["long prose", "The quick brown fox jumps over the lazy dog. ".repeat(6)],
];

function buttonWith(attr: string, value: string): string {
  return (
    `<mjml><mj-body><mj-section><mj-column>` +
    `<mj-button ${attr}="${value}" background-color="#1f6feb">Go</mj-button>` +
    `</mj-column></mj-section></mj-body></mjml>`
  );
}

function textWith(content: string): string {
  return (
    `<mjml><mj-body><mj-section><mj-column>` +
    `<mj-text color="#333333">${content}</mj-text>` +
    `</mj-column></mj-section></mj-body></mjml>`
  );
}

describe("§0.3 fidelity gate — N-generation idempotency", () => {
  describe("adversarial attribute values", () => {
    for (const [label, value] of ADVERSARIAL_ATTR_VALUES) {
      it(`href=${label} is stable across ${GENERATIONS} generations`, () => {
        assertIdempotent(buttonWith("href", value));
      });

      it(`data-* ${label} is stable across ${GENERATIONS} generations`, () => {
        assertIdempotent(buttonWith("data-cmp-args", value));
      });
    }
  });

  describe("adversarial text content", () => {
    for (const [label, content] of ADVERSARIAL_TEXT) {
      it(`mj-text ${label} is stable across ${GENERATIONS} generations`, () => {
        assertIdempotent(textWith(content));
      });
    }
  });

  describe("attribute VALUES survive unchanged, not just the document shape", () => {
    // Document-level idempotency can in principle be reached while a value is
    // still being mangled once. Assert the parsed value itself is stable.
    for (const [label, value] of ADVERSARIAL_ATTR_VALUES) {
      it(`href=${label} parses back to the same value every generation`, () => {
        const read = (s: string): string | undefined => {
          const doc = parseMjml(s);
          const section = doc.body[0] as { children?: unknown[] };
          const column = section.children?.[0] as { children?: unknown[] };
          const button = column.children?.[0] as {
            attrs?: Map<string, string>;
          };
          return button.attrs?.get("href");
        };
        const gens = generations(buttonWith("href", value));
        // Compare gen1 against the INPUT, not against itself. Comparing later
        // generations to gen1 only re-establishes what assertIdempotent already
        // proves — it cannot see a value mangled exactly once and then stable,
        // which is the precise shape of the bug this block exists to catch.
        expect(read(gens[1]!), "generation 1 vs input").toBe(value);
        for (let i = 2; i < gens.length; i++) {
          expect(read(gens[i]!), `generation ${i}`).toBe(value);
        }
      });
    }
  });

  describe("structural corpus", () => {
    const STRUCTURES: Array<[string, string]> = [
      [
        "full document with head",
        `<mjml><mj-head><mj-title>T &amp; T</mj-title><mj-style>.x{color:red}</mj-style></mj-head><mj-body width="600px"><mj-section background-color="#fff"><mj-column width="50%"><mj-image src="https://x.test/i.png?a=1&amp;b=2" alt="a &amp; b" /><mj-text>Hi &amp; bye</mj-text></mj-column></mj-section></mj-body></mjml>`,
      ],
      [
        "mj-wrapper passthrough",
        `<mjml><mj-body><mj-wrapper padding="0"><mj-section><mj-column><mj-button href="/x?a=1&amp;b=2">c</mj-button></mj-column></mj-section></mj-wrapper></mj-body></mjml>`,
      ],
      [
        "comment in body",
        `<mjml><mj-body><!-- a &amp; b --><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>`,
      ],
      [
        "rich mj-text demotes to passthrough",
        `<mjml><mj-body><mj-section><mj-column><mj-text>Buy <b>now</b> &amp; save</mj-text></mj-column></mj-section></mj-body></mjml>`,
      ],
      [
        "social elements",
        `<mjml><mj-body><mj-section><mj-column><mj-social mode="horizontal"><mj-social-element name="facebook" href="https://x.test/?a=1&amp;b=2" /></mj-social></mj-column></mj-section></mj-body></mjml>`,
      ],
      [
        "empty body",
        `<mjml><mj-body></mj-body></mjml>`,
      ],
      [
        "self-closing section",
        `<mjml><mj-body><mj-section /></mj-body></mjml>`,
      ],
      [
        "duplicate attribute names",
        `<mjml><mj-body><mj-section padding="1px" padding="2px"><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>`,
      ],
      [
        "CDATA inside mj-style",
        `<mjml><mj-head><mj-style><![CDATA[ .a > .b { content: "&"; } ]]></mj-style></mj-head><mj-body><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>`,
      ],
    ];

    for (const [label, src] of STRUCTURES) {
      it(`${label} is stable across ${GENERATIONS} generations`, () => {
        assertIdempotent(src);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Generated property tests.
// ---------------------------------------------------------------------------

/** Attribute values as they legitimately appear in MJML source. */
const attrValueArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...ADVERSARIAL_ATTR_VALUES.map(([, v]) => v)),
  // Safe printable characters only: no raw `"` or `<`, which cannot appear
  // unescaped in a well-formed attribute value.
  fc.stringOf(
    fc.constantFrom(
      ..."abcXYZ019 -_.:/#%?=+,()[]{}!@$*^~|".split(""),
      "é",
      "—",
      "🎉"
    ),
    { maxLength: 24 }
  ),
  fc.constant("a&amp;b"),
  fc.constant("&quot;q&quot;")
);

/** Text content as it legitimately appears in MJML source. */
const textArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...ADVERSARIAL_TEXT.map(([, v]) => v)),
  fc.stringOf(
    fc.constantFrom(..."abc XYZ 019.,!?-".split(""), "é", "🚀"),
    { maxLength: 40 }
  )
);

const attrNameArb: fc.Arbitrary<string> = fc.constantFrom(
  "href",
  "background-color",
  "color",
  "padding",
  "width",
  "align",
  "font-size",
  "border-radius",
  "data-cmp",
  "data-cmp-v",
  "data-cmp-args",
  "css-class",
  "mj-class"
);

const attrsArb: fc.Arbitrary<string> = fc
  .array(fc.tuple(attrNameArb, attrValueArb), { maxLength: 5 })
  .map((pairs) => {
    // De-duplicate names so generated source stays well-formed; duplicate-attr
    // handling is covered by an explicit literal in the structural corpus.
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const [k, v] of pairs) {
      if (seen.has(k)) continue;
      seen.add(k);
      parts.push(`${k}="${v}"`);
    }
    return parts.length ? " " + parts.join(" ") : "";
  });

const leafArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(attrsArb, textArb)
    .map(([a, t]) => `<mj-text${a}>${t}</mj-text>`),
  fc
    .tuple(attrsArb, textArb)
    .map(([a, t]) => `<mj-button${a}>${t}</mj-button>`),
  attrsArb.map((a) => `<mj-image${a} />`),
  attrsArb.map((a) => `<mj-divider${a} />`),
  attrsArb.map((a) => `<mj-spacer${a} />`)
);

const columnArb: fc.Arbitrary<string> = fc
  .tuple(attrsArb, fc.array(leafArb, { minLength: 0, maxLength: 3 }))
  .map(([a, kids]) => `<mj-column${a}>${kids.join("")}</mj-column>`);

const sectionArb: fc.Arbitrary<string> = fc
  .tuple(attrsArb, fc.array(columnArb, { minLength: 0, maxLength: 2 }))
  .map(([a, kids]) => `<mj-section${a}>${kids.join("")}</mj-section>`);

const documentArb: fc.Arbitrary<string> = fc
  .array(sectionArb, { minLength: 0, maxLength: 3 })
  .map((secs) => `<mjml><mj-body>${secs.join("")}</mj-body></mjml>`);

/**
 * Put a generated source into the serializer's own normal form for EMPTY
 * elements, so a single-round-trip comparison is testing fidelity rather than
 * formatting.
 *
 * The normal form is not uniform, and the distinction is load-bearing:
 *   - a container with no children     -> `<mj-section />`     (self-closing)
 *   - a text leaf with `text != null`  -> `<mj-text></mj-text>` (stays PAIRED,
 *     even when the text is empty, because `serializeBlock` takes the
 *     contentField branch whenever `text` is non-null)
 *   - a leaf with no text              -> `<mj-image />`        (self-closing)
 *
 * So `mj-text` / `mj-button` are excluded here: an empty one is ALREADY in
 * normal form, and collapsing it would introduce the very mismatch this helper
 * exists to remove.
 */
const PAIRED_WHEN_EMPTY = new Set(["mj-text", "mj-button"]);

function canonicalizeEmptyElements(src: string): string {
  let prev: string;
  let out = src;
  do {
    prev = out;
    out = out.replace(
      /<([\w-]+)((?:\s+[\w-]+="[^"]*")*)\s*><\/\1\s*>/g,
      (whole, tag: string, attrs: string) =>
        PAIRED_WHEN_EMPTY.has(tag) ? whole : `<${tag}${attrs} />`
    );
  } while (out !== prev);
  return out;
}

/**
 * Documents whose text leaves are never empty.
 *
 * Needed for the indentation property below: that test simulates re-indenting a
 * document by expanding every `><` into `>\n  <`, which is only a *whitespace*
 * change when the gap really is between two tags. For an empty `<mj-text></mj-text>`
 * the same expansion injects whitespace INSIDE preserved text content, which
 * `normalizeWhitespace` is contractually required to keep — so the inputs stop
 * being equivalent and the test would be asserting the wrong thing.
 */
const nonEmptyTextArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    ...ADVERSARIAL_TEXT.filter(([, v]) => v.trim().length > 0).map(([, v]) => v)
  ),
  fc.stringOf(fc.constantFrom(..."abcXYZ019".split(""), "é"), {
    minLength: 1,
    maxLength: 20,
  })
);

const nonEmptyLeafArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(attrsArb, nonEmptyTextArb)
    .map(([a, t]) => `<mj-text${a}>${t}</mj-text>`),
  fc
    .tuple(attrsArb, nonEmptyTextArb)
    .map(([a, t]) => `<mj-button${a}>${t}</mj-button>`),
  attrsArb.map((a) => `<mj-image${a} />`),
  attrsArb.map((a) => `<mj-divider${a} />`)
);

const nonEmptyDocumentArb: fc.Arbitrary<string> = fc
  .array(
    fc
      .tuple(attrsArb, fc.array(nonEmptyLeafArb, { minLength: 1, maxLength: 3 }))
      .map(([a, kids]) => `<mj-section><mj-column${a}>${kids.join("")}</mj-column></mj-section>`),
    { minLength: 1, maxLength: 3 }
  )
  .map((secs) => `<mjml><mj-body>${secs.join("")}</mj-body></mjml>`);

// ---------------------------------------------------------------------------
// THE WRITE PATH.
//
// Everything above generates SOURCE-realistic values, on the stated reasoning
// that a raw `<` or `"` "cannot occur in well-formed source". That is true, and
// it is exactly why the first attempt at the §0.2 fix shipped a worse bug than
// the one it fixed: `node.text` and `attrs` are also written PROGRAMMATICALLY,
// and those writers hold raw characters.
//
//   - the inline canvas editor assigns `target.textContent` verbatim
//   - the properties form assigns raw input values
//   - the component expander assigns `ov-*` values
//
// With text escaping removed, typing `a < b` serialized to `<mj-text>a < b</mj-text>`,
// which re-parsed to `"a "` — silently truncated, then persisted. The gate could
// not see it because its corpus was scoped around the hole.
//
// So these cases enter through assignment, not through parsing. A fix that only
// satisfies the source corpus does not satisfy this one.
// ---------------------------------------------------------------------------

const SEED = `<mjml><mj-body><mj-section><mj-column><mj-text>seed</mj-text><mj-button href="#">seed</mj-button></mj-column></mj-section></mj-body></mjml>`;

function leafOf(doc: ReturnType<typeof parseMjml>, index: 0 | 1) {
  const section = doc.body[0] as { children?: unknown[] };
  const column = section.children?.[0] as { children?: unknown[] };
  return column.children?.[index] as {
    text?: string;
    attrs: Map<string, string>;
  };
}

/** Decode the entities a browser would, to check what the user actually sees. */
function asDisplayed(v: string): string {
  return v
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

describe("§0.3 fidelity gate — the programmatic WRITE path", () => {
  const RAW_INPUTS: Array<[string, string]> = [
    ["bare less-than", "a < b"],
    ["bare ampersand", "AT&T"],
    ["quote", 'say "hi"'],
    ["greater-than", "Tom & Jerry > all"],
    ["tag-shaped injection", "</mj-text><script>alert(1)</script>"],
    ["mixed", "5 > 3 & 2 < 4"],
    ["ampersand then letters", "R&D team"],
    ["trailing ampersand", "Q&A &"],
  ];

  for (const [label, raw] of RAW_INPUTS) {
    it(`text assigned raw (${label}) survives a round-trip intact`, () => {
      const doc = parseMjml(SEED);
      leafOf(doc, 0).text = raw;
      const emitted = serializeMjml(doc);
      const readBack = leafOf(parseMjml(emitted), 0).text ?? "";
      // The user must see back exactly what they typed.
      expect(asDisplayed(readBack)).toBe(raw);
    });

    it(`text assigned raw (${label}) is then idempotent`, () => {
      const doc = parseMjml(SEED);
      leafOf(doc, 0).text = raw;
      // Once written, the document must be a fixpoint like any other.
      assertIdempotent(serializeMjml(doc));
    });

    it(`attribute assigned raw (${label}) survives a round-trip intact`, () => {
      const doc = parseMjml(SEED);
      leafOf(doc, 1).attrs.set("href", raw);
      const emitted = serializeMjml(doc);
      const readBack = leafOf(parseMjml(emitted), 1).attrs.get("href") ?? "";
      expect(asDisplayed(readBack)).toBe(raw);
    });

    it(`attribute assigned raw (${label}) is then idempotent`, () => {
      const doc = parseMjml(SEED);
      leafOf(doc, 1).attrs.set("href", raw);
      assertIdempotent(serializeMjml(doc));
    });
  }

  it("a raw < in text cannot truncate the document", () => {
    // The specific regression: everything after `<` was destroyed.
    const doc = parseMjml(SEED);
    leafOf(doc, 0).text = "a < b";
    const out = serializeMjml(doc);
    expect(leafOf(parseMjml(out), 0).text).toBe("a &lt; b");
    // And the sibling button must still be there — truncation ate it before.
    expect(leafOf(parseMjml(out), 1)).toBeDefined();
  });

  it("a tag-shaped input cannot break out of its element", () => {
    const doc = parseMjml(SEED);
    leafOf(doc, 0).text = "</mj-text><mj-text>injected</mj-text>";
    const reparsed = parseMjml(serializeMjml(doc));
    const section = reparsed.body[0] as { children?: unknown[] };
    const column = section.children?.[0] as { children?: unknown[] };
    // Still exactly the two leaves we started with — nothing was injected.
    expect(column.children).toHaveLength(2);
  });

  it("KNOWN LIMIT: a typed literal entity is read back as that entity", () => {
    // Idempotent escaping cannot distinguish "the user typed &amp;" from "this
    // value came from source and already holds an entity". We resolve the
    // ambiguity in favour of source, because source documents containing
    // entities are universal and typing a literal entity into a WYSIWYG field
    // is vanishingly rare — and the alternative (escaping every `&`) is exactly
    // the compounding §0.2 corruption.
    const doc = parseMjml(SEED);
    leafOf(doc, 0).text = "a &amp; b";
    const readBack = leafOf(parseMjml(serializeMjml(doc)), 0).text;
    expect(readBack).toBe("a &amp; b");
    expect(asDisplayed(readBack!)).toBe("a & b"); // displays as `&`, not `&amp;`
  });
});

describe("§0.3 fidelity gate — generated documents", () => {
  it("serialize(parse(x)) reaches a fixpoint at generation 1 and holds", () => {
    fc.assert(
      fc.property(documentArb, (src) => {
        assertIdempotent(src);
      }),
      { numRuns: 400 }
    );
  });

  it("a single round-trip preserves the document modulo whitespace", () => {
    fc.assert(
      fc.property(documentArb, (src) => {
        // This is the weaker, pre-existing invariant. Kept because it catches
        // structural loss that idempotency alone would not (a serializer that
        // drops everything is trivially idempotent).
        //
        // Empty elements are canonicalized first: the serializer deliberately
        // emits `<mj-body />` for a source `<mj-body></mj-body>`, and likewise
        // for any childless container or text-less leaf. That is a normal form,
        // not a loss — it reaches a fixpoint at generation 1 and the idempotency
        // gate above covers it — but it means raw `assertRoundTrip` does NOT
        // hold for empty elements. Asserting it unmodified here would be
        // asserting something untrue about the code.
        assertRoundTrip(canonicalizeEmptyElements(src));
      }),
      { numRuns: 400 }
    );
  });

  it("does not silently empty the document", () => {
    fc.assert(
      fc.property(documentArb, (src) => {
        const out = serializeMjml(parseMjml(src));
        // Guard against the degenerate serializer that satisfies idempotency
        // by emitting nothing.
        const countTags = (s: string): number =>
          (s.match(/<mj-(section|column|text|button|image|divider|spacer)\b/g) ?? [])
            .length;
        expect(countTags(out)).toBe(countTags(src));
      }),
      { numRuns: 400 }
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeWhitespace — every fidelity assertion in the suite routes through
// this function, and before this block it had no test of its own. Its own
// comments document two off-by-one bugs already fixed in it.
// ---------------------------------------------------------------------------

describe("§0.3 — normalizeWhitespace has its own tests", () => {
  it("strips whitespace strictly between tags", () => {
    expect(normalizeWhitespace("<a>\n  <b>")).toBe("<a><b>");
    expect(normalizeWhitespace("<a><b>")).toBe("<a><b>");
  });

  it("flush and indented inputs normalize identically", () => {
    const flush = `<mjml><mj-body><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const indented = `<mjml>\n  <mj-body>\n    <mj-section>\n      <mj-column>\n        <mj-text>hi</mj-text>\n      </mj-column>\n    </mj-section>\n  </mj-body>\n</mjml>\n`;
    expect(normalizeWhitespace(indented)).toBe(normalizeWhitespace(flush));
  });

  it("preserves whitespace INSIDE mj-text content", () => {
    const a = normalizeWhitespace(`<mj-text>a  b</mj-text>`);
    const b = normalizeWhitespace(`<mj-text>a b</mj-text>`);
    expect(a).not.toBe(b);
  });

  it("preserves whitespace INSIDE mj-button content", () => {
    const a = normalizeWhitespace(`<mj-button>a  b</mj-button>`);
    const b = normalizeWhitespace(`<mj-button>a b</mj-button>`);
    expect(a).not.toBe(b);
  });

  it("handles a close tag immediately followed by a sibling close tag", () => {
    // The documented boundary bug: `lastIndexOf("<", ...)` could match the
    // SIBLING's `<` instead of the in-match close tag, over-extending the
    // protected range.
    //
    // The obvious fixture — `<mj-column><mj-text>hi</mj-text></mj-column>` —
    // does NOT discriminate: the over-wide range swallows `</mj-text>` verbatim,
    // and since that span holds no collapsible whitespace the output is
    // byte-identical under both the buggy and fixed versions. A regression test
    // that passes against the bug it is named for is worse than none, so the
    // fixture below puts collapsible whitespace where the erroneous extension
    // would reach.
    const src = `<mj-column><mj-text>hi</mj-text></mj-column>\n  <mj-column>\n    <mj-text>  a  b  </mj-text>\n  </mj-column>`;
    const out = normalizeWhitespace(src);
    // Inner text whitespace preserved in BOTH protected ranges...
    expect(out).toContain(">  a  b  <");
    expect(out).toContain(">hi<");
    // ...and the inter-tag whitespace between the two columns is gone.
    expect(out).toContain("</mj-column><mj-column>");
  });

  it("handles two adjacent protected ranges", () => {
    const src = `<mj-text>a</mj-text><mj-button>b</mj-button>`;
    expect(normalizeWhitespace(src)).toBe(src);
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(documentArb, (src) => {
        const once = normalizeWhitespace(src);
        expect(normalizeWhitespace(once)).toBe(once);
      }),
      { numRuns: 200 }
    );
  });

  it("is insensitive to inter-tag indentation on generated documents", () => {
    fc.assert(
      fc.property(nonEmptyDocumentArb, (src) => {
        const indented = src.replace(/></g, ">\n  <");
        expect(normalizeWhitespace(indented)).toBe(normalizeWhitespace(src));
      }),
      { numRuns: 200 }
    );
  });
});
