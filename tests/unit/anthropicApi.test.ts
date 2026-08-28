import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObjectMock = vi.fn();
const modelHandle = vi.fn(() => "anthropic-model-handle");
const createAnthropicMock = vi.fn(() => modelHandle);

vi.mock("ai", () => ({ generateObject: generateObjectMock }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: createAnthropicMock }));

const { AnthropicAPIAdapter } = await import("../../src/llm/anthropicApi.js");
const { LLMAuthError, LLMSchemaError, LLMError } = await import("../../src/llm/types.js");

const baseInput = {
  systemGuidance: "guidance",
  blockCatalog: "catalog",
  mjml: "<mjml><mj-body></mj-body></mjml>",
  query: "build a welcome email",
  model: "claude-opus-4-7",
};

describe("AnthropicAPIAdapter", () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
    createAnthropicMock.mockClear();
    modelHandle.mockClear();
  });

  it("passes apiKey to createAnthropic per call (not from env)", async () => {
    generateObjectMock.mockResolvedValue({ object: { mjml: "<mjml/>", reply: "ok" } });
    const a = new AnthropicAPIAdapter("sk-user-A");
    await a.generateMjml(baseInput);
    expect(createAnthropicMock).toHaveBeenCalledWith({ apiKey: "sk-user-A" });

    const b = new AnthropicAPIAdapter("sk-user-B");
    await b.generateMjml(baseInput);
    expect(createAnthropicMock).toHaveBeenLastCalledWith({ apiKey: "sk-user-B" });
  });

  it("invokes generateObject with the model from input + system+catalog merged", async () => {
    generateObjectMock.mockResolvedValue({ object: { mjml: "<mjml/>", reply: "ok" } });
    const a = new AnthropicAPIAdapter("sk-test");
    await a.generateMjml(baseInput);
    expect(modelHandle).toHaveBeenCalledWith("claude-opus-4-7");
    const call = generateObjectMock.mock.calls[0][0];
    expect(call.system).toContain("guidance");
    expect(call.system).toContain("catalog");
    expect(call.prompt).toContain("build a welcome email");
    expect(call.prompt).toContain("<mjml><mj-body></mj-body></mjml>");
    expect(call.schema).toBeDefined();
  });

  it("returns parsed { mjml, reply } from generateObject", async () => {
    generateObjectMock.mockResolvedValue({ object: { mjml: "<mjml>updated</mjml>", reply: "renamed button" } });
    const a = new AnthropicAPIAdapter("sk-test");
    const out = await a.generateMjml(baseInput);
    expect(out.mjml).toBe("<mjml>updated</mjml>");
    expect(out.reply).toBe("renamed button");
  });

  it("translates AI_NoObjectGeneratedError into LLMSchemaError", async () => {
    const err = new Error("retries exhausted");
    err.name = "AI_NoObjectGeneratedError";
    generateObjectMock.mockRejectedValue(err);
    const a = new AnthropicAPIAdapter("sk-test");
    await expect(a.generateMjml(baseInput)).rejects.toThrowError(LLMSchemaError);
  });

  it("translates 401 into LLMAuthError", async () => {
    const err = Object.assign(new Error("unauthorized"), { statusCode: 401 });
    generateObjectMock.mockRejectedValue(err);
    const a = new AnthropicAPIAdapter("sk-test");
    await expect(a.generateMjml(baseInput)).rejects.toThrowError(LLMAuthError);
  });

  it("translates a 5xx network error into a generic LLMError", async () => {
    const err = Object.assign(new Error("upstream 500"), { statusCode: 500 });
    generateObjectMock.mockRejectedValue(err);
    const a = new AnthropicAPIAdapter("sk-test");
    await expect(a.generateMjml(baseInput)).rejects.toThrowError(LLMError);
  });
});
