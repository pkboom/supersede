import { describe, it, expect } from "vitest";
import {
  deleteMjAttribute,
  getMjAttribute,
  setMjAttribute,
} from "../../src/shared/blocks/mjAttributes.js";

describe("getMjAttribute", () => {
  it("returns the value for an existing element/attr pair", () => {
    const head =
      '<mj-head><mj-attributes><mj-text color="#333" font-family="Arial, sans-serif" /><a color="#1f6feb" /></mj-attributes></mj-head>';
    expect(getMjAttribute(head, "mj-text", "color")).toBe("#333");
    expect(getMjAttribute(head, "mj-text", "font-family")).toBe(
      "Arial, sans-serif"
    );
    expect(getMjAttribute(head, "a", "color")).toBe("#1f6feb");
  });

  it("returns empty string when mj-attributes is missing", () => {
    const head = "<mj-head><mj-title>x</mj-title></mj-head>";
    expect(getMjAttribute(head, "mj-text", "color")).toBe("");
  });

  it("returns empty string when the element is missing", () => {
    const head =
      '<mj-head><mj-attributes><mj-button color="#fff" /></mj-attributes></mj-head>';
    expect(getMjAttribute(head, "mj-text", "color")).toBe("");
  });

  it("returns empty string when the attr is missing", () => {
    const head =
      '<mj-head><mj-attributes><mj-text font-family="Arial" /></mj-attributes></mj-head>';
    expect(getMjAttribute(head, "mj-text", "color")).toBe("");
  });

  it("does not match attribute names that appear inside other attribute values", () => {
    const head =
      '<mj-head><mj-attributes><mj-text href="https://x.test/?color=red" font-size="14px" /></mj-attributes></mj-head>';
    expect(getMjAttribute(head, "mj-text", "color")).toBe("");
  });

  it("does not match a tag prefix (mj-text vs mj-text-extra)", () => {
    const head =
      '<mj-head><mj-attributes><mj-text-extra color="#000" /></mj-attributes></mj-head>';
    expect(getMjAttribute(head, "mj-text", "color")).toBe("");
  });

  it("validates element/attr names defensively", () => {
    const head =
      '<mj-head><mj-attributes><mj-text color="#000" /></mj-attributes></mj-head>';
    expect(getMjAttribute(head, "", "color")).toBe("");
    expect(getMjAttribute(head, "mj-text", "")).toBe("");
    expect(getMjAttribute(head, "mj text", "color")).toBe("");
    expect(getMjAttribute(head, "mj-text", "co lor")).toBe("");
  });
});

describe("setMjAttribute — update existing value", () => {
  it("replaces an existing attr value in place", () => {
    const head =
      '<mj-head><mj-attributes><mj-text color="#333" /></mj-attributes></mj-head>';
    const out = setMjAttribute(head, "mj-text", "color", "#000000");
    expect(out).toBe(
      '<mj-head><mj-attributes><mj-text color="#000000" /></mj-attributes></mj-head>'
    );
  });

  it("escapes special chars on write", () => {
    const head =
      '<mj-head><mj-attributes><mj-text color="#333" /></mj-attributes></mj-head>';
    const out = setMjAttribute(head, "mj-text", "color", '"<&>');
    expect(out).toContain('color="&quot;&lt;&amp;>"');
  });

  it("only edits the first matching element", () => {
    const head =
      '<mj-head><mj-attributes><mj-text color="#a" /><mj-text color="#b" /></mj-attributes></mj-head>';
    const out = setMjAttribute(head, "mj-text", "color", "#zz");
    expect(out).toBe(
      '<mj-head><mj-attributes><mj-text color="#zz" /><mj-text color="#b" /></mj-attributes></mj-head>'
    );
  });
});

describe("setMjAttribute — insert new attr on existing element", () => {
  it("inserts a new attr inside a self-closing element with a leading space", () => {
    const head =
      '<mj-head><mj-attributes><mj-text font-family="Arial" /></mj-attributes></mj-head>';
    const out = setMjAttribute(head, "mj-text", "color", "#000");
    expect(out).toBe(
      '<mj-head><mj-attributes><mj-text font-family="Arial" color="#000" /></mj-attributes></mj-head>'
    );
  });

  it("inserts a new attr inside a self-closing element with no original spacing", () => {
    const head = "<mj-head><mj-attributes><mj-text/></mj-attributes></mj-head>";
    const out = setMjAttribute(head, "mj-text", "color", "#000");
    expect(out).toBe(
      '<mj-head><mj-attributes><mj-text color="#000" /></mj-attributes></mj-head>'
    );
  });

  it("inserts a new attr inside a non-self-closing element", () => {
    const head =
      "<mj-head><mj-attributes><mj-text></mj-text></mj-attributes></mj-head>";
    const out = setMjAttribute(head, "mj-text", "color", "#000");
    expect(out).toBe(
      '<mj-head><mj-attributes><mj-text color="#000"></mj-text></mj-attributes></mj-head>'
    );
  });
});

