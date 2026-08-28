import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { llmResponseSchema } from "./responseSchema.js";
import {
  LLMAuthError,
  LLMError,
  LLMSchemaError,
  type LLMAdapter,
  type LLMAdapterInput,
  type LLMAdapterOutput,
} from "./types.js";

const JSON_SCHEMA = {
  type: "object",
  properties: {
    mjml: { type: "string" },
    reply: { type: "string" },
  },
  required: ["mjml", "reply"],
  additionalProperties: false,
} as const;

type Spawner = (
  command: string,
  args: ReadonlyArray<string>,
  options?: SpawnOptions,
) => ChildProcessWithoutNullStreams;

export interface ClaudeCodeCLIAdapterOptions {
  /** Path to the `claude` binary; defaults to "claude" (resolved via PATH). */
  binary?: string;
  /** Injected for tests. Defaults to node's `child_process.spawn`. */
  spawn?: Spawner;
  /** Inherited by the spawned process. Defaults to the parent process env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Drives the local `claude` CLI in one-shot non-interactive mode. Used when
 * the deployer has a Claude subscription (Pro / Max / Team) and has run
 * `claude auth login` — the CLI reads the OS keychain, so the server never
 * sees an API key.
 *
 * Each call:
 *   claude -p --output-format json --json-schema <schema>
 *          --no-session-persistence --disable-slash-commands --tools ""
 *          --model <model> --system-prompt <combined> <user prompt>
 *
 * Output envelope: a single JSON object on stdout. We read
 * `envelope.structured_output` (populated when --json-schema is set).
 * Markdown-fence parsing of `envelope.result` is a defensive fallback.
 */
export class ClaudeCodeCLIAdapter implements LLMAdapter {
  private readonly binary: string;
  private readonly spawnFn: Spawner;
  private readonly env: NodeJS.ProcessEnv;

  constructor(opts: ClaudeCodeCLIAdapterOptions = {}) {
    this.binary = opts.binary ?? "claude";
    this.spawnFn = opts.spawn ?? (spawn as Spawner);
    this.env = opts.env ?? process.env;
  }

  async generateMjml(input: LLMAdapterInput): Promise<LLMAdapterOutput> {
    const userPrompt = `Current MJML:\n\n${input.mjml}\n\n---\n\nUser request:\n\n${input.query}`;
    const systemPrompt = `${input.systemGuidance}\n\n${input.blockCatalog}`;

    const args = [
      "--print",
      "--output-format", "json",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--tools", "",
      "--model", input.model,
      "--system-prompt", systemPrompt,
      "--json-schema", JSON.stringify(JSON_SCHEMA),
      userPrompt,
    ];

    const envelope = await this.run(args);
    return parseEnvelope(envelope);
  }

  private run(args: ReadonlyArray<string>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnFn(this.binary, args, {
          stdio: ["ignore", "pipe", "pipe"],
          env: this.env,
        });
      } catch (err) {
        reject(new LLMError("Failed to spawn claude CLI", err));
        return;
      }

      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });

      child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
          reject(new LLMAuthError(`claude CLI not found on PATH (looked for "${this.binary}"). Install it from https://claude.com/claude-code or switch the mode to "api" in Settings.`, err));
        } else {
          reject(new LLMError(`claude CLI spawn error: ${err.message}`, err));
        }
      });

      child.on("close", (code: number | null) => {
        if (code !== 0) {
          const tail = stderr.trim().slice(-500);
          if (looksLikeAuthFailure(stderr)) {
            reject(new LLMAuthError(`claude CLI auth failed (exit ${code ?? "null"}). Run \`claude auth login\` or switch the mode to "api". ${tail}`));
          } else {
            reject(new LLMError(`claude CLI exited with code ${code ?? "null"}. ${tail}`));
          }
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(stdout);
        } catch (err) {
          reject(new LLMSchemaError(`claude CLI produced non-JSON stdout: ${stdout.slice(0, 200)}`, err));
          return;
        }
        resolve(parsed);
      });
    });
  }
}

function looksLikeAuthFailure(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes("not authenticated") ||
    s.includes("please run `claude auth") ||
    (s.includes("oauth") && s.includes("expired")) ||
    s.includes("invalid api key") ||
    s.includes("unauthorized")
  );
}

function parseEnvelope(envelope: unknown): LLMAdapterOutput {
  if (!isRecord(envelope)) {
    throw new LLMSchemaError("claude CLI envelope was not a JSON object");
  }

  if (envelope.is_error === true || envelope.subtype === "error") {
    const reason = typeof envelope.error === "string" ? envelope.error : envelope.subtype;
    if (typeof reason === "string" && /auth|unauthor|forbidden/i.test(reason)) {
      throw new LLMAuthError(`claude CLI reported auth error: ${reason}`);
    }
    throw new LLMError(`claude CLI reported error: ${String(reason ?? "unknown")}`);
  }

  // Preferred path: --json-schema populates structured_output.
  const structured = envelope.structured_output;
  if (isRecord(structured)) {
    const validated = llmResponseSchema.safeParse(structured);
    if (!validated.success) {
      throw new LLMSchemaError(`claude CLI structured_output failed schema: ${validated.error.message}`);
    }
    return validated.data;
  }

  // Fallback: parse `result` text (markdown-fenced JSON).
  if (typeof envelope.result === "string") {
    const stripped = stripJsonFence(envelope.result);
    let obj: unknown;
    try {
      obj = JSON.parse(stripped);
    } catch (err) {
      throw new LLMSchemaError(`claude CLI result was not parseable JSON: ${stripped.slice(0, 200)}`, err);
    }
    const validated = llmResponseSchema.safeParse(obj);
    if (!validated.success) {
      throw new LLMSchemaError(`claude CLI result failed schema: ${validated.error.message}`);
    }
    return validated.data;
  }

  throw new LLMSchemaError("claude CLI envelope missing both structured_output and result");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stripJsonFence(s: string): string {
  const trimmed = s.trim();
  const fenceMatch = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenceMatch ? fenceMatch[1]!.trim() : trimmed;
}
