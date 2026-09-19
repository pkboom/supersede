import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../dev/splitRequestCommand.js";

const INSTRUCTION = `find the address in the footer and replace it with "New Street, New York"`;

function luna(response) {
  return vi.fn(async () => ({ status: "split", reason: "x", ...response }));
}

afterEach(() => vi.restoreAllMocks());

describe("splitRequestCommand", () => {
  it("returns the two phases for the instruction it was given", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runLuna = luna({ find: "the address in the footer", replacement: "New Street, New York" });

    const split = await main({ instruction: INSTRUCTION, runLuna });

    expect(split.instruction).toBe(INSTRUCTION);
    expect(split.find).toBe("the address in the footer");
    expect(split.replacement).toBe("New Street, New York");
    expect(split.leaks).toBe(false);
  });

  it("sends the instruction to the model and names the split schema", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runLuna = luna({ find: "the footer address", replacement: "New Street" });

    await main({ instruction: INSTRUCTION, model: "test-model", runLuna });

    expect(runLuna.mock.calls[0][0].model).toBe("test-model");
    expect(runLuna.mock.calls[0][0].schemaName).toBe("email_request_split");
    expect(runLuna.mock.calls[0][0].prompt).toContain(`Request: ${INSTRUCTION}`);
  });

  it("flags a split that leaks the replacement into the find phase", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const runLuna = luna({ find: "the address New Street, New York", replacement: "New Street, New York" });

    const split = await main({ instruction: INSTRUCTION, runLuna });

    expect(split.leaks).toBe(true);
    expect(log.mock.calls.flat().join("\n")).toMatch(/does not hold yet/i);
  });

  it("surfaces the reason when the request cannot be split", async () => {
    const runLuna = luna({ status: "unclear", find: "", replacement: "", reason: "Two changes in one request." });

    await expect(main({ instruction: INSTRUCTION, runLuna })).rejects.toThrow(/two changes in one request/i);
  });
});
