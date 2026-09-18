import { describe, expect, it } from "vitest";
import { defaultEmailFile, extractPattern } from "../../dev/extractPatternCommand.js";
import { buildElementAnnotatedView, decodeHtml } from "../../src/htmlTargets.js";
import { readFileSync } from "node:fs";

function selector(predicate) {
  const source = decodeHtml(readFileSync(defaultEmailFile), defaultEmailFile);
  const view = buildElementAnnotatedView(source);
  const element = [...view.elements.values()].find(predicate);
  return async () => ({ status: "found", elementId: element.id, reason: "Selected by Luna." });
}

describe("extractPatternCommand", () => {
  it("uses the copied sample email by default and extracts Luna-selected text context", async () => {
    const result = await extractPattern({
      text: "123 Example Street Suite 500 Springfield, IL 62704",
      file: defaultEmailFile,
      runLuna: selector((element) => element.tagName === "td" && element.html.includes("123 Example Street")),
    });

    expect(result.part.html).toContain("123 Example Street <strong>Suite 500</strong> &bull; Springfield, IL 62704");
    expect(result.part.tagName).toBe("td");
  });

  it("extracts the complete Luna-selected shared button cell", async () => {
    const result = await extractPattern({
      text: "TRACK YOUR ORDER",
      file: defaultEmailFile,
      runLuna: selector((element) => element.tagName === "td" && element.html.includes('class="innertd buttonblock"') && element.html.includes("TRACK YOUR ORDER")),
    });

    expect(result.part.tagName).toBe("td");
    expect(result.part.html).toContain('class="innertd buttonblock"');
    expect(result.part.html).toContain("TRACK YOUR ORDER");
  });
});
