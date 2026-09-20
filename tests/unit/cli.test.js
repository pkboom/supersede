import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli.js";
import { readJob, remainingJob } from "../../src/job.js";
import { buildElementAnnotatedView } from "../../src/html.js";
import { readProgress } from "../../src/pipeline/progress.js";

const INSTRUCTION = `find the address in the footer and replace it with "New Street, New York"`;
const FIND = "the address in the footer";
const REPLACEMENT = "New Street, New York";
const OLD = `Old Street &bull; Springfield`;
const VARIANT = `Old Road &bull; Shelbyville`;
const FOOTER = `<td id="Footer">`;
const SHORT_FOOTER = `<td id="Foot">`;

let root;

function email(body) {
  return `<html><body><table><tr><td id="Footer">\n  ${body}\n</td></tr></table></body></html>`;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "job-"));
  writeFileSync(join(root, "a.html"), email(`${OLD} one`));
  writeFileSync(join(root, "b.html"), email(`${OLD} two`));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function read(file) {
  return readFileSync(join(root, file), "utf8");
}

function stillToCheck(progress = readProgress(root), sweep) {
  return remainingJob(readJob(root), progress, sweep).files.map((file) => file.id);
}

function footerId(source) {
  return [...buildElementAnnotatedView(source).elements.values()]
    .find((element) => element.html.startsWith(`<td id="Footer"`))
    .id;
}

function luna({ from = OLD, to = REPLACEMENT, seen = [], find = FIND, replacement = REPLACEMENT } = {}) {
  return async ({ schema, prompt }) => {
    const statuses = schema.properties.status.enum;
    if (statuses.includes("resolved")) throw new Error("The loop must not call the requested-item resolver.");
    if (statuses.includes("split")) {
      seen.push({ phase: "split", prompt });
      return { status: "split", find, replacement, reason: "x" };
    }
    if (statuses.includes("found")) {
      seen.push({ phase: "find", prompt });
      return { status: "found", elementId: footerId(read("a.html")), reason: "x" };
    }
    seen.push({ phase: "narrow", prompt });
    return { status: "narrowed", interpretation: "value", from, to, reason: "x" };
  };
}

function asking({ instructions, looksRight = [true], again = [false], nextStep = ["stop"] }) {
  const queue = {
    instructions: [...instructions],
    looksRight: [...looksRight],
    again: [...again],
    nextStep: [...nextStep],
  };
  return {
    workspace: vi.fn(async () => root),
    instruction: vi.fn(async () => queue.instructions.shift()),
    looksRight: vi.fn(async () => queue.looksRight.shift()),
    again: vi.fn(async () => queue.again.shift()),
    nextStep: vi.fn(async () => queue.nextStep.shift()),
  };
}

function onePass(overrides = {}) {
  return asking({ instructions: [INSTRUCTION], ...overrides });
}

