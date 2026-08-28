import {
  LLMError,
  type LLMAdapter,
  type LLMAdapterInput,
  type LLMAdapterOutput,
} from "./types.js";

export type StubScript =
  | LLMAdapterOutput
  | ((input: LLMAdapterInput, callIndex: number) => LLMAdapterOutput | Promise<LLMAdapterOutput>)
  | Error;

/**
 * Test-only deterministic LLMAdapter. Pass a fixed `{ mjml, reply }`, a
 * function for varied behaviour by call count, or an Error to simulate
 * upstream failure.
 *
 * `calls` records every invocation so tests can assert what arguments the
 * route handler threaded through (model picked from settings, prompt fields
 * present, etc.).
 */
export class StubLLMAdapter implements LLMAdapter {
  public readonly calls: LLMAdapterInput[] = [];
  private callIndex = 0;

  constructor(private readonly script: StubScript) {}

  async generateMjml(input: LLMAdapterInput): Promise<LLMAdapterOutput> {
    this.calls.push(input);
    const i = this.callIndex++;
    if (this.script instanceof Error) throw this.script;
    if (typeof this.script === "function") {
      return this.script(input, i);
    }
    return this.script;
  }
}

/** Convenience for the common case: echo the input mjml unchanged. */
export function echoStub(reply = "ok"): StubLLMAdapter {
  return new StubLLMAdapter((input) => ({ mjml: input.mjml, reply }));
}

/** Convenience for malformed-mjml integration tests (502 path). */
export function malformedStub(reply = "broken"): StubLLMAdapter {
  return new StubLLMAdapter({ mjml: "<<<not valid mjml>>>", reply });
}

/** Convenience for adapter-throws integration tests. */
export function throwingStub(message = "stub upstream failure"): StubLLMAdapter {
  return new StubLLMAdapter(new LLMError(message));
}
