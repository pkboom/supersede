import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseMjml, serializeMjml } from "../../src/shared/blocks/index.js";
import {
  assertRoundTrip,
  normalizeWhitespace,
} from "../../src/shared/blocks/roundTrip.js";

const GENERATIONS = 5;

function generations(src: string, n = GENERATIONS): string[] {
  const out: string[] = [src];
  let cur = src;
  for (let i = 0; i < n; i++) {
    cur = serializeMjml(parseMjml(cur));
    out.push(cur);
  }
  return out;
}

function assertIdempotent(src: string, n = GENERATIONS): void {
  const gens = generations(src, n);
  const fixpoint = gens[1]!;
  for (let i = 2; i < gens.length; i++) {
    if (gens[i] !== fixpoint) {
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

const attrValueArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...ADVERSARIAL_ATTR_VALUES.map(([, v]) => v)),
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

const SEED = `<mjml><mj-body><mj-section><mj-column><mj-text>seed</mj-text><mj-button href="#">seed</mj-button></mj-column></mj-section></mj-body></mjml>`;

function leafOf(doc: ReturnType<typeof parseMjml>, index: 0 | 1) {
  const section = doc.body[0] as { children?: unknown[] };
  const column = section.children?.[0] as { children?: unknown[] };
  return column.children?.[index] as {
    text?: string;
    attrs: Map<string, string>;
  };
}

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
      expect(asDisplayed(readBack)).toBe(raw);
    });

    it(`text assigned raw (${label}) is then idempotent`, () => {
      const doc = parseMjml(SEED);
      leafOf(doc, 0).text = raw;
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
    const doc = parseMjml(SEED);
    leafOf(doc, 0).text = "a < b";
    const out = serializeMjml(doc);
    expect(leafOf(parseMjml(out), 0).text).toBe("a &lt; b");
    expect(leafOf(parseMjml(out), 1)).toBeDefined();
  });

  it("a tag-shaped input cannot break out of its element", () => {
    const doc = parseMjml(SEED);
    leafOf(doc, 0).text = "</mj-text><mj-text>injected</mj-text>";
    const reparsed = parseMjml(serializeMjml(doc));
    const section = reparsed.body[0] as { children?: unknown[] };
    const column = section.children?.[0] as { children?: unknown[] };
    expect(column.children).toHaveLength(2);
  });

  it("KNOWN LIMIT: a typed literal entity is read back as that entity", () => {
    const doc = parseMjml(SEED);
    leafOf(doc, 0).text = "a &amp; b";
    const readBack = leafOf(parseMjml(serializeMjml(doc)), 0).text;
    expect(readBack).toBe("a &amp; b");
    expect(asDisplayed(readBack!)).toBe("a & b");
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
        assertRoundTrip(canonicalizeEmptyElements(src));
      }),
      { numRuns: 400 }
    );
  });

  it("does not silently empty the document", () => {
    fc.assert(
      fc.property(documentArb, (src) => {
        const out = serializeMjml(parseMjml(src));
        const countTags = (s: string): number =>
          (s.match(/<mj-(section|column|text|button|image|divider|spacer)\b/g) ?? [])
            .length;
        expect(countTags(out)).toBe(countTags(src));
      }),
      { numRuns: 400 }
    );
  });
});

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
    const src = `<mj-column><mj-text>hi</mj-text></mj-column>\n  <mj-column>\n    <mj-text>  a  b  </mj-text>\n  </mj-column>`;
    const out = normalizeWhitespace(src);
    expect(out).toContain(">  a  b  <");
    expect(out).toContain(">hi<");
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
