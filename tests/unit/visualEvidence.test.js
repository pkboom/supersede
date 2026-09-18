import { describe, expect, it } from "vitest";
import { visualEvidence } from "../../src/patternWorkflow.js";

function capture(overrides = {}) {
  return {
    beforeImage: "before.png",
    afterImage: "after.png",
    beforeDetailImages: ["b1.png"],
    afterDetailImages: ["a1.png"],
    expectedDetailImages: 1,
    ...overrides,
  };
}

describe("visualEvidence", () => {
  it("reports not_applicable without a pattern", () => {
    expect(visualEvidence(null, capture())).toEqual({ status: "not_applicable", comparisons: [] });
  });

  it("offers a seed without mutating the pattern", () => {
    const pattern = { id: "p" };
    const result = visualEvidence(pattern, capture());

    expect(result.status).toBe("seeded");
    expect(result.comparisons).toEqual([]);
    expect(result.seed).toEqual({ beforeTemplates: ["b1.png"], afterTemplates: ["a1.png"] });
    expect(pattern.visual).toBeUndefined();
  });

  it("refuses to seed when the changed regions were not fully captured", () => {
    const pattern = { id: "p" };
    const result = visualEvidence(pattern, capture({ beforeDetailImages: [], expectedDetailImages: 1 }));

    expect(result.status).toBe("unestablished");
    expect(result.reason).toBe("no_changed_region_capture");
    expect(result.seed).toBeUndefined();
  });

  it("refuses to seed more changed regions than it will compare", () => {
    const pattern = { id: "p" };
    const many = Array.from({ length: 17 }, (_, index) => `d${index}.png`);
    const result = visualEvidence(pattern, capture({
      beforeDetailImages: many,
      afterDetailImages: many,
      expectedDetailImages: 17,
    }));

    expect(result.status).toBe("unestablished");
    expect(result.seed).toBeUndefined();
  });

  it("refuses a later file whose changed regions were not fully captured", () => {
    const pattern = { id: "p", visual: { beforeTemplates: ["b1.png"], afterTemplates: ["a1.png"] } };
    const result = visualEvidence(pattern, capture({ afterDetailImages: [], expectedDetailImages: 1 }));

    expect(result.status).toBe("unestablished");
    expect(result.reason).toBe("incomplete_changed_region_capture");
  });
});