describe("interactive flow", () => {
  it("reads the job and skips the changes folder", () => {
    mkdirSync(join(root, "changes"));
    writeFileSync(join(root, "changes", "ignored.html"), "<p>x</p>");
    const job = readJob(root);

    expect(job.files.map((file) => file.id)).toEqual(["a.html", "b.html"]);
  });

  it("asks the human for one request and nothing else", async () => {
    const ask = onePass();
    await main([root], ask, { runLuna: luna() });

    expect(ask.instruction).toHaveBeenCalledTimes(1);
    expect(ask.find).toBeUndefined();
    expect(ask.replacement).toBeUndefined();
  });

  it("splits the request, then sends each phase where it belongs", async () => {
    const seen = [];
    await main([root], onePass(), { runLuna: luna({ seen }) });

    expect(seen.map((call) => call.phase)).toEqual(["split", "find", "narrow"]);
    expect(seen[0].prompt).toContain(`Request: ${INSTRUCTION}`);
    expect(seen[1].prompt).toContain(`User request: ${FIND}`);
    expect(seen[1].prompt).not.toContain(REPLACEMENT);
    expect(seen[2].prompt).toContain(`Target: ${FIND}\nRequested change: ${REPLACEMENT}`);
  });

  it("splits the request before showing the element to review", async () => {
    const order = [];
    const seen = [];
    const ask = onePass({ looksRight: [false] });
    for (const name of ["instruction", "looksRight"]) {
      const original = ask[name];
      ask[name] = vi.fn(async () => {
        order.push(name);
        return original();
      });
    }
    await main([root], ask, { runLuna: luna({ seen }) });

    expect(order).toEqual(["instruction", "looksRight"]);
    expect(seen.map((call) => call.phase)).toEqual(["split", "find"]);
  });

  it("asks again instead of ending the session when the split fails", async () => {
    const ask = asking({ instructions: ["make it nicer", INSTRUCTION], again: [true, false] });
    const calls = [];
    const runLuna = async (call) => {
      const statuses = call.schema.properties.status.enum;
      if (statuses.includes("split")) {
        calls.push("split");
        return calls.length === 1
          ? { status: "unclear", find: "", replacement: "", reason: "No new value given." }
          : { status: "split", find: FIND, replacement: REPLACEMENT, reason: "x" };
      }
      return luna()(call);
    };

    const result = await main([root], ask, { runLuna });

    expect(result.stopped).toBe(false);
    expect(ask.instruction).toHaveBeenCalledTimes(2);
    expect(readProgress(root).changes).toHaveLength(1);
  });

  it("asks again when Luna cannot find the element", async () => {
    const ask = asking({ instructions: [INSTRUCTION, INSTRUCTION], looksRight: [true], again: [true, false] });
    let found = 0;
    const runLuna = async (call) => {
      if (call.schema.properties.status.enum.includes("found")) {
        found += 1;
        if (found === 1) return { status: "not_found", elementId: "", reason: "no footer in this email" };
      }
      return luna()(call);
    };

    const result = await main([root], ask, { runLuna });

    expect(result.stopped).toBe(false);
    expect(ask.instruction).toHaveBeenCalledTimes(2);
    expect(readProgress(root).changes).toHaveLength(1);
  });

  it("asks again when Luna cannot narrow the change", async () => {
    const ask = asking({ instructions: [INSTRUCTION, INSTRUCTION], looksRight: [true, true], again: [true, false] });
    let narrows = 0;
    const runLuna = async (call) => {
      if (call.schema.properties.status.enum.includes("narrowed")) {
        narrows += 1;
        if (narrows === 1) {
          return { status: "not_applicable", interpretation: "value", from: "", to: "", reason: "the element holds no address" };
        }
      }
      return luna()(call);
    };

    const result = await main([root], ask, { runLuna });

    expect(result.stopped).toBe(false);
    expect(ask.instruction).toHaveBeenCalledTimes(2);
    expect(readProgress(root).changes).toHaveLength(1);
  });

  it("writes nothing and does not reach the review gate when a split fails", async () => {
    const ask = asking({ instructions: ["make it nicer"], again: [false] });
    const runLuna = async () => ({ status: "unclear", find: "", replacement: "", reason: "No new value given." });

    await main([root], ask, { runLuna });

    expect(ask.looksRight).not.toHaveBeenCalled();
    expect(readdirSync(root).sort()).toEqual(["a.html", "b.html"]);
  });

  it("asks nothing before the first request of a fresh job", async () => {
    const ask = onePass();

    await main([root], ask, { runLuna: luna() });

    expect(ask.nextStep).not.toHaveBeenCalled();
    expect(ask.again).toHaveBeenCalledTimes(1);
  });

  it("lets a cancelled prompt end the run", async () => {
    const ask = onePass();
    ask.looksRight = vi.fn(async () => {
      const error = new Error("User force closed the prompt with SIGINT");
      error.name = "ExitPromptError";
      throw error;
    });

    await expect(main([root], ask, { runLuna: luna() })).rejects.toThrow("SIGINT");
    expect(ask.again).not.toHaveBeenCalled();
  });

  it("lets a programming error out instead of offering another change", async () => {
    const ask = onePass();
    const runLuna = async () => {
      throw new TypeError("Cannot read properties of undefined");
    };

    await expect(main([root], ask, { runLuna })).rejects.toThrow(TypeError);
    expect(ask.again).not.toHaveBeenCalled();
  });

  it("stops without writing when the human rejects the element", async () => {
    const ask = onePass({ looksRight: [false] });
    const result = await main([root], ask, { runLuna: luna() });

    expect(result.stopped).toBe(true);
    expect(readdirSync(root).sort()).toEqual(["a.html", "b.html"]);
    expect(ask.again).not.toHaveBeenCalled();
  });

  it("records both phases, the files covered, and a runnable script", async () => {
    await main([root], onePass(), { runLuna: luna() });

    const progress = readProgress(root);
    expect(progress.changes).toHaveLength(1);
    expect(progress.changes[0].files).toEqual(["a.html", "b.html"]);

    const change = progress.changes[0];
    expect(change.instruction).toBe(INSTRUCTION);
    expect(change.find).toBe(FIND);
    expect(change.replacement).toBe(REPLACEMENT);
    expect(change.from).toBe(OLD);
    expect(change.determinism).toBe("deterministic");

    const log = read("log.md");
    expect(log).toContain(`- asked: ${INSTRUCTION}`);
    expect(log).toContain(`- find: ${FIND}`);
    expect(log).toContain(`- replace with: ${REPLACEMENT}`);
  });

  it("runs the generated script on the email files", async () => {
    await main([root], onePass(), { runLuna: luna() });

    expect(readProgress(root).changes[0].applied).toBe(true);
    expect(read("a.html")).toContain(REPLACEMENT);
    expect(read("b.html")).toContain(REPLACEMENT);
  });

  it("records the change as unapplied when the script refuses", async () => {
    const run = () => {
      const error = new Error("exited 1");
      error.stdout = "  a.html: refusing, matched 0 times\n";
      throw error;
    };
    await main([root], onePass(), { runLuna: luna(), run });

    expect(readProgress(root).changes[0].applied).toBe(false);
    expect(read("log.md")).toContain("refused, files unchanged");
    expect(read("a.html")).toContain(OLD);
  });

  it("refuses a file the span does not match exactly once", async () => {
    await main([root], onePass(), { runLuna: luna() });
    const change = readProgress(root).changes[0];
    writeFileSync(join(root, "a.html"), email(`${OLD} one ${OLD} again`));

    expect(() => execFileSync(process.execPath, [join(root, change.script)], { stdio: "pipe" })).toThrow();
    expect(read("a.html")).not.toContain(REPLACEMENT);
  });

  it("records nothing when the span sits twice in a file still to check", async () => {
    writeFileSync(join(root, "b.html"), email(`${OLD} two ${OLD} twice`));
    await main([root], onePass(), { runLuna: luna() });

    expect(readProgress(root).changes).toEqual([]);
    expect(readdirSync(root)).not.toContain("changes");
    expect(read("a.html")).toContain(OLD);
  });

  it("narrows the next change against the files as the script left them", async () => {
    const seen = [];
    const replacements = [REPLACEMENT, "Third Street, Boston"];
    const ask = asking({
      instructions: [INSTRUCTION, `find the address in the footer and replace it with "Third Street, Boston"`],
      looksRight: [true, true],
      again: [true, false],
    });
    await main([root], ask, {
      runLuna: async (call) => {
        const statuses = call.schema.properties.status.enum;
        if (statuses.includes("split")) {
          return { status: "split", find: FIND, replacement: replacements.shift(), reason: "x" };
        }
        if (statuses.includes("found")) {
          return { status: "found", elementId: footerId(read("a.html")), reason: "x" };
        }
        seen.push(call);
        return seen.length === 1
          ? { status: "narrowed", interpretation: "value", from: OLD, to: REPLACEMENT, reason: "x" }
          : { status: "narrowed", interpretation: "value", from: REPLACEMENT, to: "Third Street, Boston", reason: "x" };
      },
    });

    const progress = readProgress(root);
    expect(progress.changes).toHaveLength(2);
    expect(progress.changes[1].determinism).toBe("deterministic");
    expect(read("a.html")).toContain("Third Street, Boston");
    expect(read("b.html")).toContain("Third Street, Boston");
  });

  it("reads back what an earlier run recorded", async () => {
    await main([root], onePass(), { runLuna: luna() });
    const resumed = readProgress(root);

    expect(resumed.changes).toHaveLength(1);
    expect(resumed.changes[0].files).toEqual(["a.html", "b.html"]);
  });

  it("ignores coverage recorded before sweeps existed", async () => {
    writeFileSync(join(root, "progress.json"), JSON.stringify({ version: 1, changes: [{ files: ["a.html"] }] }));

    await main([root], onePass(), { runLuna: luna() });

    expect(readProgress(root).changes[1].files).toEqual(["a.html", "b.html"]);
    expect(read("a.html")).toContain(REPLACEMENT);
  });
});

