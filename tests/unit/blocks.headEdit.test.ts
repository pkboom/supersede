import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  escapeHtml,
  getPreheader,
  getTitle,
  setPreheader,
  setTitle,
} from "../../src/shared/blocks/headEdit.js";
import { parseMjml, serializeMjml } from "../../src/shared/blocks/index.js";
import type { MjmlDocument } from "../../src/shared/blocks/index.js";

describe("headEdit — 5 R9-prime edge cases", () => {
  it("(i) head with no mj-title or mj-preview — setTitle/setPreheader insert", () => {
    const head = `<mj-head></mj-head>`;
    const afterTitle = setTitle(head, "Hello");
    expect(afterTitle).toContain("<mj-title>Hello</mj-title>");
    const afterBoth = setPreheader(afterTitle, "World");
    expect(afterBoth).toContain("<mj-title>Hello</mj-title>");
    expect(afterBoth).toContain("<mj-preview>World</mj-preview>");
    expect(getTitle(afterBoth)).toBe("Hello");
    expect(getPreheader(afterBoth)).toBe("World");
  });

  it("(ii) head with both — getX returns inner text; setX edits in place", () => {
    const head = `<mj-head><mj-title>Old Title</mj-title><mj-preview>Old Preheader</mj-preview></mj-head>`;
    expect(getTitle(head)).toBe("Old Title");
    expect(getPreheader(head)).toBe("Old Preheader");

    const next = setTitle(head, "New Title");
    expect(getTitle(next)).toBe("New Title");
    expect(getPreheader(next)).toBe("Old Preheader");
    expect(next.match(/<mj-title>/g)?.length).toBe(1);
    expect(next.match(/<mj-preview>/g)?.length).toBe(1);
  });

  it("(iii) head with duplicate <mj-title> — setTitle edits first, leaves second", () => {
    const head = `<mj-head><mj-title>First</mj-title><mj-title>Second</mj-title></mj-head>`;
    const next = setTitle(head, "Replaced");
    expect(next).toContain("<mj-title>Replaced</mj-title>");
    expect(next).toContain("<mj-title>Second</mj-title>");
    expect(getTitle(next)).toBe("Replaced");
  });

  it("(iv) value with $1, \\, <script>, &amp; is HTML-escaped (indexOf-safe)", () => {
    const head = `<mj-head><mj-title>old</mj-title></mj-head>`;
    const tricky = `value$1\\<script>alert("x")</script>&amp;end`;
    const next = setTitle(head, tricky);
    expect(next).toContain("&lt;script&gt;");
    expect(next).toContain("&amp;amp;end");
    expect(next).not.toContain("<script>");
    expect(next).toContain(`"x"`);
    const escaped = escapeHtml(tricky);
    expect(getTitle(next)).toBe(escaped);
  });

  it("(v) document with no mj-head — caller materializes synthetic head; serializer round-trips", () => {
    const src = `<mjml><mj-body><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>`;
    const doc: MjmlDocument = parseMjml(src);
    expect(doc.head).toBeUndefined();

    const synthetic = setTitle("<mj-head></mj-head>", "Synthetic Title");
    const next: MjmlDocument = {
      ...doc,
      head: { rawXml: synthetic, __synthetic: true },
    };
    const out = serializeMjml(next);
    expect(out).toContain("<mj-head>");
    expect(out).toContain("<mj-title>Synthetic Title</mj-title>");
    expect(out).not.toContain("__synthetic");

    const reparsed = parseMjml(out);
    expect(reparsed.head?.rawXml ?? "").toContain("<mj-title>Synthetic Title</mj-title>");
  });
});

const trickyCharsArb = fc.stringMatching(
  /^[A-Za-z0-9$\\<>&"'()|.+*?{}[\]^!@#:; -]{0,30}$/
);

describe("headEdit (property)", () => {
  it("setTitle then getTitle round-trips for arbitrary regex-laden values", () => {
    fc.assert(
      fc.property(trickyCharsArb, (val) => {
        const head = `<mj-head><mj-title>seed</mj-title></mj-head>`;
        const next = setTitle(head, val);
        return getTitle(next) === escapeHtml(val);
      }),
      { numRuns: 200 }
    );
  });

  it("setPreheader is independent of setTitle and vice-versa", () => {
    fc.assert(
      fc.property(trickyCharsArb, trickyCharsArb, (t, p) => {
        let head = `<mj-head></mj-head>`;
        head = setTitle(head, t);
        head = setPreheader(head, p);
        return (
          getTitle(head) === escapeHtml(t) &&
          getPreheader(head) === escapeHtml(p)
        );
      }),
      { numRuns: 100 }
    );
  });
});