describe("setMjAttribute — element missing", () => {
  it("creates a new element inside an existing mj-attributes block", () => {
    const head =
      '<mj-head><mj-attributes><mj-button color="#fff" /></mj-attributes></mj-head>';
    const out = setMjAttribute(head, "mj-text", "color", "#000");
    expect(out).toBe(
      '<mj-head><mj-attributes><mj-text color="#000" /><mj-button color="#fff" /></mj-attributes></mj-head>'
    );
  });
});

describe("setMjAttribute — mj-attributes missing", () => {
  it("creates an mj-attributes block immediately after the mj-head open tag", () => {
    const head = "<mj-head><mj-title>Hi</mj-title></mj-head>";
    const out = setMjAttribute(head, "mj-text", "color", "#000");
    expect(out).toBe(
      '<mj-head><mj-attributes><mj-text color="#000" /></mj-attributes><mj-title>Hi</mj-title></mj-head>'
    );
  });

  it("wraps a fresh head when the input has no <mj-head> tag at all", () => {
    const out = setMjAttribute("", "mj-text", "color", "#000");
    expect(out).toBe(
      '<mj-head><mj-attributes><mj-text color="#000" /></mj-attributes></mj-head>'
    );
  });

  it("creates an mj-attributes block when mj-head has whitespace and other children", () => {
    const head =
      "<mj-head>\n  <mj-title>Hi</mj-title>\n  <mj-preview>P</mj-preview>\n</mj-head>";
    const out = setMjAttribute(head, "a", "color", "#1f6feb");
    expect(out).toContain('<mj-attributes><a color="#1f6feb" /></mj-attributes>');
    expect(out).toContain("<mj-title>Hi</mj-title>");
    expect(out).toContain("<mj-preview>P</mj-preview>");
  });
});

describe("deleteMjAttribute", () => {
  it("removes the attr along with its preceding whitespace", () => {
    const head =
      '<mj-head><mj-attributes><mj-text color="#333" font-family="Arial" /></mj-attributes></mj-head>';
    const out = deleteMjAttribute(head, "mj-text", "color");
    expect(out).toBe(
      '<mj-head><mj-attributes><mj-text font-family="Arial" /></mj-attributes></mj-head>'
    );
  });

  it("leaves the element in place even if it becomes attribute-less", () => {
    const head =
      '<mj-head><mj-attributes><mj-text color="#333" /></mj-attributes></mj-head>';
    const out = deleteMjAttribute(head, "mj-text", "color");
    expect(out).toBe(
      "<mj-head><mj-attributes><mj-text /></mj-attributes></mj-head>"
    );
  });

  it("is a no-op when mj-attributes is missing", () => {
    const head = "<mj-head><mj-title>x</mj-title></mj-head>";
    expect(deleteMjAttribute(head, "mj-text", "color")).toBe(head);
  });

  it("is a no-op when the attr is missing", () => {
    const head =
      '<mj-head><mj-attributes><mj-text font-family="Arial" /></mj-attributes></mj-head>';
    expect(deleteMjAttribute(head, "mj-text", "color")).toBe(head);
  });
});

describe("getMjAttribute / setMjAttribute round-trip", () => {
  it("set then get returns the value across various element types", () => {
    let head = "<mj-head></mj-head>";
    head = setMjAttribute(head, "mj-all", "font-family", "Arial, sans-serif");
    head = setMjAttribute(head, "mj-text", "color", "#333333");
    head = setMjAttribute(head, "mj-text", "line-height", "1.5");
    head = setMjAttribute(head, "a", "color", "#1f6feb");

    expect(getMjAttribute(head, "mj-all", "font-family")).toBe(
      "Arial, sans-serif"
    );
    expect(getMjAttribute(head, "mj-text", "color")).toBe("#333333");
    expect(getMjAttribute(head, "mj-text", "line-height")).toBe("1.5");
    expect(getMjAttribute(head, "a", "color")).toBe("#1f6feb");
  });
});