describe("a sweep the first pass does not finish", () => {
  beforeEach(() => {
    writeFileSync(join(root, "c.html"), email(`${VARIANT} three`));
  });

  function variationLuna({ seen = [], spans = [[OLD, REPLACEMENT], [VARIANT, REPLACEMENT]] } = {}) {
    let narrows = 0;
    return async ({ schema, prompt }) => {
      const statuses = schema.properties.status.enum;
      if (statuses.includes("split")) {
        return { status: "split", find: FIND, replacement: REPLACEMENT, reason: "x" };
      }
      if (statuses.includes("found")) {
        seen.push(prompt);
        const file = prompt.includes("Shelbyville") ? "c.html" : "a.html";
        return { status: "found", elementId: footerId(read(file)), reason: "x" };
      }
      const [from, to] = spans[narrows];
      narrows += 1;
      return { status: "narrowed", interpretation: "value", from, to, reason: "x" };
    };
  }

  function leaveVariation() {
    return main([root], asking({ instructions: [INSTRUCTION], nextStep: ["stop"] }), {
      runLuna: variationLuna(),
    });
  }

  function carriesOn(overrides = {}) {
    return asking({
      instructions: [INSTRUCTION, INSTRUCTION],
      looksRight: [true, true],
      nextStep: ["variations"],
      again: [false],
      ...overrides,
    });
  }

  it("applies the change to the files it matches and leaves the variation pending", async () => {
    const ask = asking({ instructions: [INSTRUCTION], nextStep: ["stop"] });

    const result = await main([root], ask, { runLuna: variationLuna() });

    expect(result.stopped).toBe(false);
    const change = readProgress(root).changes[0];
    expect(change.determinism).toBe("partial");
    expect(change.files).toEqual(["a.html", "b.html"]);
    expect(read("a.html")).toContain(REPLACEMENT);
    expect(read("c.html")).toContain(VARIANT);
    expect(stillToCheck()).toEqual(["c.html"]);
  });

  it("asks what to do about the files left instead of asking for another change", async () => {
    const ask = asking({ instructions: [INSTRUCTION], nextStep: ["stop"] });

    await main([root], ask, { runLuna: variationLuna() });

    expect(ask.nextStep).toHaveBeenCalledTimes(1);
    expect(ask.again).not.toHaveBeenCalled();
  });

  it("opens a new sweep when the human gives up on the files left", async () => {
    const ask = asking({
      instructions: [INSTRUCTION, INSTRUCTION],
      looksRight: [true, true],
      nextStep: ["sweep"],
      again: [false],
    });
    const runLuna = variationLuna({ spans: [[OLD, REPLACEMENT], [FOOTER, SHORT_FOOTER]] });

    await main([root], ask, { runLuna });

    const progress = readProgress(root);
    expect(progress.changes.map((change) => change.sweep)).toEqual([1, 2]);
    expect(progress.changes[1].files).toEqual(["a.html", "b.html", "c.html"]);
  });

  it("leaves a file an earlier pass updated alone, even when the next span still matches it", async () => {
    const ask = carriesOn();
    const runLuna = variationLuna({ spans: [[OLD, REPLACEMENT], [FOOTER, SHORT_FOOTER]] });

    await main([root], ask, { runLuna });

    expect(read("c.html")).toContain(SHORT_FOOTER);
    expect(read("a.html")).toContain(FOOTER);
    expect(readProgress(root).changes[1].files).toEqual(["c.html"]);
  });

  it("resumes an unfinished sweep on the next run", async () => {
    await leaveVariation();

    const seen = [];
    await main([root], asking({ instructions: [INSTRUCTION], nextStep: ["variations"], again: [false] }), {
      runLuna: variationLuna({ seen, spans: [[VARIANT, REPLACEMENT]] }),
    });

    const progress = readProgress(root);
    expect(progress.changes.map((change) => change.sweep)).toEqual([1, 1]);
    expect(progress.changes[1].files).toEqual(["c.html"]);
    expect(seen[0]).toContain("Shelbyville");
  });

  it("asks before scoping a resumed session to the files left", async () => {
    await leaveVariation();

    const ask = asking({ instructions: [INSTRUCTION], nextStep: ["sweep"], again: [false] });
    await main([root], ask, { runLuna: variationLuna({ spans: [[FOOTER, SHORT_FOOTER]] }) });

    expect(ask.nextStep).toHaveBeenCalledTimes(1);
    const progress = readProgress(root);
    expect(progress.changes.map((change) => change.sweep)).toEqual([1, 2]);
    expect(progress.changes[1].files).toEqual(["a.html", "b.html", "c.html"]);
  });

  it("leaves a resumed session alone when the human keeps the sweep", async () => {
    await leaveVariation();

    const ask = asking({ instructions: [INSTRUCTION], nextStep: ["variations"], again: [false] });
    await main([root], ask, { runLuna: variationLuna({ spans: [[VARIANT, REPLACEMENT]] }) });

    expect(readProgress(root).changes[1].files).toEqual(["c.html"]);
  });

  it("opens the next sweep on a run after a complete one", async () => {
    await main([root], carriesOn(), { runLuna: variationLuna() });

    await main([root], asking({ instructions: [INSTRUCTION], again: [false] }), {
      runLuna: variationLuna({ spans: [[FOOTER, SHORT_FOOTER]] }),
    });

    const progress = readProgress(root);
    expect(progress.changes.map((change) => change.sweep)).toEqual([1, 1, 2]);
    expect(progress.changes[2].files).toEqual(["a.html", "b.html", "c.html"]);
  });

  it("seeds the next pass from a file that is still to check", async () => {
    const seen = [];
    const ask = carriesOn();

    await main([root], ask, { runLuna: variationLuna({ seen }) });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("Springfield");
    expect(seen[1]).toContain("Shelbyville");
    expect(seen[1]).not.toContain("Springfield");
  });

  it("finishes the sweep on the second pass, under one sweep", async () => {
    const ask = carriesOn();

    await main([root], ask, { runLuna: variationLuna() });

    const progress = readProgress(root);
    expect(progress.changes.map((change) => change.sweep)).toEqual([1, 1]);
    expect(progress.changes[1].determinism).toBe("deterministic");
    expect(progress.changes[1].files).toEqual(["c.html"]);
    expect(stillToCheck(progress)).toEqual([]);
    for (const file of ["a.html", "b.html", "c.html"]) {
      expect(read(file)).toContain(REPLACEMENT);
    }
    expect(ask.again).toHaveBeenCalledTimes(1);
  });

  it("starts a new sweep when another change follows a complete one", async () => {
    const ask = carriesOn({
      instructions: [INSTRUCTION, INSTRUCTION, INSTRUCTION],
      looksRight: [true, true, true],
      again: [true, false],
    });
    const runLuna = variationLuna({ spans: [[OLD, REPLACEMENT], [VARIANT, REPLACEMENT], [FOOTER, SHORT_FOOTER]] });

    await main([root], ask, { runLuna });

    const progress = readProgress(root);
    expect(progress.changes.map((change) => change.sweep)).toEqual([1, 1, 2]);
    expect(progress.changes[2].files).toEqual(["a.html", "b.html", "c.html"]);
  });
});

describe("remainingJob", () => {
  it("lists every file before any change is recorded", () => {
    expect(stillToCheck({ changes: [] })).toEqual(["a.html", "b.html"]);
  });

  it("drops the files a recorded change covered", () => {
    const progress = { changes: [{ sweep: 1, files: ["a.html"] }] };

    expect(stillToCheck(progress)).toEqual(["b.html"]);
  });

  it("treats a change recorded before sweeps existed as covering nothing", () => {
    const progress = { changes: [{ files: ["a.html"] }] };

    expect(stillToCheck(progress)).toEqual(["a.html", "b.html"]);
  });

  it("is empty when every file is covered", async () => {
    await main([root], onePass(), { runLuna: luna() });

    expect(stillToCheck()).toEqual([]);
  });

  it("counts only the sweep in progress", () => {
    const progress = {
      changes: [
        { sweep: 1, files: ["a.html", "b.html"] },
        { sweep: 2, files: ["a.html"] },
      ],
    };

    expect(stillToCheck(progress)).toEqual(["b.html"]);
    expect(stillToCheck(progress, 1)).toEqual([]);
  });
});
