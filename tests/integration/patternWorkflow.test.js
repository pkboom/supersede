import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchPattern } from "../../src/patternAgent.js";
import { runEmailPatternWorkflow } from "../../src/patternWorkflow.js";

let root;
let input;
let output;
let artifacts;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pattern-workflow-"));
  input = join(root, "input");
  output = join(root, "output");
  artifacts = join(root, "artifacts");
  mkdirSync(input);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(file, html) {
  writeFileSync(join(input, file), html);
}

function addressPattern(seed, partner) {
  const pattern = {
    id: "address-pattern",
    seedFile: seed.id,
    partnerFile: partner.id,
    rules: [
      {
        role: "address",
        replacement: "New address",
        reason: "Requested",
        match: {
          kind: "text",
          tagName: "p",
          attributeName: "",
          sourceEquals: "Old address",
          contextIncludes: ["p"],
        },
      },
    ],
  };
  return {
    status: "pattern",
    pattern,
    seedMatch: matchPattern(pattern, seed).match,
    candidateMatch: matchPattern(pattern, partner).match,
  };
}

const validationOptions = {
  capture: async (_before, _after, files) =>
    files.map((file) => ({ file, beforeImage: "before.png", afterImage: "after.png" })),
  visualEvidence: () => ({ status: "pass", comparisons: [] }),
  visualValidator: async ({ file }) => ({ file, status: "pass", summary: "ok", concerns: [] }),
};

