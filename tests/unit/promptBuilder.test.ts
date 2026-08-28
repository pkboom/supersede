import { describe, expect, it } from "vitest";
import { BLOCK_REGISTRY } from "../../src/shared/blocks/registry.js";
import { STARTER_MJML, buildPrompt } from "../../src/llm/promptBuilder.js";

const NON_EMPTY = `<mjml><mj-body><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>`;
const EMPTY = `<mjml><mj-body></mj-body></mjml>`;

describe("buildPrompt", () => {
  it("always emits the catalog (non-empty MJML)", () => {
    const out = buildPrompt({ mjml: NON_EMPTY, query: "make button blue" });
    expect(out.blockCatalog).toContain("Available block types");
    // Sanity: a representative tag is present
    expect(out.blockCatalog).toContain("- mj-button:");
  });

  it("always emits the catalog (empty MJML)", () => {
    const out = buildPrompt({ mjml: EMPTY, query: "build a welcome email" });
    expect(out.blockCatalog).toContain("Available block types");
  });

  it("excludes mj-custom-passthrough from the catalog", () => {
    const out = buildPrompt({ mjml: NON_EMPTY, query: "x" });
    expect(out.blockCatalog).not.toContain("mj-custom-passthrough");
  });

  it("renders every BLOCK_REGISTRY entry except mj-custom-passthrough with its defaults keys", () => {
    const out = buildPrompt({ mjml: NON_EMPTY, query: "x" });
    for (const [tag, def] of Object.entries(BLOCK_REGISTRY)) {
      if (tag === "mj-custom-passthrough") continue;
      expect(out.blockCatalog).toContain(`- ${tag}:`);
      for (const k of Object.keys(def.defaults)) {
        expect(out.blockCatalog).toContain(JSON.stringify(k));
      }
    }
  });

  it("marks text-content blocks with the text-content marker", () => {
    const out = buildPrompt({ mjml: NON_EMPTY, query: "x" });
    expect(out.blockCatalog).toMatch(/- mj-text:.*text-content/);
    expect(out.blockCatalog).toMatch(/- mj-button:.*text-content/);
    expect(out.blockCatalog).toMatch(/- mj-social-element:.*text-content/);
    // And NOT on a non-text-content block:
    expect(out.blockCatalog).not.toMatch(/- mj-section:.*text-content/);
  });

  it("marks containers and lists their allowed children", () => {
    const out = buildPrompt({ mjml: NON_EMPTY, query: "x" });
    expect(out.blockCatalog).toMatch(/- mj-section: container, children=\[mj-column\]/);
    expect(out.blockCatalog).toMatch(/- mj-column: container, children=\[/);
  });

  it("fires the empty-body branch when parsed body is empty", () => {
    const out = buildPrompt({ mjml: EMPTY, query: "build a welcome email" });
    expect(out.blockCatalog).toContain("The current template is empty");
    expect(out.blockCatalog).toContain(STARTER_MJML);
  });

  it("does NOT fire the empty-body branch when body has content", () => {
    const out = buildPrompt({ mjml: NON_EMPTY, query: "x" });
    expect(out.blockCatalog).not.toContain("The current template is empty");
    expect(out.blockCatalog).not.toContain(STARTER_MJML);
  });

  it("does NOT fire the empty-body branch when MJML is malformed (parse failure)", () => {
    const out = buildPrompt({ mjml: "<<<not real mjml>>>", query: "fix this" });
    // Catalog still present, but no starter injection
    expect(out.blockCatalog).toContain("Available block types");
    expect(out.blockCatalog).not.toContain("The current template is empty");
  });

  it("emits deterministic output across two calls with same args", () => {
    const a = buildPrompt({ mjml: NON_EMPTY, query: "x" });
    const b = buildPrompt({ mjml: NON_EMPTY, query: "x" });
    expect(a.blockCatalog).toBe(b.blockCatalog);
    expect(a.systemGuidance).toBe(b.systemGuidance);
  });

  it("echoes mjml and query verbatim", () => {
    const out = buildPrompt({ mjml: NON_EMPTY, query: "rewrite the headline" });
    expect(out.mjml).toBe(NON_EMPTY);
    expect(out.query).toBe("rewrite the headline");
  });

  it("entries are emitted in alphabetical tag order", () => {
    const out = buildPrompt({ mjml: NON_EMPTY, query: "x" });
    const lines = out.blockCatalog.split("\n").filter((l) => l.startsWith("- "));
    const tags = lines.map((l) => l.match(/^- (\S+):/)![1]);
    const sorted = [...tags].sort();
    expect(tags).toEqual(sorted);
  });
});
