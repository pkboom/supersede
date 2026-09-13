import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Open-source single-user shape: one global namespace. No User entity, no
// per-user scoping, no auth. The deployer owns the SQLite file and
// (transitively) every template inside it.

export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    mjml: text("mjml").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    updatedIdx: index("templates_updated_idx").on(t.updatedAt),
  }),
);

// Singleton settings row — there's only ever one row, identified by `id = 1`.
// `defaultProvider`/`defaultMode` are reserved for future provider plurality
// (v3+) but pinned to "anthropic"/"cli" today. The default below IS the source
// of truth: the drifted `'api'` that used to appear here, in the committed
// baseline migration and in OPERATIONS.md was settled by regenerating the
// migration from this file (plan §0.1/§0.6).
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  defaultProvider: text("default_provider").notNull().default("anthropic"),
  defaultMode: text("default_mode").notNull().default("cli"),
  defaultModel: text("default_model").notNull().default("claude-opus-4-7"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
