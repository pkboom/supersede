import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { defaultEmailFile, extractElementPrompt } from "../../dev/extractElementPromptCommand.js";
import { decodeHtml } from "../../src/htmlTargets.js";
import { extractRelatedPartWithLuna } from "../../src/partExtractor.js";

describe("extractElementPromptCommand", () => {
  it("shows the entered text inside the fenced prompt", () => {
    const result = extractElementPrompt({ text: "TRACK YOUR ORDER", file: defaultEmailFile });

    expect(result.prompt).toContain("Requested change: TRACK YOUR ORDER");
    expect(result.prompt).toContain("<email_html>");
    expect(result.prompt).toContain("</email_html>");
    expect(result.prompt).toContain("⟦element-00001⟧");
    expect(result.analyzedElements).toBeGreaterThan(0);
  });

  it("shows exactly the prompt the extractor sends", async () => {
    const text = "123 Example Street Suite 500 Springfield, IL 62704";
    const source = decodeHtml(readFileSync(defaultEmailFile), defaultEmailFile);
    const runLuna = vi.fn(async () => ({ status: "review", elementId: "", replacement: "", reason: "dry run" }));

    await extractRelatedPartWithLuna(source, { text, runLuna }).catch(() => {});

    expect(extractElementPrompt({ text, file: defaultEmailFile }).prompt).toBe(runLuna.mock.calls[0][0].prompt);
  });

  it("requires a requested item", () => {
    expect(() => extractElementPrompt({ text: "  ", file: defaultEmailFile })).toThrow(/requested item is required/i);
  });
});
