import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { DbHandle } from "../db/index.js";
import type { LLMAdapterFactory } from "../llm/index.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { createHealthRoutes } from "./routes/health.js";
import { createQueryRoutes } from "./routes/query.js";
import { createRenderRoutes } from "./routes/render.js";
import { createSettingsRoutes } from "./routes/settings.js";
import { createTemplatesRoutes } from "./routes/templates.js";
import type { AppEnv } from "./types.js";

const HOUR_MS = 60 * 60 * 1000;
const QUERY_RATE_LIMIT_PER_HOUR = 60;
const TEMPLATE_BODY_CAP = 256 * 1024;
const QUERY_BODY_CAP = 16 * 1024;

export type Clock = () => number;

/**
 * Open-source single-user composition root. No auth, no per-user scoping.
 * The deployer owns the SQLite file and the listener.
 *
 * Every external seam is injected so integration tests can drive
 * deterministic flows without touching the network or system clock.
 */
export interface CreateWebAppOptions {
  db: DbHandle;
  /** Per-call adapter factory; production = anthropic via @ai-sdk/anthropic. */
  llmAdapterFactory: LLMAdapterFactory;
  /** Resolver for the Anthropic API key. Reads from env at request time so dev hot-reloads of `.env` work. */
  apiKeyResolver: () => string | null;
  /** Injectable clock — defaults to Date.now. Used by the rate-limit middleware. */
  clock?: Clock;
  /** Optional structured-log sink for the `/query` route. Defaults to console.log(JSON.stringify(...)). */
  logger?: (record: Record<string, unknown>) => void;
}

export interface WebApp {
  app: Hono<AppEnv>;
  options: Required<Pick<CreateWebAppOptions, "clock">> & CreateWebAppOptions;
}

export function createWebApp(opts: CreateWebAppOptions): WebApp {
  const app = new Hono<AppEnv>();
  const clock: Clock = opts.clock ?? (() => Date.now());

  // Public routes (no gate — the deployer controls network access).
  app.route("/", createHealthRoutes());
  app.route("/", createRenderRoutes());

  // Body-size caps on mutating template paths (defense-in-depth against
  // accidental huge writes; not a security gate since there's no auth).
  const templatesBodyLimit = bodyLimit({
    maxSize: TEMPLATE_BODY_CAP,
    onError: (c) => c.json({ error: "Body too large" }, 413),
  });
  const queryBodyLimit = bodyLimit({
    maxSize: QUERY_BODY_CAP,
    onError: (c) => c.json({ error: "Body too large" }, 413),
  });
  app.use("/api/templates", templatesBodyLimit);
  app.use("/api/templates/*", templatesBodyLimit);

  // Per-IP sliding-window rate limit on /query: 60/hr/IP.
  const queryLimiter = rateLimit({
    windowMs: HOUR_MS,
    max: QUERY_RATE_LIMIT_PER_HOUR,
    keyFn: (c) => `query:${ipOf(c)}`,
    clock,
    name: "query",
  });

  // Mount /query first so its more specific path wins any tie with /:id.
  app.route(
    "/",
    createQueryRoutes({
      db: opts.db,
      llmAdapterFactory: opts.llmAdapterFactory,
      apiKeyResolver: opts.apiKeyResolver,
      middlewares: [queryBodyLimit, queryLimiter],
      logger: opts.logger,
    }),
  );
  app.route("/", createTemplatesRoutes({ db: opts.db }));
  app.route("/", createSettingsRoutes({
    db: opts.db,
    apiKeyConfigured: opts.apiKeyResolver() !== null,
  }));

  return {
    app,
    options: { ...opts, clock },
  };
}

function ipOf(c: { req: { header: (name: string) => string | undefined } }): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? "local";
}
