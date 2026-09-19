import { describe, expect, it, vi } from "vitest";
import {
  applyChange,
  buildChangeSpanPrompt,
  checkDeterminism,
  narrowChangeWithLuna,
  normalizeForComparison,
  occurrencesOf,
} from "../../src/changeNarrower.js";

const element = `<td id="Footer">\n  &copy; 2026 Example\n  123 Old Street &bull; Springfield, IL 62704<br>\n</td>`;
const span = "123 Old Street &bull; Springfield, IL 62704";

function luna(response) {
  return vi.fn(async () => ({ interpretation: "value", ...response }));
}

describe("change narrowing", () => {
  it("narrows an element to the span that actually changes", async () => {
    const runLuna = luna({ status: "narrowed", from: span, to: "1 New Street, New York, US", reason: "Address." });
    const change = await narrowChangeWithLuna(element, { text: `Replace "..." with "..."`, runLuna });

    expect(change.from).toBe(span);
    expect(change.to).toBe("1 New Street, New York, US");
    expect(change.from.length).toBeLessThan(element.length / 2);
    expect(runLuna.mock.calls[0][0].prompt).toContain(element);
    expect(runLuna.mock.calls[0][0].prompt).toContain("byte for byte");
  });

  it("refuses a span that is not in the element", async () => {
    await expect(narrowChangeWithLuna(element, {
      text: "x",
      runLuna: luna({ status: "narrowed", from: "123 Old Street • Springfield", to: "y", reason: "x" }),
    })).rejects.toThrow(/not in the element/i);
  });

  it("refuses an empty or unchanged span", async () => {
    await expect(narrowChangeWithLuna(element, {
      text: "x",
      runLuna: luna({ status: "narrowed", from: "", to: "y", reason: "x" }),
    })).rejects.toThrow(/cannot be empty/i);

    await expect(narrowChangeWithLuna(element, {
      text: "x",
      runLuna: luna({ status: "narrowed", from: span, to: span, reason: "x" }),
    })).rejects.toThrow(/must change something/i);
  });

  it("fails closed when the element does not carry the change", async () => {
    await expect(narrowChangeWithLuna(element, {
      text: "x",
      runLuna: luna({ status: "not_applicable", from: "", to: "", reason: "No address here." }),
    })).rejects.toThrow(/no address here/i);
  });

  it("counts every occurrence, not just the first", () => {
    expect(occurrencesOf("a-b-a-b-a", "a")).toEqual([0, 4, 8]);
    expect(occurrencesOf("aaaa", "aa")).toEqual([0, 2]);
    expect(occurrencesOf("abc", "z")).toEqual([]);
  });

  it("calls a change deterministic only when it is unique in every file", () => {
    const change = { from: "OLD", to: "NEW" };

    expect(checkDeterminism([
      { id: "a.html", source: "x OLD y" },
      { id: "b.html", source: "z OLD w" },
    ], change).status).toBe("deterministic");

    expect(checkDeterminism([
      { id: "a.html", source: "x OLD y" },
      { id: "b.html", source: "nothing here" },
    ], change).status).toBe("partial");

    const ambiguous = checkDeterminism([
      { id: "a.html", source: "OLD and OLD" },
      { id: "b.html", source: "x OLD y" },
    ], change);
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.perFile[0].occurrences).toBe(2);
  });

  it("refuses to apply a change that is not unique", () => {
    expect(applyChange("x OLD y", { from: "OLD", to: "NEW" })).toBe("x NEW y");
    expect(() => applyChange("OLD OLD", { from: "OLD", to: "NEW" })).toThrow(/matches 2 times/i);
    expect(() => applyChange("nothing", { from: "OLD", to: "NEW" })).toThrow(/matches 0 times/i);
  });

  it("applies a replacement literally, without treating $ as a pattern", () => {
    expect(applyChange("price OLD here", { from: "OLD", to: "$& $1 $'" })).toBe("price $& $1 $' here");
  });

  it("asks for the shortest run and fences the element", () => {
    const prompt = buildChangeSpanPrompt("Replace a with b", element);

    expect(prompt).toContain("shortest run that covers the whole change");
    expect(prompt).toContain("<email_html>");
    expect(prompt).toContain("</email_html>");
  });

  it("rejects a span that does not carry the value the request named", async () => {
    await expect(narrowChangeWithLuna(element, {
      text: `Replace the button colour "#E51937" with "#00529B".`,
      expectFrom: "#E51937",
      runLuna: luna({ status: "narrowed", from: "123 Old Street", to: "#00529B", reason: "x" }),
    })).rejects.toThrow(/does not carry the value the request named/i);
  });

  it("accepts a span whose entities differ from the value the request named", async () => {
    const change = await narrowChangeWithLuna(element, {
      text: `Replace the address "123 Old Street • Springfield, IL 62704" with "1 New Street".`,
      expectFrom: "123 Old Street • Springfield, IL 62704",
      runLuna: luna({ status: "narrowed", from: span, to: "1 New Street", reason: "x" }),
    });

    expect(change.from).toBe(span);
  });

  it("refuses to write the words of a property change into the email", async () => {
    const button = `<td class="innertd buttonblock" bgcolor="#E51937" style="background-color: #E51937;"><a style="background-color: #E51937;" href="https://x">START EARNING TOGETHER</a></td>`;

    await expect(narrowChangeWithLuna(button, {
      text: "Target: button: start earning together\nRequested change: update the background to sky blue",
      replacement: "update the background to sky blue",
      runLuna: luna({
        status: "narrowed",
        interpretation: "instruction",
        from: "START EARNING TOGETHER",
        to: "update the background to sky blue",
        reason: "x",
      }),
    })).rejects.toThrow(/writes the words of the request into the email/i);
  });

  it("allows a property change that edits the markup carrying the property", async () => {
    const button = `<td bgcolor="#E51937" style="background-color: #E51937;"><a href="https://x">GO</a></td>`;

    const change = await narrowChangeWithLuna(button, {
      text: "Target: the button\nRequested change: update the background to sky blue",
      replacement: "update the background to sky blue",
      runLuna: luna({
        status: "narrowed",
        interpretation: "instruction",
        from: `bgcolor="#E51937" style="background-color: #E51937;"`,
        to: `bgcolor="#87CEEB" style="background-color: #87CEEB;"`,
        reason: "x",
      }),
    });

    expect(change.to).toContain("#87CEEB");
    expect(change.interpretation).toBe("instruction");
  });

  it("still allows a literal value that happens to read like a sentence", async () => {
    const change = await narrowChangeWithLuna(element, {
      text: "Target: the footer address\nRequested change: Update your details at example.com",
      replacement: "Update your details at example.com",
      runLuna: luna({
        status: "narrowed",
        interpretation: "value",
        from: span,
        to: "Update your details at example.com",
        reason: "x",
      }),
    });

    expect(change.to).toBe("Update your details at example.com");
  });

  it("compares entities, tags, and case the same way", () => {
    expect(normalizeForComparison("A &bull; B")).toBe("a • b");
    expect(normalizeForComparison("<strong>Suite 500</strong>  x")).toBe("suite 500 x");
    expect(normalizeForComparison("123 Example Street<br>Springfield, IL 62704"))
      .toBe("123 example street springfield, il 62704");
    expect(normalizeForComparison("&#8226;")).toBe("•");
  });
});
