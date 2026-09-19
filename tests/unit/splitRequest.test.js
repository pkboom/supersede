import { describe, expect, it, vi } from "vitest";
import { buildRequestSplitPrompt, leaks, splitRequestWithLuna } from "../../src/pipeline/splitRequest.js";

const INSTRUCTION = `find an address and replace it with '1234, Main St.'`;

function splitting(response) {
  return vi.fn(async () => response);
}

describe("Luna request split", () => {
  it("returns the two phases the loop runs on", async () => {
    const runLuna = splitting({
      status: "split",
      find: "the postal address",
      replacement: "1234, Main St.",
      reason: "The request names the address and the new value.",
    });

    const result = await splitRequestWithLuna(INSTRUCTION, { runLuna });

    expect(result).toMatchObject({
      instruction: INSTRUCTION,
      find: "the postal address",
      replacement: "1234, Main St.",
    });
    expect(runLuna).toHaveBeenCalledTimes(1);
    expect(runLuna.mock.calls[0][0].model).toBe("gpt-5.6-luna");
    expect(runLuna.mock.calls[0][0].schemaName).toBe("email_request_split");
  });

  it("puts the whole request in the prompt and asks to keep the new value out of the find phase", () => {
    const prompt = buildRequestSplitPrompt(INSTRUCTION);

    expect(prompt).toContain(`Request: ${INSTRUCTION}`);
    expect(prompt).toContain("Do not put the new value in \"find\"");
  });

  it("asks Luna to keep the request's own noun so a button stays a button", () => {
    expect(buildRequestSplitPrompt(INSTRUCTION)).toContain("Keep the request's own noun for the part");
  });

  it("sends literal text for a named property through the value branch", () => {
    const prompt = buildRequestSplitPrompt(INSTRUCTION);

    expect(prompt).toContain("the property belongs in \"find\" and the literal text alone is the replacement");
    expect(prompt).toContain("Only when the request describes a property to change without giving the text to write");
  });

  it("asks Luna to refuse a request naming more than one change", () => {
    expect(buildRequestSplitPrompt(INSTRUCTION)).toContain(
      "Return unclear when the request names more than one change",
    );
  });

  it("asks Luna to pass a loosely named part through rather than call it unclear", () => {
    const prompt = buildRequestSplitPrompt(INSTRUCTION);

    expect(prompt).toContain("A loosely named part");
    expect(prompt).toContain("Never return unclear merely because the request does not say which one.");
  });

  it("trims what Luna returns", async () => {
    const runLuna = splitting({
      status: "split",
      find: "  the Submit button  ",
      replacement: "  set the background to blue  ",
      reason: "x",
    });

    const result = await splitRequestWithLuna(`  ${INSTRUCTION}  `, { runLuna });

    expect(result.find).toBe("the Submit button");
    expect(result.replacement).toBe("set the background to blue");
    expect(result.instruction).toBe(INSTRUCTION);
  });

  it("requires a request", async () => {
    await expect(splitRequestWithLuna("   ", { runLuna: splitting({}) })).rejects.toThrow(/request is required/i);
  });

  it("refuses a request Luna cannot split", async () => {
    const runLuna = splitting({ status: "unclear", find: "", replacement: "", reason: "No new value is named." });

    await expect(splitRequestWithLuna("make it nicer", { runLuna })).rejects.toThrow(/no new value is named/i);
  });

  it("refuses a malformed response", async () => {
    const runLuna = splitting({ status: "split", find: "the address", reason: "x" });

    await expect(splitRequestWithLuna(INSTRUCTION, { runLuna })).rejects.toThrow(/invalid request split/i);
  });

  it("refuses an empty phase Luna calls a split", async () => {
    const runLuna = splitting({ status: "split", find: "the address", replacement: "  ", reason: "x" });

    await expect(splitRequestWithLuna(INSTRUCTION, { runLuna })).rejects.toThrow(/nothing to replace it with/i);
  });

  it("flags a find phase that carries the replacement without refusing it", async () => {
    const runLuna = splitting({
      status: "split",
      find: "the address that becomes 1234, Main St.",
      replacement: "1234, Main St.",
      reason: "x",
    });

    const result = await splitRequestWithLuna(INSTRUCTION, { runLuna });

    expect(result.leaks).toBe(true);
    expect(result.find).toBe("the address that becomes 1234, Main St.");
  });

  it("lets a shortening edit through unflagged", async () => {
    const runLuna = splitting({
      status: "split",
      find: `the button labelled "Shop Now Today"`,
      replacement: "Shop Now",
      reason: "x",
    });

    const result = await splitRequestWithLuna(INSTRUCTION, { runLuna });

    expect(result.leaks).toBe(false);
  });
});

describe("leaks", () => {
  it("sees the replacement inside the find phase", () => {
    expect(leaks("the address that becomes 1234, Main St.", "1234, Main St.")).toBe(true);
  });

  it("does not fire when the find phase only carries the value being retired", () => {
    expect(leaks(`the headline "Summer Sale 2024"`, "Summer Sale")).toBe(false);
    expect(leaks(`the "Unsubscribe from all emails" link`, "Unsubscribe")).toBe(false);
  });

  it("does not fire on a replacement that normalizes to nothing", () => {
    expect(leaks("the footer address", "<br>")).toBe(false);
    expect(leaks("the footer address", "&nbsp;")).toBe(false);
  });
});
