import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { defaultEmailFile, extractElementPrompt } from "../../dev/extractElementPromptCommand.js";
import { decodeHtml } from "../../src/htmlTargets.js";
import { extractRelatedPartWithLuna } from "../../src/partExtractor.js";

describe("extractElementPromptCommand", () => {
  it("shows the entered text inside the fenced prompt", () => {
    const result = extractElementPrompt({ find: "TRACK YOUR ORDER", file: defaultEmailFile });

    expect(result.prompt).toContain("User request: TRACK YOUR ORDER");
    expect(result.prompt).toContain("<email_html>");
    expect(result.prompt).toContain("</email_html>");
    expect(result.prompt).toContain("⟦element-00001⟧");
    expect(result.analyzedElements).toBeGreaterThan(0);
  });

  it("shows exactly the prompt the extractor sends", async () => {
    const find = "123 Example Street Suite 500 Springfield, IL 62704";
    const source = decodeHtml(readFileSync(defaultEmailFile), defaultEmailFile);
    const runLuna = vi.fn(async () => ({ status: "review", elementId: "", replacement: "", reason: "dry run" }));

    await extractRelatedPartWithLuna(source, { text: find, runLuna }).catch(() => {});

    expect(extractElementPrompt({ find, file: defaultEmailFile }).prompt).toBe(runLuna.mock.calls[0][0].prompt);
  });

  it("requires a find phase", () => {
    expect(() => extractElementPrompt({ find: "  ", file: defaultEmailFile })).toThrow(/find phase is required/i);
  });
});
