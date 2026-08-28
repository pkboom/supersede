import { serve } from "@hono/node-server";
import { existsSync, readFileSync } from "node:fs";
import { openDb, resolveDbPath } from "../db/index.js";
import { applyMigrations, DEFAULT_MIGRATIONS_FOLDER } from "../db/migrate.js";
import { defaultLLMAdapterFactory } from "../llm/index.js";
import { SettingsService } from "./services/settingsService.js";
import { createWebApp } from "./createWebApp.js";

const DEFAULT_PORT = 5174;

/**
 * Loads `KEY=value` pairs from `.env` (if present) into process.env, without
 * overriding values already set by the shell. Stdlib-only so the dev/start
 * scripts don't depend on `dotenv` or `--env-file` (Node 20.6+).
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    if (process.env[key] !== undefined) continue;
    let value = m[2]!.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(process.env.EMAIL_DESIGNER_ENV_FILE ?? ".env");

function readPort(): number {
  const raw = process.env.PORT ?? process.env.EMAIL_DESIGNER_PORT;
  if (!raw) return DEFAULT_PORT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return n;
}

async function main(): Promise<void> {
  const dbPath = resolveDbPath();
  applyMigrations(dbPath, DEFAULT_MIGRATIONS_FOLDER);

  const { db } = openDb(dbPath);
  const { app } = createWebApp({
    db,
    llmAdapterFactory: defaultLLMAdapterFactory,
    // Read env at request time so a missing-then-set ANTHROPIC_API_KEY in dev
    // is picked up without restart.
    apiKeyResolver: () => {
      const k = process.env.ANTHROPIC_API_KEY;
      return k && k.trim() !== "" ? k.trim() : null;
    },
  });

  const port = readPort();
  // Boot-time advisory: only warn about a missing key when the persisted
  // mode is actually `api`. In `cli` mode the binary handles auth itself.
  const settings = new SettingsService(db).get();
  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
    console.log(`[email-designer] listening on http://127.0.0.1:${info.port} (mode=${settings.defaultMode})`);
    if (settings.defaultMode === "api" && !process.env.ANTHROPIC_API_KEY) {
      console.log("[email-designer] WARNING: ANTHROPIC_API_KEY not set; /query will return 412 until you `export ANTHROPIC_API_KEY=sk-...`");
    }
  });
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[email-designer] fatal:", err);
    process.exit(1);
  });
}
