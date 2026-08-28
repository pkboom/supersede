import { Hono, type MiddlewareHandler } from "hono";
import type { DbHandle } from "../../db/index.js";
import { LLMAuthError, LLMSchemaError, type LLMAdapterFactory } from "../../llm/index.js";
import { buildPrompt } from "../../llm/promptBuilder.js";
import { isParsableMjml } from "../../shared/blocks/validate.js";
import { SettingsService } from "../services/settingsService.js";
import { TemplateService } from "../services/templateService.js";
import type { AppEnv } from "../types.js";

export interface QueryRoutesOptions {
  db: DbHandle;
  llmAdapterFactory: LLMAdapterFactory;
  /** Returns the active Anthropic API key, or null when unconfigured. Read at request time so env changes between requests are picked up in dev. */
  apiKeyResolver: () => string | null;
  middlewares?: MiddlewareHandler<AppEnv>[];
  logger?: (record: Record<string, unknown>) => void;
}

const MAX_QUERY_LENGTH = 4_000;

/**
 * `POST /api/templates/:id/query`
 *
 * Body: `{ query: string, version: number }` →
 *   200 `{ mjml, reply, version }` |
 *   400 (bad body) |
 *   404 (unknown template) |
 *   409 (stale version) |
 *   412 (no ANTHROPIC_API_KEY env var) |
 *   429 (rate limit) |
 *   502 (provider returned malformed mjml; DB unchanged) |
 *   503 (provider auth or upstream failure)
 */
export function createQueryRoutes(opts: QueryRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const ts = new TemplateService(opts.db);
  const ss = new SettingsService(opts.db);
  const log = opts.logger ?? ((record) => console.log(JSON.stringify(record)));

  const handler = async (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => {
    const templateId = c.req.param("id")!;
    const startMs = Date.now();

    let body: { query?: unknown; version?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body.query !== "string" || body.query.trim() === "") {
      return c.json({ error: "Field `query` must be a non-empty string" }, 400);
    }
    if (body.query.length > MAX_QUERY_LENGTH) {
      return c.json({ error: `Field \`query\` exceeds ${MAX_QUERY_LENGTH} characters` }, 413);
    }
    if (typeof body.version !== "number" || !Number.isInteger(body.version)) {
      return c.json({ error: "Field `version` (integer) is required" }, 400);
    }
    const query = body.query.trim();
    const expectedVersion = body.version;

    const template = ts.get(templateId);
    if (!template) return c.json({ error: "Template not found" }, 404);
    if (template.version !== expectedVersion) {
      return c.json({ error: "Stale version" }, 409);
    }

    const settings = ss.get();
    const mode = (settings.defaultMode === "cli" ? "cli" : "api") as "api" | "cli";
    let apiKey: string | null = null;
    if (mode === "api") {
      apiKey = opts.apiKeyResolver();
      if (!apiKey) {
        return c.json(
          { error: "ANTHROPIC_API_KEY env var is not set on the server" },
          412,
        );
      }
    }

    const built = buildPrompt({ mjml: template.mjml, query });
    const promptBytes =
      built.systemGuidance.length + built.blockCatalog.length + built.mjml.length + built.query.length;
    const adapter = opts.llmAdapterFactory(settings.defaultProvider, mode, apiKey);

    let llmOut: { mjml: string; reply: string };
    try {
      llmOut = await adapter.generateMjml({
        systemGuidance: built.systemGuidance,
        blockCatalog: built.blockCatalog,
        mjml: built.mjml,
        query: built.query,
        model: settings.defaultModel,
      });
    } catch (err) {
      log({
        event: "claude-turn",
        templateId,
        model: settings.defaultModel,
        promptBytes,
        exitOk: false,
        durationMs: Date.now() - startMs,
        mjmlBytesIn: template.mjml.length,
        mjmlBytesOut: 0,
        error: (err as Error).name,
      });
      if (err instanceof LLMAuthError) {
        return c.json({ error: "Provider rejected the API key" }, 503);
      }
      if (err instanceof LLMSchemaError) {
        return c.json({ error: "Provider returned a malformed response" }, 502);
      }
      return c.json({ error: "Upstream LLM error" }, 503);
    }

    if (typeof llmOut.mjml !== "string" || !isParsableMjml(llmOut.mjml)) {
      log({
        event: "claude-turn",
        templateId,
        model: settings.defaultModel,
        promptBytes,
        exitOk: false,
        durationMs: Date.now() - startMs,
        mjmlBytesIn: template.mjml.length,
        mjmlBytesOut: typeof llmOut.mjml === "string" ? llmOut.mjml.length : 0,
        error: "malformed-mjml",
      });
      return c.json({ error: "LLM returned malformed MJML" }, 502);
    }

    const updateResult = ts.update(templateId, expectedVersion, { mjml: llmOut.mjml });
    if (updateResult.kind === "not_found") return c.json({ error: "Template not found" }, 404);
    if (updateResult.kind === "stale") return c.json({ error: "Stale version" }, 409);

    log({
      event: "claude-turn",
      templateId,
      model: settings.defaultModel,
      promptBytes,
      exitOk: true,
      durationMs: Date.now() - startMs,
      mjmlBytesIn: template.mjml.length,
      mjmlBytesOut: llmOut.mjml.length,
    });

    return c.json({
      mjml: updateResult.row.mjml,
      reply: llmOut.reply,
      version: updateResult.row.version,
    });
  };

  const mws = opts.middlewares ?? [];
  switch (mws.length) {
    case 0:
      app.post("/api/templates/:id/query", handler);
      break;
    case 1:
      app.post("/api/templates/:id/query", mws[0]!, handler);
      break;
    case 2:
      app.post("/api/templates/:id/query", mws[0]!, mws[1]!, handler);
      break;
    default:
      throw new Error("createQueryRoutes: too many middlewares (max 2)");
  }

  return app;
}
