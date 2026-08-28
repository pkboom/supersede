import { describe, expect, it } from "vitest";
import { buildPrompt } from "../../src/llm/promptBuilder.js";
import type { BlockDef } from "../../src/shared/blocks/registry.js";

/**
 * Byte-stability snapshot per spec line 232. A frozen 2-block registry stub
 * isolates the test from BLOCK_REGISTRY drift in `src/shared/blocks/registry.ts`
 * — the v2 catalog format itself is what's pinned here.
 *
 * If this snapshot ever drifts, every Claude turn's prompt is changing too.
 * Review the diff carefully before regenerating with `vitest -u`.
 */
const FROZEN: Record<string, BlockDef> = Object.freeze({
  "mj-button": Object.freeze({
    type: "mj-button",
    label: "Button",
    defaults: Object.freeze({
      href: "#",
      "background-color": "#1f6feb",
      color: "#ffffff",
    }),
    allowedAttrs: Object.freeze(["href", "background-color", "color"]) as unknown as string[],
    allowedChildren: null,
    isContainer: false,
    contentField: "text",
  }) as BlockDef,
  "mj-section": Object.freeze({
    type: "mj-section",
    label: "Section",
    defaults: Object.freeze({
      "background-color": "#ffffff",
      padding: "20px 0",
    }),
    allowedAttrs: Object.freeze(["background-color", "padding"]) as unknown as string[],
    allowedChildren: Object.freeze(["mj-column"]) as unknown as BlockDef["allowedChildren"],
    isContainer: true,
  }) as BlockDef,
});

const NON_EMPTY = `<mjml><mj-body><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>`;
const EMPTY = `<mjml><mj-body></mj-body></mjml>`;

describe("buildPrompt byte-stability snapshot", () => {
  it("is byte-identical across two calls (non-empty body, frozen registry)", () => {
    const a = buildPrompt({ mjml: NON_EMPTY, query: "Q", registry: FROZEN });
    const b = buildPrompt({ mjml: NON_EMPTY, query: "Q", registry: FROZEN });
    expect(a.blockCatalog).toBe(b.blockCatalog);
    expect(a.systemGuidance).toBe(b.systemGuidance);
    expect(a.blockCatalog).toMatchSnapshot("frozen-non-empty-catalog");
  });

  it("is byte-identical across two calls (empty body branch, frozen registry)", () => {
    const a = buildPrompt({ mjml: EMPTY, query: "Q", registry: FROZEN });
    const b = buildPrompt({ mjml: EMPTY, query: "Q", registry: FROZEN });
    expect(a.blockCatalog).toBe(b.blockCatalog);
    expect(a.blockCatalog).toMatchSnapshot("frozen-empty-body-catalog");
  });

  it("system guidance text is itself snapshotted (drift detector)", () => {
    const out = buildPrompt({ mjml: NON_EMPTY, query: "Q", registry: FROZEN });
    expect(out.systemGuidance).toMatchSnapshot("system-guidance");
  });
});
