import { describe, expect, it, vi } from "vitest";
import { runPatternLoop } from "../../src/patternLoop.js";

describe("iterative pattern loop", () => {
  it("stops discovery as soon as the first two files establish a pattern", async () => {
    const compare = vi.fn(async (seed, candidate) => ({
      status: "pattern",
      pattern: { id: `${seed.id}+${candidate.id}` },
      seedMatch: { id: seed.id },
      candidateMatch: { id: candidate.id },
    }));
    const result = await runPatternLoop(
      [{ id: "one" }, { id: "two" }, { id: "three" }, { id: "four" }],
      {
        compare,
        match: async (_pattern, item) => ({ matched: true, match: { id: item.id } }),
        apply: async (_pattern, item) => ({ file: item.id }),
        validate: async () => ({ status: "pass" }),
        applySingle: async (item) => ({ file: item.id }),
      },
    );

    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0].slice(0, 2)).toEqual([{ id: "one" }, { id: "two" }]);
    expect(result.processed.map((entry) => entry.item.id)).toEqual(["one", "two", "three", "four"]);
    expect(result.patterns).toHaveLength(1);
  });

  it("keeps the first file fixed while trying the second, then the third", async () => {
    const compare = vi.fn(async (seed, candidate) =>
      candidate.id === "third"
        ? {
            status: "pattern",
            pattern: { id: "shared" },
            seedMatch: { id: seed.id },
            candidateMatch: { id: candidate.id },
          }
        : { status: "no_pattern" },
    );

    await runPatternLoop([{ id: "first" }, { id: "second" }, { id: "third" }], {
      compare,
      match: async (_pattern, item) => ({ matched: item.id !== "second", match: { id: item.id } }),
      apply: async (_pattern, item) => ({ file: item.id }),
      validate: async () => ({ status: "pass" }),
      applySingle: async (item) => ({ file: item.id }),
    });

    expect(compare.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [{ id: "first" }, { id: "second" }],
      [{ id: "first" }, { id: "third" }],
    ]);
  });

  it("returns a failed validation to the loop and requires review when no new partner exists", async () => {
    const validationAttempts = new Map();
    const result = await runPatternLoop([{ id: "first" }, { id: "second" }, { id: "third" }], {
      compare: async (seed, candidate) => ({
        status: "pattern",
        pattern: { id: `${seed.id}+${candidate.id}` },
        seedMatch: { id: seed.id },
        candidateMatch: { id: candidate.id },
      }),
      match: async (_pattern, item) => ({ matched: true, match: { id: item.id } }),
      apply: async (_pattern, item) => ({ file: item.id }),
      validate: async (item) => {
        const attempts = (validationAttempts.get(item.id) ?? 0) + 1;
        validationAttempts.set(item.id, attempts);
        return item.id === "third" && attempts === 1 ? { status: "fail" } : { status: "pass" };
      },
      applySingle: async (item) => ({ file: item.id, single: true }),
    });

    expect(validationAttempts.get("third")).toBe(1);
    expect(result.processed.map((entry) => entry.item.id).sort()).toEqual(["first", "second"]);
    expect(result.reviews.map((entry) => entry.item.id)).toEqual(["third"]);
    expect(result.events.some((event) => event.type === "validation_failed" && event.file === "third")).toBe(true);
  });
});
