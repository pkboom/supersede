import { describe, expect, it } from "vitest";
import { buildAnnotatedView, materializeEdits } from "../../src/htmlTargets.js";
import { contextIncludesPart, findSharedPatternWithLuna, matchPattern } from "../../src/patternAgent.js";

function target(view, predicate) {
  return [...view.targets.values()].find(predicate);
}

describe("pair pattern extraction", () => {
  it("compiles one shared text pattern and replays it on later files", async () => {
    const seed = { id: "one.html", source: `<footer><p>Old postal address</p></footer>` };
    const candidate = { id: "two.html", source: `<footer>\n<p>Old postal address</p>\n</footer>` };
    const seedView = buildAnnotatedView(seed.source);
    const candidateView = buildAnnotatedView(candidate.source);
    const seedTarget = target(seedView, (entry) => entry.source === "Old postal address");
    const candidateTarget = target(candidateView, (entry) => entry.source === "Old postal address");

    const result = await findSharedPatternWithLuna(seed, candidate, "Update the postal address", {
      seedExtraction: {
        status: "proposed",
        edits: materializeEdits(seed.source, [
          { targetId: seedTarget.id, replacement: "New postal address", reason: "Requested address update" },
        ], seedView),
      },
      runLuna: async () => ({
        status: "pattern",
        rules: [
          {
            role: "postal-address",
            seedTargetId: seedTarget.id,
            candidateTargetId: candidateTarget.id,
            replacement: "New postal address",
            reason: "Requested address update",
            match: {
              kind: "text",
              tagName: "p",
              attributeName: "",
              sourceEquals: "Old postal address",
              contextIncludes: ["footer > p"],
            },
          },
        ],
        warnings: [],
      }),
    });

    expect(result.status).toBe("pattern");
    const later = { id: "later.html", source: `<footer><p>Old postal address</p></footer>` };
    expect(matchPattern(result.pattern, later).matched).toBe(true);
  });

  it("uses stable visible button context without merging different tracking links", async () => {
    const seed = {
      id: "one.html",
      source: `<a class="buttonstyles" href="https://track/one">START EARNING TOGETHER</a><a class="buttonstyles" href="https://track/other">ADD CARD</a>`,
    };
    const candidate = {
      id: "two.html",
      source: `<a class="buttonstyles" href="https://track/two">START EARNING TOGETHER</a><a class="buttonstyles" href="https://track/other-2">ADD CARD</a>`,
    };
    const seedView = buildAnnotatedView(seed.source);
    const candidateView = buildAnnotatedView(candidate.source);
    const seedTarget = target(
      seedView,
      (entry) => entry.attributeName === "href" && entry.context.includes("START EARNING TOGETHER"),
    );
    const candidateTarget = target(
      candidateView,
      (entry) => entry.attributeName === "href" && entry.context.includes("START EARNING TOGETHER"),
    );

    const result = await findSharedPatternWithLuna(seed, candidate, "Change the START button URL", {
      seedExtraction: {
        status: "proposed",
        edits: materializeEdits(seed.source, [
          { targetId: seedTarget.id, replacement: "https://example.test/start", reason: "Requested URL" },
        ], seedView),
      },
      runLuna: async () => ({
        status: "pattern",
        rules: [
          {
            role: "start-button-link",
            seedTargetId: seedTarget.id,
            candidateTargetId: candidateTarget.id,
            replacement: "https://example.test/start",
            reason: "Requested START button destination",
            match: {
              kind: "attribute",
              tagName: "a",
              attributeName: "href",
              sourceEquals: null,
              contextIncludes: ["a.buttonstyles", "START EARNING TOGETHER"],
            },
          },
        ],
        warnings: [],
      }),
    });

    expect(result.status).toBe("pattern");
    const match = matchPattern(result.pattern, candidate);
    expect(match.matched).toBe(true);
    expect(match.match.edits).toHaveLength(1);
    expect(match.match.edits[0].before).toBe("https://track/two");
  });

  it("rejects a pair response that abandons the approved seed target", async () => {
    const seed = { id: "one.html", source: `<p>Old address</p><p>DO NOT CHANGE</p>` };
    const candidate = { id: "two.html", source: `<p>Old address</p><p>DO NOT CHANGE</p>` };
    const seedView = buildAnnotatedView(seed.source);
    const candidateView = buildAnnotatedView(candidate.source);
    const address = target(seedView, (entry) => entry.source === "Old address");
    const wrongSeed = target(seedView, (entry) => entry.source === "DO NOT CHANGE");
    const wrongCandidate = target(candidateView, (entry) => entry.source === "DO NOT CHANGE");

    await expect(findSharedPatternWithLuna(seed, candidate, "Update address", {
      attempts: 1,
      seedExtraction: {
        status: "proposed",
        edits: materializeEdits(seed.source, [
          { targetId: address.id, replacement: "New address", reason: "Requested" },
        ], seedView),
      },
      runLuna: async () => ({
        status: "pattern",
        rules: [
          {
            role: "unrelated",
            seedTargetId: wrongSeed.id,
            candidateTargetId: wrongCandidate.id,
            replacement: "CORRUPTED",
            reason: "Wrong",
            match: {
              kind: "text",
              tagName: "p",
              attributeName: "",
              sourceEquals: "DO NOT CHANGE",
              contextIncludes: [],
            },
          },
        ],
        warnings: [],
      }),
    })).rejects.toThrow(/approved seed edit/i);
  });

  it("refuses a context fragment that is only a substring of another element's text", () => {
    const pattern = {
      id: "p",
      rules: [
        {
          role: "cta",
          replacement: "https://new.test/shop",
          reason: "r",
          match: {
            kind: "attribute",
            tagName: "a",
            attributeName: "href",
            sourceEquals: null,
            contextIncludes: ["a.btn", "SHOP NOW"],
          },
        },
      ],
    };
    const later = {
      id: "later.html",
      source: `<a class="btn" href="https://affiliate/partner-tracking">SHOP NOW AT OUR PARTNER STORE</a>`,
    };

    expect(matchPattern(pattern, later).matched).toBe(false);
  });

  it("still matches an exact visible label and an ancestor chain", () => {
    const source = `<a class="btn" href="https://track/one">SHOP NOW</a>`;
    expect(contextIncludesPart(`html > body > a.btn text="SHOP NOW"`, "SHOP NOW")).toBe(true);
    expect(contextIncludesPart(`html > body > a.btn text="SHOP NOW"`, `text="SHOP NOW"`)).toBe(true);
    expect(contextIncludesPart(`html > body > a.btn text="SHOP NOW"`, "body > a.btn")).toBe(true);
    expect(contextIncludesPart(`html > body > a.btn text="SHOP NOW"`, "a.other")).toBe(false);
    expect(source).toContain("SHOP NOW");
  });
});
