import { AnthropicAPIAdapter } from "./anthropicApi.js";
import { ClaudeCodeCLIAdapter } from "./claudeCodeCli.js";
import type { LLMAdapter } from "./types.js";

export type LLMMode = "api" | "cli";

export type LLMAdapterFactory = (
  provider: string,
  mode: LLMMode,
  apiKey: string | null,
) => LLMAdapter;

/**
 * Production factory. The route handler resolves `provider` + `mode` from
 * the settings singleton and supplies the API key (when mode === "api") or
 * null (when mode === "cli", in which case the CLI uses the OS keychain via
 * `claude auth login`).
 */
export const defaultLLMAdapterFactory: LLMAdapterFactory = (provider, mode, apiKey) => {
  if (mode === "cli") {
    return new ClaudeCodeCLIAdapter();
  }
  if (provider === "anthropic") {
    if (!apiKey) {
      throw new Error("API-mode adapter requires an apiKey; got null");
    }
    return new AnthropicAPIAdapter(apiKey);
  }
  throw new Error(`Unknown LLM provider: ${provider}`);
};

export * from "./types.js";
export * from "./promptBuilder.js";
export * from "./responseSchema.js";
export { ClaudeCodeCLIAdapter } from "./claudeCodeCli.js";
