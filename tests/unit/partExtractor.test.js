import { describe, expect, it, vi } from "vitest";
import { buildElementAnnotatedView } from "../../src/htmlTargets.js";
import { extractRelatedPartWithLuna } from "../../src/partExtractor.js";

const address = `<table><tr><td>123 Old Street<br>Toronto, <strong>ON</strong> M1M 1M1</td></tr></table>`;

function cellOf(source, predicate = (element) => element.tagName === "td") {
  return [...buildElementAnnotatedView(source).elements.values()].find(predicate);
}

describe("Luna related-part extraction", () => {
  it("returns the exact original element", async () => {
    const cell = cellOf(address);
    const runLuna = vi.fn(async () => ({
      status: "found",
      elementId: cell.id,
      reason: "This cell contains the complete visible address.",
    }));

    const result = await extractRelatedPartWithLuna(address, {
      text: `Replace the address "123 Old Street Toronto, ON M1M 1M1" with "1 New Street New York, NY 10001".`,
      runLuna,
    });

    expect(result.html).toBe(`<td>123 Old Street<br>Toronto, <strong>ON</strong> M1M 1M1</td>`);
    expect(result.replacement).toBeUndefined();
    expect(runLuna).toHaveBeenCalledTimes(1);
    expect(runLuna.mock.calls[0][0].model).toBe("gpt-5.6-luna");
    expect(runLuna.mock.calls[0][0].prompt).toContain("Visible text may be split by <br>");
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

  it("rejects a hallucinated element ID", async () => {
    await expect(extractRelatedPartWithLuna(`<p>Hello</p>`, {
      text: "Hello",
      runLuna: async () => ({ status: "found", elementId: "element-99999", reason: "x" }),
    })).rejects.toThrow(/unknown element/i);
  });
});
