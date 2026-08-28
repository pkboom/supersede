import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, resolveDbPath } from "./index.js";

export function applyMigrations(filePath: string, migrationsFolder: string): void {
  const { db, client } = openDb(filePath);
  try {
    migrate(db, { migrationsFolder });
  } finally {
    client.close();
  }
}

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_FOLDER = resolve(here, "..", "..", "drizzle", "migrations");

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  const filePath = resolveDbPath();
  console.log(`[db:migrate] applying migrations from ${DEFAULT_MIGRATIONS_FOLDER} to ${filePath}`);
  applyMigrations(filePath, DEFAULT_MIGRATIONS_FOLDER);
  console.log("[db:migrate] done");
}
