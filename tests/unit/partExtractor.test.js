import { describe, expect, it, vi } from "vitest";
import { buildElementAnnotatedView } from "../../src/htmlTargets.js";
import { buildReplacementPrompt, extractRelatedPartWithLuna } from "../../src/partExtractor.js";

const address = `<table><tr><td>123 Old Street<br>Toronto, <strong>ON</strong> M1M 1M1</td></tr></table>`;

function cellOf(source, predicate = (element) => element.tagName === "td") {
  return [...buildElementAnnotatedView(source).elements.values()].find(predicate);
}

describe("Luna related-part extraction", () => {
  it("returns the exact original element and the replacement beside it", async () => {
    const cell = cellOf(address);
    const replacement = `<td>1 New Street<br>New York, <strong>NY</strong> 10001</td>`;
    const runLuna = vi.fn(async ({ schema }) =>
      schema.properties.status.enum.includes("found")
        ? { status: "found", elementId: cell.id, reason: "This cell contains the complete visible address." }
        : { status: "rewritten", replacement, reason: "Address swapped." });

    const result = await extractRelatedPartWithLuna(address, {
      text: `Replace the address "123 Old Street Toronto, ON M1M 1M1" with "1 New Street New York, NY 10001".`,
      runLuna,
    });

    expect(result.html).toBe(`<td>123 Old Street<br>Toronto, <strong>ON</strong> M1M 1M1</td>`);
    expect(result.replacement).toBe(replacement);
    expect(runLuna.mock.calls[0][0].model).toBe("gpt-5.6-luna");
    expect(runLuna.mock.calls[0][0].prompt).toContain("Visible text may be split by <br>");
    expect(runLuna.mock.calls[1][0].prompt).toContain("byte for byte, not a compacted view");
    expect(runLuna.mock.calls[1][0].prompt).toContain(cell.html);
  });

  it("requires a requested item", async () => {
    await expect(extractRelatedPartWithLuna(`<p>Hello</p>`, { text: "  " }))
      .rejects.toThrow(/requested item is required/i);
  });

  it("asks the selection call for the whole button container", async () => {
    const runLuna = vi.fn(async () => ({ status: "review", elementId: "", reason: "x" }));
    await extractRelatedPartWithLuna(`<p>Hello</p>`, { text: "TRACK YOUR ORDER", runLuna }).catch(() => {});
    const { prompt } = runLuna.mock.calls[0][0];

    expect(prompt).toContain("td.buttonblock");
    expect(prompt).toContain("Requested change: TRACK YOUR ORDER");
  });

  it("asks the rewrite call to keep every other byte, on unminified source", async () => {
    const prompt = buildReplacementPrompt("Replace x with y", `<td>  a\n  b</td>`);

    expect(prompt).toContain("byte for byte, not a compacted view");
    expect(prompt).toContain("the same newlines and indentation");
    expect(prompt).toContain("drop that tag rather than stretching it");
    expect(prompt).toContain(`<td>  a\n  b</td>`);
  });

  it("rejects a hallucinated element ID", async () => {
    await expect(extractRelatedPartWithLuna(`<p>Hello</p>`, {
      text: "Hello",
      runLuna: async () => ({ status: "found", elementId: "element-99999", reason: "x" }),
    })).rejects.toThrow(/unknown element/i);
  });

  it("rejects an empty, unchanged, or substituted replacement", async () => {
    const cell = cellOf(address);
    const reply = (replacement) => async ({ schema }) =>
      schema.properties.status.enum.includes("found")
        ? { status: "found", elementId: cell.id, reason: "x" }
        : { status: "rewritten", replacement, reason: "x" };

    await expect(extractRelatedPartWithLuna(address, { text: "x", runLuna: reply("  ") }))
      .rejects.toThrow(/empty replacement/i);
    await expect(extractRelatedPartWithLuna(address, { text: "x", runLuna: reply(cell.html) }))
      .rejects.toThrow(/unchanged replacement/i);
    await expect(extractRelatedPartWithLuna(address, { text: "x", runLuna: reply(`<div>1 New Street</div>`) }))
      .rejects.toThrow(/different element/i);
  });
});
