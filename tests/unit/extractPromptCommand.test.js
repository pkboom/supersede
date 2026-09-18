import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { defaultEmailFile, extractPrompt } from "../../dev/extractPromptCommand.js";
import { decodeHtml } from "../../src/htmlTargets.js";
import { extractRelatedPartWithLuna } from "../../src/partExtractor.js";

describe("extractPromptCommand", () => {
  it("shows the entered text inside the fenced prompt", () => {
    const result = extractPrompt({ text: "TRACK YOUR ORDER", file: defaultEmailFile });

    expect(result.prompt).toContain("Requested item: TRACK YOUR ORDER");
    expect(result.prompt).toContain("<email_html>");
    expect(result.prompt).toContain("</email_html>");
    expect(result.prompt).toContain("⟦element-00001⟧");
    expect(result.analyzedElements).toBeGreaterThan(0);
  });

  it("shows exactly the prompt the extractor sends", async () => {
    const text = "123 Example Street Suite 500 Springfield, IL 62704";
    const source = decodeHtml(readFileSync(defaultEmailFile), defaultEmailFile);
    const runLuna = vi.fn(async () => ({ status: "review", elementId: "", reason: "dry run" }));

    await extractRelatedPartWithLuna(source, { text, runLuna }).catch(() => {});

    expect(extractPrompt({ text, file: defaultEmailFile }).prompt).toBe(runLuna.mock.calls[0][0].prompt);
  });

  it("requires a requested item", () => {
    expect(() => extractPrompt({ text: "  ", file: defaultEmailFile })).toThrow(/requested item is required/i);
  });
});
