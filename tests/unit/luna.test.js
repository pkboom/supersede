import { describe, expect, it, vi } from "vitest";
import { runLunaJson } from "../../src/luna.js";

const schema = {
  type: "object",
  properties: { status: { type: "string" } },
  required: ["status"],
  additionalProperties: false,
};

describe("Luna Responses API adapter", () => {
  it("uses GPT-5.6 Luna structured outputs without storing the response", async () => {
    const create = vi.fn(async () => ({ status: "completed", output_text: `{"status":"found"}` }));
    const result = await runLunaJson({
      prompt: "Find the related element",
      schema,
      client: { responses: { create } },
    });

    expect(result).toEqual({ status: "found" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.6-luna",
        input: "Find the related element",
        reasoning: { effort: "low" },
        store: false,
        text: expect.objectContaining({
          format: expect.objectContaining({ type: "json_schema", strict: true, schema }),
        }),
      }),
      { timeout: 180_000 },
    );
  });

  it("fails clearly when no API credential is available", async () => {
    await expect(runLunaJson({ prompt: "x", schema, apiKey: "" })).rejects.toThrow(/OPENAI_API_KEY/);
  });
});
