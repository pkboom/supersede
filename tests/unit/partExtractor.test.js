import { describe, expect, it, vi } from "vitest";
import { buildElementAnnotatedView } from "../../src/htmlTargets.js";
import { extractRelatedPartWithLuna } from "../../src/partExtractor.js";

describe("Luna related-part extraction", () => {
  it("selects one exact original element even when visible text crosses br and nested tags", async () => {
    const source = `<table><tr><td>123 Old Street<br>Toronto, <strong>ON</strong> M1M 1M1</td></tr></table>`;
    const view = buildElementAnnotatedView(source);
    const cell = [...view.elements.values()].find((element) => element.tagName === "td");
    const runLuna = vi.fn(async () => ({
      status: "found",
      elementId: cell.id,
      reason: "This cell contains the complete visible address.",
    }));

    const result = await extractRelatedPartWithLuna(source, {
      text: "123 Old Street Toronto, ON M1M 1M1",
      runLuna,
    });

    expect(result.html).toBe(`<td>123 Old Street<br>Toronto, <strong>ON</strong> M1M 1M1</td>`);
    expect(runLuna.mock.calls[0][0].model).toBe("gpt-5.6-luna");
    expect(runLuna.mock.calls[0][0].prompt).toContain("Visible text may be split by <br>");
  });

  it("requires a requested item", async () => {
    await expect(extractRelatedPartWithLuna(`<p>Hello</p>`, { text: "  " }))
      .rejects.toThrow(/requested item is required/i);
  });

  it("asks for the whole button container rather than its label span", async () => {
    const runLuna = vi.fn(async () => ({ status: "found", elementId: "element-00001", reason: "x" }));
    await extractRelatedPartWithLuna(`<p>Hello</p>`, { text: "TRACK YOUR ORDER", runLuna }).catch(() => {});

    expect(runLuna.mock.calls[0][0].prompt).toContain("td.buttonblock");
    expect(runLuna.mock.calls[0][0].prompt).toContain("Requested item: TRACK YOUR ORDER");
  });

  it("rejects a hallucinated element ID", async () => {
    await expect(extractRelatedPartWithLuna(`<p>Hello</p>`, {
      text: "Hello",
      runLuna: async () => ({ status: "found", elementId: "element-99999", reason: "x" }),
    })).rejects.toThrow(/unknown element/i);
  });
});