describe("email pattern workflow", () => {
  it("discovers one pattern from the first two files and applies it to 100 files", async () => {
    for (let index = 0; index < 100; index += 1) {
      write(`mail-${String(index).padStart(3, "0")}.html`, `<p>Old address</p>`);
    }
    const compare = vi.fn(async (seed, partner) => addressPattern(seed, partner));

    const report = await runEmailPatternWorkflow(input, output, "Update address", artifacts, {
      ...validationOptions,
      compare,
    });

    expect(compare).toHaveBeenCalledTimes(1);
    expect(report.status).toBe("pass");
    expect(report.processed).toHaveLength(100);
    expect(readFileSync(join(output, "mail-099.html"), "utf8")).toBe(`<p>New address</p>`);
  });

  it("compares first with third when first and second do not share a pattern", async () => {
    write("01-one.html", `<p>Old address</p>`);
    write("02-two.html", `<div>Unique</div>`);
    write("03-three.html", `<p>Old address</p>`);
    const compare = vi.fn(async (seed, partner) =>
      partner.id === "03-three.html" ? addressPattern(seed, partner) : { status: "no_pattern" },
    );

    const report = await runEmailPatternWorkflow(input, output, "Update address", artifacts, {
      ...validationOptions,
      compare,
      extractSingle: async () => ({ status: "no_change", edits: [], warnings: [] }),
    });

    expect(compare.mock.calls.map(([seed, partner]) => [seed.id, partner.id])).toEqual([
      ["01-one.html", "02-two.html"],
      ["01-one.html", "03-three.html"],
    ]);
    expect(report.status).toBe("pass");
    expect(readFileSync(join(output, "01-one.html"), "utf8")).toContain("New address");
    expect(readFileSync(join(output, "03-three.html"), "utf8")).toContain("New address");
  });

  it("still captures and validates a singleton that needs no edit", async () => {
    write("only.html", `<p>New address</p>`);
    const capture = vi.fn(validationOptions.capture);
    const visualValidator = vi.fn(validationOptions.visualValidator);

    const report = await runEmailPatternWorkflow(input, output, "Update address", artifacts, {
      ...validationOptions,
      capture,
      visualValidator,
      extractSingle: async () => ({ status: "no_change", edits: [], warnings: [] }),
    });

    expect(report.status).toBe("pass");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(visualValidator).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(output, "only.html"), "utf8")).toBe(`<p>New address</p>`);
  });

  it("keeps an unpaired proposed edit in review and publishes no output", async () => {
    write("only.html", `<p>Old address</p>`);
    const capture = vi.fn(validationOptions.capture);

    const report = await runEmailPatternWorkflow(input, output, "Update address", artifacts, {
      ...validationOptions,
      capture,
      extractSingle: async () => ({
        status: "proposed",
        edits: [{ targetId: "unused", replacement: "New address", reason: "Requested" }],
        warnings: [],
      }),
    });

    expect(report.status).toBe("review");
    expect(capture).not.toHaveBeenCalled();
    expect(() => readFileSync(join(output, "only.html"), "utf8")).toThrow();
  });

  function recordedValidations() {
    return readFileSync(join(artifacts, "evidence.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.type === "validation");
  }

  async function runFailingVariant(overrides) {
    write("01-one.html", `<p>Old address</p>`);
    write("02-two.html", `<p>Old address</p>`);
    return runEmailPatternWorkflow(input, output, "Update address", artifacts, {
      ...validationOptions,
      compare: async (seed, partner) => addressPattern(seed, partner),
      ...overrides,
    });
  }

  it("does not seed OpenCV templates from a render that failed validation", async () => {
    write("01-one.html", `<p>Old address</p>`);
    write("02-two.html", `<p>Old address</p>`);

    const report = await runEmailPatternWorkflow(input, output, "Update address", artifacts, {
      compare: async (seed, partner) => addressPattern(seed, partner),
      capture: async (_before, _after, files) =>
        files.map((file) => ({
          file,
          beforeImage: "before.png",
          afterImage: "after.png",
          beforeDetailImages: [`${file}-before.png`],
          afterDetailImages: [`${file}-after.png`],
          expectedDetailImages: 1,
        })),
      visualValidator: async ({ file }) => ({
        file,
        status: file === "01-one.html" ? "fail" : "pass",
        summary: "stub",
        concerns: [],
      }),
    });

    const recorded = recordedValidations();
    const first = recorded.find((entry) => entry.file === "01-one.html");
    const second = recorded.find((entry) => entry.file === "02-two.html");

    expect(first.status).toBe("fail");
    expect(first.openCv.status).toBe("seeded");
    expect(second.openCv.status).toBe("seeded");
    expect(report.status).toBe("review");
  });

  it("cannot pass on a Luna pass when OpenCV reports the changed region absent", async () => {
    const report = await runFailingVariant({
      visualEvidence: () => ({
        status: "fail",
        comparisons: [{ side: "after", template: "after.png", status: "absent", score: 0.12, threshold: 0.88 }],
      }),
    });

    const recorded = recordedValidations();
    expect(recorded).toHaveLength(2);
    expect(recorded.every((entry) => entry.luna.status === "pass")).toBe(true);
    expect(recorded.every((entry) => entry.status === "fail")).toBe(true);
    expect(report.status).toBe("review");
    expect(report.processed).toHaveLength(0);
    expect(() => readFileSync(join(output, "01-one.html"), "utf8")).toThrow();
  });

  it("cannot pass on a Luna pass when OpenCV containment is unestablished", async () => {
    const report = await runFailingVariant({
      visualEvidence: () => ({ status: "unestablished", comparisons: [], reason: "no_changed_region_capture" }),
    });

    const recorded = recordedValidations();
    expect(recorded).toHaveLength(2);
    expect(recorded.every((entry) => entry.luna.status === "pass")).toBe(true);
    expect(recorded.every((entry) => entry.status === "review")).toBe(true);
    expect(report.status).toBe("review");
    expect(report.processed).toHaveLength(0);
    expect(() => readFileSync(join(output, "01-one.html"), "utf8")).toThrow();
  });

  it("cannot pass on clean OpenCV evidence when Luna reports a visual failure", async () => {
    const report = await runFailingVariant({
      visualValidator: async ({ file }) => ({
        file,
        status: "fail",
        summary: "The button colour did not change.",
        concerns: ["unchanged region"],
      }),
    });

    const recorded = recordedValidations();
    expect(recorded).toHaveLength(2);
    expect(recorded.every((entry) => entry.openCv.status === "pass")).toBe(true);
    expect(recorded.every((entry) => entry.status === "fail")).toBe(true);
    expect(report.status).toBe("review");
    expect(report.processed).toHaveLength(0);
    expect(() => readFileSync(join(output, "01-one.html"), "utf8")).toThrow();
  });
});
