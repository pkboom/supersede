/**
 * SCRATCH — empirical verification of the A-prime passthrough claim in
 * src/shared/blocks/types.ts, for the component-propagation design.
 * NOT part of the real suite. Delete or promote deliberately.
 */
import { describe, it, expect } from "vitest";
import { parseMjml, serializeMjml } from "../../src/shared/blocks/index.js";
import { normalizeWhitespace } from "../../src/shared/blocks/roundTrip.js";
import type { BlockNode, TreeNode } from "../../src/shared/blocks/index.js";
// @ts-expect-error no types for mjml
import mjml2html from "mjml";

function walk(nodes: TreeNode[], fn: (n: TreeNode) => void): void {
  for (const n of nodes) {
    fn(n);
    if (n.type !== "__unknown__" && n.type !== "mj-custom-passthrough" && n.children) {
      walk(n.children, fn);
    }
  }
}
function find(nodes: TreeNode[], type: string): BlockNode | undefined {
  let hit: BlockNode | undefined;
  walk(nodes, (n) => {
    if (!hit && n.type === type) hit = n as BlockNode;
  });
  return hit;
}

const STAMPED = `<mjml>
  <mj-body>
    <mj-section data-cmp="shoe-brand/hero" data-cmp-v="3" background-color="#fff">
      <mj-column data-cmp-slot="body">
        <mj-button data-cmp="shoe-brand/primary-button" data-cmp-v="7" href="https://x.test" background-color="#1f6feb" color="#ffffff" border-radius="4px">Shop now</mj-button>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

describe("PROOF 1 — unknown data-* attrs survive parse", () => {
  it("lands every data-* attr in the attrs Map on mj-button", () => {
    const doc = parseMjml(STAMPED);
    const btn = find(doc.body, "mj-button")!;
    expect(btn).toBeDefined();
    expect(btn.attrs.get("data-cmp")).toBe("shoe-brand/primary-button");
    expect(btn.attrs.get("data-cmp-v")).toBe("7");
    expect(btn.text).toBe("Shop now");
    console.log("BUTTON attrs order:", [...btn.attrs.entries()]);
  });

  it("lands data-* on mj-section and mj-column", () => {
    const doc = parseMjml(STAMPED);
    const sec = find(doc.body, "mj-section")!;
    const col = find(doc.body, "mj-column")!;
    expect(sec.attrs.get("data-cmp")).toBe("shoe-brand/hero");
    expect(sec.attrs.get("data-cmp-v")).toBe("3");
    expect(col.attrs.get("data-cmp-slot")).toBe("body");
    console.log("SECTION attrs order:", [...sec.attrs.entries()]);
  });
});

describe("PROOF 2 — serialize re-emits them", () => {
  it("round-trips normalized-equal", () => {
    const out = serializeMjml(parseMjml(STAMPED));
    console.log("--- SERIALIZED ---\n" + out + "--- END ---");
    expect(normalizeWhitespace(out)).toBe(normalizeWhitespace(STAMPED));
  });

  it("is BYTE-equal to the source when the source is already canonical", () => {
    const canonical = serializeMjml(parseMjml(STAMPED));
    const again = serializeMjml(parseMjml(canonical));
    expect(again).toBe(canonical); // strict byte equality, idempotence
  });

  it("attr insertion order is preserved exactly (data-* first stays first)", () => {
    const out = serializeMjml(parseMjml(STAMPED));
    expect(out).toContain(
      '<mj-button data-cmp="shoe-brand/primary-button" data-cmp-v="7" href="https://x.test" background-color="#1f6feb" color="#ffffff" border-radius="4px">'
    );
  });

  it("10 successive parse/serialize cycles do not drift", () => {
    let s = serializeMjml(parseMjml(STAMPED));
    const first = s;
    for (let i = 0; i < 10; i++) s = serializeMjml(parseMjml(s));
    expect(s).toBe(first);
  });
});

describe("PROOF 3 — adversarial attr values", () => {
  const nasty = `<mjml><mj-body><mj-section><mj-column><mj-text data-cmp="b/t" data-cmp-lock='{"attrs":["color","font-size"]}' data-cmp-hash="a&amp;b&lt;c">hi &amp; bye</mj-text></mj-column></mj-section></mj-body></mjml>`;
  it("preserves JSON-in-attr and entities", () => {
    const doc = parseMjml(nasty);
    const t = find(doc.body, "mj-text")!;
    console.log("NASTY attrs:", [...t.attrs.entries()], "text:", JSON.stringify(t.text));
    const out = serializeMjml(doc);
    console.log("NASTY out:", out);
    const doc2 = parseMjml(out);
    const t2 = find(doc2.body, "mj-text")!;
    expect([...t2.attrs.entries()]).toEqual([...t.attrs.entries()]);
    expect(t2.text).toBe(t.text);
  });
});

describe("PROOF 4 — unmodeled tags carry stamps verbatim", () => {
  const src = `<mjml><mj-body><mj-wrapper data-cmp="brand/wrapper" data-cmp-v="2"><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-wrapper></mj-body></mjml>`;
  it("passthrough rawXml contains the stamp byte-for-byte", () => {
    const doc = parseMjml(src);
    const pt = doc.body.find((n) => n.type === "mj-custom-passthrough") as any;
    expect(pt).toBeDefined();
    expect(pt.rawXml).toContain('data-cmp="brand/wrapper"');
    console.log("PASSTHROUGH rawXml:", pt.rawXml.slice(0, 120));
    const out = serializeMjml(doc);
    expect(out).toContain('data-cmp="brand/wrapper"');
  });
});

describe("PROOF 5 — does the real MJML compiler tolerate the stamps?", () => {
  it("mjml2html renders stamped MJML without errors", () => {
    const res = mjml2html(STAMPED, { validationLevel: "soft" }) as {
      html: string;
      errors?: unknown[];
    };
    console.log("MJML errors:", JSON.stringify(res.errors));
    console.log("data-cmp reaches HTML?", res.html.includes("data-cmp"));
    expect(typeof res.html).toBe("string");
    expect(res.html.length).toBeGreaterThan(100);
  });

  it("mjml2html with validationLevel strict", () => {
    let err: unknown = null;
    try {
      mjml2html(STAMPED, { validationLevel: "strict" });
    } catch (e) {
      err = e;
    }
    console.log("STRICT result:", err ? String(err).slice(0, 400) : "no throw");
  });
});

describe("PROOF 6 — stampPaths still works on stamped source", () => {
  it("overlay stamping unaffected", async () => {
    const { stampMjmlPaths } = await import("../../src/shared/blocks/stampPaths.js");
    const res = mjml2html(STAMPED, { validationLevel: "soft" }) as { html: string };
    const out = stampMjmlPaths(STAMPED, res.html);
    console.log(`stamped=${out.stamped} expected=${out.expected} missing=${JSON.stringify(out.missing)}`);
    expect(out.expected).toBeGreaterThan(0);
  });
});

describe("PROOF 7 — where it might break", () => {
  it("duplicate attr names", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-button data-cmp="a" data-cmp="b">x</mj-button></mj-column></mj-section></mj-body></mjml>`;
    const doc = parseMjml(src);
    const b = find(doc.body, "mj-button")!;
    console.log("DUP attrs:", [...b.attrs.entries()]);
    console.log("DUP out:", serializeMjml(doc));
  });

  it("valueless (boolean) attr", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-button data-cmp-locked href="#">x</mj-button></mj-column></mj-section></mj-body></mjml>`;
    const doc = parseMjml(src);
    const b = find(doc.body, "mj-button");
    console.log("BOOL node type:", b?.type, "attrs:", b ? [...b.attrs.entries()] : "N/A");
    console.log("BOOL out:", serializeMjml(doc));
  });

  it("single-quoted attr value", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-button data-cmp='a/b' href="#">x</mj-button></mj-column></mj-section></mj-body></mjml>`;
    const doc = parseMjml(src);
    const b = find(doc.body, "mj-button")!;
    console.log("SQ attrs:", [...b.attrs.entries()]);
    console.log("SQ out:", serializeMjml(doc));
  });

  it("mj-text with inline HTML children (demotes to passthrough?)", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text data-cmp="brand/copy"><p>Hello <b>world</b></p></mj-text></mj-column></mj-section></mj-body></mjml>`;
    const doc = parseMjml(src);
    let kind = "none";
    walk(doc.body, (n) => {
      if (n.type === "mj-custom-passthrough") kind = "passthrough";
      if (n.type === "mj-text") kind = "block";
    });
    console.log("RICH TEXT node kind:", kind);
    console.log("RICH TEXT out:", serializeMjml(doc));
  });

  it("body-level attrs", () => {
    const src = `<mjml><mj-body data-cmp-doc="brand/base" width="600px"><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const doc = parseMjml(src);
    console.log("BODY attrs:", doc.bodyAttrs ? [...doc.bodyAttrs.entries()] : "none");
    console.log("BODY out:", serializeMjml(doc));
  });
});
