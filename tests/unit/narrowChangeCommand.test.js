import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { narrowChange, readWorkspace } from "../../dev/narrowChangeCommand.js";
import { buildElementAnnotatedView } from "../../src/htmlTargets.js";

const FIND = "the address in the footer";
const REPLACEMENT = "New Street, New York";
const OLD = "Old Street &bull; Springfield";

let root;

function email(body) {
  return `<html><body><table><tr><td id="Footer">${body}</td></tr></table></body></html>`;
}

function footerId(source) {
  return [...buildElementAnnotatedView(source).elements.values()]
    .find((element) => element.html.startsWith(`<td id="Footer"`))
    .id;
}

function luna({ from = OLD, to = REPLACEMENT, seen = [] } = {}) {
  return async ({ schema, prompt }) => {
    const statuses = schema.properties.status.enum;
    if (statuses.includes("found")) {
      seen.push({ phase: "find", prompt });
      return { status: "found", elementId: footerId(email(`${OLD} one`)), reason: "x" };
    }
    seen.push({ phase: "narrow", prompt });
    return { status: "narrowed", from, to, reason: "x" };
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "narrow-"));
  writeFileSync(join(root, "a.html"), email(`${OLD} one`));
  writeFileSync(join(root, "b.html"), email(`${OLD} two`));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readWorkspace", () => {
  it("refuses a workspace with fewer than two emails", () => {
    rmSync(join(root, "b.html"));

    expect(() => readWorkspace(root)).toThrow(/at least two emails|found 1/i);
  });

  it("refuses a directory that does not exist", () => {
    expect(() => readWorkspace(join(root, "missing"))).toThrow(/not a directory/i);
  });
});

describe("narrowChange", () => {
  it("sends the find phase to extraction without the replacement", async () => {
    const seen = [];
    await narrowChange({ find: FIND, replacement: REPLACEMENT, directory: root, runLuna: luna({ seen }) });

    expect(seen[0].phase).toBe("find");
    expect(seen[0].prompt).toContain(`User request: ${FIND}`);
    expect(seen[0].prompt).not.toContain(REPLACEMENT);
  });

  it("joins both phases for narrowing", async () => {
    const seen = [];
    const result = await narrowChange({
      find: FIND,
      replacement: REPLACEMENT,
      directory: root,
      runLuna: luna({ seen }),
    });

    expect(result.request).toBe(`Replace ${FIND} with "${REPLACEMENT}".`);
    expect(seen[1].prompt).toContain(`Requested change: ${result.request}`);
  });

  it("reports a span unique in every file as deterministic", async () => {
    const result = await narrowChange({
      find: FIND,
      replacement: REPLACEMENT,
      directory: root,
      runLuna: luna(),
    });

    expect(result.determinism.status).toBe("deterministic");
    expect(result.seed.id).toBe("a.html");
    expect(result.partner.id).toBe("b.html");
  });

  it("reports a span that repeats in one file as ambiguous", async () => {
    writeFileSync(join(root, "b.html"), email(`${OLD} two ${OLD} twice`));
    const result = await narrowChange({
      find: FIND,
      replacement: REPLACEMENT,
      directory: root,
      runLuna: luna(),
    });

    expect(result.determinism.status).toBe("ambiguous");
  });

  it("writes nothing to the workspace", async () => {
    const before = readWorkspace(root).files.map((file) => file.source);
    await narrowChange({ find: FIND, replacement: REPLACEMENT, directory: root, runLuna: luna() });

    expect(readWorkspace(root).files.map((file) => file.source)).toEqual(before);
  });

  it("requires both phases", async () => {
    await expect(narrowChange({ find: "  ", replacement: REPLACEMENT, directory: root, runLuna: luna() }))
      .rejects.toThrow(/find phase is required/i);
    await expect(narrowChange({ find: FIND, replacement: "  ", directory: root, runLuna: luna() }))
      .rejects.toThrow(/replacement phase is required/i);
  });
});
