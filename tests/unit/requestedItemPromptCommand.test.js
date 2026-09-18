import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { defaultEmailFile, requestedItemPrompt } from "../../dev/requestedItemPromptCommand.js";
import { decodeHtml } from "../../src/htmlTargets.js";
import { resolveRequestedItemWithLuna } from "../../src/itemResolver.js";

describe("requestedItemPromptCommand", () => {
  it("shows the request inside the fenced prompt", () => {
    const result = requestedItemPrompt({ request: "make the button blue", file: defaultEmailFile });

    expect(result.prompt).toContain("Request: make the button blue");
    expect(result.prompt).toContain("<email_html>");
    expect(result.prompt).toContain("</email_html>");
    expect(result.prompt).toContain("TRACK YOUR ORDER");
  });

  it("shows exactly the prompt the resolver sends", async () => {
    const request = "update our postal address";
    const source = decodeHtml(readFileSync(defaultEmailFile), defaultEmailFile);
    const runLuna = vi.fn(async () => ({ status: "resolved", requestedItem: "x", reason: "dry run" }));

    await resolveRequestedItemWithLuna(source, { request, runLuna }).catch(() => {});

    expect(requestedItemPrompt({ request, file: defaultEmailFile }).prompt).toBe(runLuna.mock.calls[0][0].prompt);
  });

  it("requires a request", () => {
    expect(() => requestedItemPrompt({ request: "  ", file: defaultEmailFile })).toThrow(/request is required/i);
  });
});
