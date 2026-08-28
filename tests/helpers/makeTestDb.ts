import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DbClient, type DbHandle, openDb } from "../../src/db/index.js";
import { DEFAULT_MIGRATIONS_FOLDER, applyMigrations } from "../../src/db/migrate.js";

export interface TestDb {
  db: DbHandle;
  client: DbClient;
  dbPath: string;
  cleanup: () => void;
}

/**
 * Creates a fresh temp-file SQLite DB, applies all Drizzle migrations, and returns
 * a handle plus a `cleanup()` to call from afterEach. Per-test isolation: each
 * caller gets its own file in a fresh mkdtemp directory, so parallel vitest
 * workers don't collide.
 */
export function makeTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "email-designer-test-"));
  const dbPath = join(dir, "test.db");
  applyMigrations(dbPath, DEFAULT_MIGRATIONS_FOLDER);
  const { db, client } = openDb(dbPath);
  return {
    db,
    client,
    dbPath,
    cleanup() {
      try {
        client.close();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
