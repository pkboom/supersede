import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import * as schema from "./schema.js";

export type DbClient = Database.Database;
export type DbHandle = ReturnType<typeof drizzle<typeof schema>>;

export interface OpenDbResult {
  db: DbHandle;
  client: DbClient;
}

export function openDb(filePath: string): OpenDbResult {
  const absolute = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  if (absolute !== ":memory:") {
    mkdirSync(dirname(absolute), { recursive: true });
  }
  const client = new Database(absolute);
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");
  client.pragma("synchronous = NORMAL");
  const db = drizzle(client, { schema });
  return { db, client };
}

export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.EMAIL_DESIGNER_DB_PATH;
  if (!value || value.trim() === "") {
    throw new Error(
      "EMAIL_DESIGNER_DB_PATH is not set. Set it to the SQLite file path " +
        "(e.g. './data/dev.db' for local development, '/var/lib/email-designer/data.db' " +
        "for production), or run `npm run dev` which sets it automatically.",
    );
  }
  return value;
}

export { schema };
