import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeCodeCLIAdapter } from "../../src/llm/claudeCodeCli.js";
import { LLMAuthError, LLMError, LLMSchemaError } from "../../src/llm/types.js";

interface FakeChild {
  stdout: Readable;
  stderr: Readable;
  on: EventEmitter["on"];
  emit: EventEmitter["emit"];
}

function makeFakeChild(): FakeChild {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const ev = new EventEmitter();
  return {
    stdout,
    stderr,
    on: ev.on.bind(ev),
    emit: ev.emit.bind(ev),
  };
}

/**
 * Drives the adapter through the fake child's exit. Pushes the JSON envelope
 * on stdout, then emits `close(0)`.
 */
function scriptSuccess(child: FakeChild, envelope: unknown): void {
  setImmediate(() => {
    child.stdout.push(JSON.stringify(envelope));
    child.stdout.push(null);
    child.stderr.push(null);
    child.emit("close", 0);
  });
}

function scriptExit(child: FakeChild, code: number, stderr = ""): void {
  setImmediate(() => {
    child.stdout.push(null);
    if (stderr) child.stderr.push(stderr);
    child.stderr.push(null);
    child.emit("close", code);
  });
}

function scriptSpawnError(child: FakeChild, err: NodeJS.ErrnoException): void {
  setImmediate(() => {
    child.emit("error", err);
  });
}

const baseInput = {
  systemGuidance: "guidance",
  blockCatalog: "catalog",
  mjml: "<mjml><mj-body></mj-body></mjml>",
  query: "build a welcome email",
  model: "claude-opus-4-7",
};

describe("ClaudeCodeCLIAdapter", () => {
  let child: FakeChild;
  let spawnFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    child = makeFakeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spawnFn = vi.fn(() => child as any);
  });

  it("happy path: reads structured_output from the envelope", async () => {
    const a = new ClaudeCodeCLIAdapter({ spawn: spawnFn as never });
    scriptSuccess(child, {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Done.",
      structured_output: { mjml: "<mjml>new</mjml>", reply: "ok" },
    });
    const out = await a.generateMjml(baseInput);
    expect(out).toEqual({ mjml: "<mjml>new</mjml>", reply: "ok" });
  });

  it("invokes `claude` with the spec'd flags + model + system prompt + user prompt", async () => {
    const a = new ClaudeCodeCLIAdapter({ spawn: spawnFn as never });
    scriptSuccess(child, {
      type: "result",
      subtype: "success",
      is_error: false,
      structured_output: { mjml: "<mjml/>", reply: "ok" },
    });
    await a.generateMjml(baseInput);

    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [bin, args] = spawnFn.mock.calls[0]!;
    expect(bin).toBe("claude");
    expect(args).toContain("--print");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--disable-slash-commands");
    expect(args).toContain("--tools");
    expect(args).toContain("--model");
    expect(args).toContain("claude-opus-4-7");
    expect(args).toContain("--system-prompt");
    expect(args).toContain("--json-schema");

    // System prompt merges guidance + catalog; positional last is the user prompt.
    const systemIdx = args.indexOf("--system-prompt");
    expect(args[systemIdx + 1]).toContain("guidance");
    expect(args[systemIdx + 1]).toContain("catalog");
    expect(args[args.length - 1]).toContain("build a welcome email");
    expect(args[args.length - 1]).toContain("<mjml><mj-body></mj-body></mjml>");
  });

  it("fallback: parses markdown-fenced result when structured_output is absent", async () => {
    const a = new ClaudeCodeCLIAdapter({ spawn: spawnFn as never });
    scriptSuccess(child, {
      type: "result",
      subtype: "success",
      is_error: false,
      result: '```json\n{"mjml":"<mjml/>","reply":"ok-fallback"}\n```',
    });
    const out = await a.generateMjml(baseInput);
    expect(out).toEqual({ mjml: "<mjml/>", reply: "ok-fallback" });
  });

  it("LLMSchemaError when structured_output fails schema (empty strings)", async () => {
    const a = new ClaudeCodeCLIAdapter({ spawn: spawnFn as never });
    scriptSuccess(child, {
      type: "result",
      subtype: "success",
      is_error: false,
      structured_output: { mjml: "", reply: "" },
    });
    await expect(a.generateMjml(baseInput)).rejects.toThrowError(LLMSchemaError);
  });

  it("LLMSchemaError when envelope has neither structured_output nor result", async () => {
    const a = new ClaudeCodeCLIAdapter({ spawn: spawnFn as never });
    scriptSuccess(child, { type: "result", subtype: "success", is_error: false });
    await expect(a.generateMjml(baseInput)).rejects.toThrowError(LLMSchemaError);
  });

  it("LLMSchemaError on non-JSON stdout", async () => {
    const a = new ClaudeCodeCLIAdapter({ spawn: spawnFn as never });
    setImmediate(() => {
      child.stdout.push("not json at all");
      child.stdout.push(null);
      child.stderr.push(null);
      child.emit("close", 0);
    });
    await expect(a.generateMjml(baseInput)).rejects.toThrowError(LLMSchemaError);
  });

  it("LLMAuthError on ENOENT (binary missing)", async () => {
    const a = new ClaudeCodeCLIAdapter({ spawn: spawnFn as never });
    const err: NodeJS.ErrnoException = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    scriptSpawnError(child, err);
    await expect(a.generateMjml(baseInput)).rejects.toThrowError(LLMAuthError);
  });

  it("LLMAuthError on non-zero exit with auth-like stderr", async () => {
    const a = new ClaudeCodeCLIAdapter({ spawn: spawnFn as never });
    scriptExit(child, 1, "Error: not authenticated. Please run `claude auth login`.");
    await expect(a.generateMjml(baseInput)).rejects.toThrowError(LLMAuthError);
  });

  it("LLMError on non-zero exit with non-auth stderr", async () => {
    const a = new ClaudeCodeCLIAdapter({ spawn: spawnFn as never });
    scriptExit(child, 2, "Some random crash");
    const promise = a.generateMjml(baseInput);
    await expect(promise).rejects.toThrowError(LLMError);
    await expect(promise).rejects.not.toThrowError(LLMAuthError);
  });

  it("LLMError when envelope is_error: true", async () => {
    const a = new ClaudeCodeCLIAdapter({ spawn: spawnFn as never });
    scriptSuccess(child, {
      type: "result",
      subtype: "error",
      is_error: true,
      error: "upstream 500",
    });
    await expect(a.generateMjml(baseInput)).rejects.toThrowError(LLMError);
  });

  it("LLMAuthError when envelope reports auth-shaped error", async () => {
    const a = new ClaudeCodeCLIAdapter({ spawn: spawnFn as never });
    scriptSuccess(child, {
      type: "result",
      subtype: "error",
      is_error: true,
      error: "unauthorized: token expired",
    });
    await expect(a.generateMjml(baseInput)).rejects.toThrowError(LLMAuthError);
  });

  it("uses the binary path from options when provided", async () => {
    const a = new ClaudeCodeCLIAdapter({ spawn: spawnFn as never, binary: "/custom/bin/claude" });
    scriptSuccess(child, {
      type: "result",
      subtype: "success",
      is_error: false,
      structured_output: { mjml: "<mjml/>", reply: "ok" },
    });
    await a.generateMjml(baseInput);
    expect(spawnFn.mock.calls[0]![0]).toBe("/custom/bin/claude");
  });
});
