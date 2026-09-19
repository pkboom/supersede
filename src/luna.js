import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

export const DEFAULT_MODEL = "gpt-5.6-luna";
const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");

function resolveApiKey(explicitKey) {
  if (explicitKey !== undefined) return explicitKey;
  if (!process.env.OPENAI_API_KEY && typeof process.loadEnvFile === "function" && fs.existsSync(ENV_FILE)) {
    process.loadEnvFile(ENV_FILE);
  }
  return process.env.OPENAI_API_KEY;
}

export async function runLunaJson({
  prompt,
  schema,
  schemaName,
  model = DEFAULT_MODEL,
  client,
  apiKey,
  timeoutMs = 180_000,
}) {
  const resolvedApiKey = resolveApiKey(apiKey);
  if (!client && !resolvedApiKey) {
    throw new Error("OPENAI_API_KEY is required for Luna Responses API calls.");
  }
  const openai = client ?? new OpenAI({ apiKey: resolvedApiKey, timeout: timeoutMs });
  const response = await openai.responses.create(
    {
      model,
      input: prompt,
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
      max_output_tokens: 10_000,
      store: false,
    },
    { timeout: timeoutMs },
  );
  if (response.status !== "completed" || !response.output_text) {
    throw new Error(`Luna response did not complete: ${response.status}`);
  }
  return JSON.parse(response.output_text);
}
