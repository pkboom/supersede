/**
 * Provider-agnostic adapter contract. v2.0 implements `AnthropicAPIAdapter` only;
 * v2.1 adds `ClaudeCodeCLIAdapter` (subscription, desktop), v3+ adds
 * `OpenAIAPIAdapter`. Adding a new provider must NOT require changes to this
 * interface — that's the explicit ≤1-day acceptance criterion in the spec.
 */

export interface LLMAdapterInput {
  systemGuidance: string;
  blockCatalog: string;
  mjml: string;
  query: string;
  model: string;
}

export interface LLMAdapterOutput {
  mjml: string;
  reply: string;
}

export interface LLMAdapter {
  generateMjml(input: LLMAdapterInput): Promise<LLMAdapterOutput>;
}

/**
 * Typed error surface for adapter failures. Routes translate these into HTTP
 * responses (502 for malformed output, 401/403 for auth, etc.).
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export class LLMAuthError extends LLMError {
  constructor(message = "Provider rejected the API key", cause?: unknown) {
    super(message, cause);
    this.name = "LLMAuthError";
  }
}

export class LLMSchemaError extends LLMError {
  constructor(message = "Provider returned a response that did not match the expected schema", cause?: unknown) {
    super(message, cause);
    this.name = "LLMSchemaError";
  }
}
