import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli.js";
import { readJob, remainingFiles } from "../../src/job.js";
import { buildElementAnnotatedView } from "../../src/html.js";
import { processedFiles, readProgress } from "../../src/pipeline/progress.js";

const INSTRUCTION = `find the address in the footer and replace it with "New Street, New York"`;
const FIND = "the address in the footer";
const REPLACEMENT = "New Street, New York";
const OLD = `Old Street &bull; Springfield`;

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
      return { status: "found", elementId: footerId(readFileSync(join(root, "a.html"), "utf8")), reason: "x" };
    }
    seen.push({ phase: "narrow", prompt });
    return { status: "narrowed", interpretation: "value", from, to, reason: "x" };
  };
}

function asking({ instructions, looksRight = [true], again = [false] }) {
  const queue = {
    instructions: [...instructions],
    looksRight: [...looksRight],
    again: [...again],
  };
  return {
    workspace: vi.fn(async () => root),
    instruction: vi.fn(async () => queue.instructions.shift()),
    looksRight: vi.fn(async () => queue.looksRight.shift()),
    again: vi.fn(async () => queue.again.shift()),
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

  it("writes nothing and does not reach the review gate when a split fails", async () => {
    const ask = asking({ instructions: ["make it nicer"], again: [false] });
    const runLuna = async () => ({ status: "unclear", find: "", replacement: "", reason: "No new value given." });

    await main([root], ask, { runLuna });

    expect(ask.looksRight).not.toHaveBeenCalled();
    expect(readdirSync(root).sort()).toEqual(["a.html", "b.html"]);
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
    expect(processedFiles(progress)).toEqual(["a.html", "b.html"]);

    const change = progress.changes[0];
    expect(change.instruction).toBe(INSTRUCTION);
    expect(change.find).toBe(FIND);
    expect(change.replacement).toBe(REPLACEMENT);
    expect(change.from).toBe(OLD);
    expect(change.determinism).toBe("deterministic");

    const log = readFileSync(join(root, "log.md"), "utf8");
    expect(log).toContain(`- asked: ${INSTRUCTION}`);
    expect(log).toContain(`- find: ${FIND}`);
    expect(log).toContain(`- replace with: ${REPLACEMENT}`);
  });

  it("runs the generated script on the email files", async () => {
    await main([root], onePass(), { runLuna: luna() });

    expect(readProgress(root).changes[0].applied).toBe(true);
    expect(readFileSync(join(root, "a.html"), "utf8")).toContain(REPLACEMENT);
    expect(readFileSync(join(root, "b.html"), "utf8")).toContain(REPLACEMENT);
  });

  it("records the change as unapplied when the script refuses", async () => {
    const run = () => {
      const error = new Error("exited 1");
      error.stdout = "  a.html: refusing, matched 0 times\n";
      throw error;
    };
    await main([root], onePass(), { runLuna: luna(), run });

    expect(readProgress(root).changes[0].applied).toBe(false);
    expect(readFileSync(join(root, "log.md"), "utf8")).toContain("refused, files unchanged");
    expect(readFileSync(join(root, "a.html"), "utf8")).toContain(OLD);
  });

  it("refuses a file the span does not match exactly once", async () => {
    await main([root], onePass(), { runLuna: luna() });
    const change = readProgress(root).changes[0];
    writeFileSync(join(root, "a.html"), email(`${OLD} one ${OLD} again`));

    expect(() => execFileSync(process.execPath, [join(root, change.script)], { stdio: "pipe" })).toThrow();
    expect(readFileSync(join(root, "a.html"), "utf8")).not.toContain(REPLACEMENT);
  });

  it("records nothing when the change is not unique in every file", async () => {
    writeFileSync(join(root, "b.html"), email(`${OLD} two ${OLD} twice`));
    await main([root], onePass(), { runLuna: luna() });

    expect(readProgress(root).changes).toEqual([]);
    expect(readdirSync(root)).not.toContain("changes");
    expect(readFileSync(join(root, "a.html"), "utf8")).toContain(OLD);
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
          return { status: "found", elementId: footerId(readFileSync(join(root, "a.html"), "utf8")), reason: "x" };
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
    expect(readFileSync(join(root, "a.html"), "utf8")).toContain("Third Street, Boston");
    expect(readFileSync(join(root, "b.html"), "utf8")).toContain("Third Street, Boston");
  });

  it("reads back what an earlier run recorded", async () => {
    await main([root], onePass(), { runLuna: luna() });
    const resumed = readProgress(root);

    expect(resumed.changes).toHaveLength(1);
    expect(processedFiles(resumed)).toEqual(["a.html", "b.html"]);
  });
});

describe("remainingFiles", () => {
  it("lists every file before any change is recorded", () => {
    expect(remainingFiles(readJob(root), { changes: [] })).toEqual(["a.html", "b.html"]);
  });

  it("drops the files a recorded change covered", () => {
    const progress = { changes: [{ files: ["a.html"] }] };

    expect(remainingFiles(readJob(root), progress)).toEqual(["b.html"]);
  });

  it("is empty when every file is covered", async () => {
    await main([root], onePass(), { runLuna: luna() });

    expect(remainingFiles(readJob(root), readProgress(root))).toEqual([]);
  });
});
