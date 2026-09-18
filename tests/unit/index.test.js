import { describe, expect, it, vi } from "vitest";
import { parseOptions, resolvePlan, splitArguments } from "../../src/index.js";

function asking(answers) {
  return {
    instruction: vi.fn(async () => answers.instruction),
    input: vi.fn(async () => answers.input),
    output: vi.fn(async () => answers.output),
  };
}

describe("command line", () => {
  it("separates folders from options in any order", () => {
    const { positional, flags } = splitArguments(["--instruction", "Change it", "./in", "./out", "--model", "m"]);

    expect(positional).toEqual(["./in", "./out"]);
    expect(flags).toEqual([["--instruction", "Change it"], ["--model", "m"]]);
  });

  it("rejects unknown options, missing values, and extra folders", () => {
    expect(() => splitArguments(["--nope", "x"])).toThrow(/unknown option/i);
    expect(() => splitArguments(["--instruction"])).toThrow(/requires a value/i);
    expect(() => splitArguments(["--instruction", "--model"])).toThrow(/requires a value/i);
    expect(() => splitArguments(["./a", "./b", "./c"])).toThrow(/unexpected argument/i);
  });

  it("rejects a conflicting or blank instruction", () => {
    expect(() => parseOptions([["--instruction", "a"], ["--instruction-file", "b"]])).toThrow(/not both/i);
    expect(() => parseOptions([["--instruction", "   "]])).toThrow(/instruction is required/i);
    expect(() => parseOptions([["--max-validation-attempts", "0"]])).toThrow(/integer from 1 to 10/i);
    expect(() => parseOptions([["--max-validation-attempts", "2.5"]])).toThrow(/integer from 1 to 10/i);
  });

  it("asks what to do first, then where, when nothing is supplied", async () => {
    const ask = asking({ instruction: "Change the address", input: "./in", output: "./out" });
    const plan = await resolvePlan([], ask);

    expect(ask.instruction).toHaveBeenCalled();
    expect(plan.instruction).toBe("Change the address");
    expect(plan.input).toBe(`${process.cwd()}/in`);
    expect(plan.output).toBe(`${process.cwd()}/out`);
    expect(plan.artifacts).toBe(`${process.cwd()}/out.evidence`);
  });

  it("never asks for anything already supplied", async () => {
    const ask = asking({ instruction: "unused", input: "unused", output: "unused" });
    const plan = await resolvePlan(["./in", "./out", "--instruction", "Change it", "--artifacts", "./ev"], ask);

    expect(ask.instruction).not.toHaveBeenCalled();
    expect(ask.input).not.toHaveBeenCalled();
    expect(ask.output).not.toHaveBeenCalled();
    expect(plan.instruction).toBe("Change it");
    expect(plan.artifacts).toBe(`${process.cwd()}/ev`);
  });

  it("asks only for the folders when the instruction came from a flag", async () => {
    const ask = asking({ instruction: "unused", input: "./in", output: "./out" });
    await resolvePlan(["--instruction", "Change it"], ask);

    expect(ask.instruction).not.toHaveBeenCalled();
    expect(ask.input).toHaveBeenCalled();
    expect(ask.output).toHaveBeenCalled();
  });

  it("refuses a blank answer to what to do", async () => {
    const ask = asking({ instruction: "   ", input: "./in", output: "./out" });
    await expect(resolvePlan([], ask)).rejects.toThrow(/instruction is required/i);
  });
});
