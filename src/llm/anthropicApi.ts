import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { llmResponseSchema } from "./responseSchema.js";
import {
  LLMAuthError,
  LLMError,
  LLMSchemaError,
  type LLMAdapter,
  type LLMAdapterInput,
  type LLMAdapterOutput,
} from "./types.js";

/**
 * Vercel AI SDK wrapper. Each user supplies their own apiKey, so this adapter
 * is INSTANTIATED per-call by the resolver in `src/llm/index.ts` — never
 * shared across users, never reads `process.env.ANTHROPIC_API_KEY`.
 *
 * `model` is per-call (carried in `LLMAdapterInput`) so a single user could in
 * principle switch models between turns without re-instantiating the adapter
 * — the v2.0 frontend pins it at the user's settings.defaultModel.
 */
export class AnthropicAPIAdapter implements LLMAdapter {
  constructor(private readonly apiKey: string) {}

  async generateMjml(input: LLMAdapterInput): Promise<LLMAdapterOutput> {
    const provider = createAnthropic({ apiKey: this.apiKey });
    const userMessage = `Current MJML:\n\n${input.mjml}\n\n---\n\nUser request:\n\n${input.query}`;

    try {
      const result = await generateObject({
        model: provider(input.model),
        schema: llmResponseSchema,
        system: `${input.systemGuidance}\n\n${input.blockCatalog}`,
        prompt: userMessage,
      });
      return { mjml: result.object.mjml, reply: result.object.reply };
    } catch (err) {
      throw classifyError(err);
    }
  }
}

function classifyError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  const e = err as { name?: string; statusCode?: number; status?: number; message?: string };
  const status = e?.statusCode ?? e?.status;
  if (status === 401 || status === 403) {
    return new LLMAuthError("Provider rejected the API key", err);
  }
  // Vercel AI SDK throws AI_NoObjectGeneratedError when retries can't satisfy
  // the schema. Detect by name (cheaper than instanceof against a dynamic dep).
  if (e?.name === "AI_NoObjectGeneratedError" || e?.name === "ZodError") {
    return new LLMSchemaError("Provider returned a malformed response", err);
  }
  return new LLMError(e?.message ?? "Unknown LLM error", err);
}
