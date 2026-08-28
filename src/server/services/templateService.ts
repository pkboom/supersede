import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DbHandle } from "../../db/index.js";
import { templates } from "../../db/schema.js";

export const DEFAULT_MJML = "<mjml><mj-body></mj-body></mjml>";

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  mjml: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  updatedAt: Date;
}

export type TemplateUpdateResult =
  | { kind: "ok"; row: TemplateRow }
  | { kind: "stale" }
  | { kind: "not_found" };

/**
 * Single-user open-source shape: no per-user scoping. Every template lives
 * in one global pool owned by the deployer.
 */
export class TemplateService {
  constructor(private readonly db: DbHandle) {}

  list(): TemplateSummary[] {
    return this.db
      .select({
        id: templates.id,
        name: templates.name,
        description: templates.description,
        updatedAt: templates.updatedAt,
      })
      .from(templates)
      .orderBy(desc(templates.updatedAt))
      .all();
  }

  get(id: string): TemplateRow | null {
    const row = this.db.select().from(templates).where(eq(templates.id, id)).limit(1).get();
    return row ?? null;
  }

  create(args: { name: string; mjml?: string; description?: string | null }): TemplateRow {
    const now = new Date();
    const row: TemplateRow = {
      id: randomUUID(),
      name: args.name,
      description: args.description ?? null,
      mjml: args.mjml ?? DEFAULT_MJML,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(templates).values(row).run();
    return row;
  }

  update(
    id: string,
    expectedVersion: number,
    patch: { name?: string; description?: string | null; mjml?: string },
  ): TemplateUpdateResult {
    const setObj: Record<string, unknown> = {
      updatedAt: new Date(),
      version: sql`${templates.version} + 1`,
    };
    if (patch.name !== undefined) setObj.name = patch.name;
    if (patch.description !== undefined) setObj.description = patch.description;
    if (patch.mjml !== undefined) setObj.mjml = patch.mjml;

    const updated = this.db
      .update(templates)
      .set(setObj)
      .where(and(eq(templates.id, id), eq(templates.version, expectedVersion)))
      .returning()
      .all();

    if (updated.length > 0) {
      return { kind: "ok", row: updated[0] as TemplateRow };
    }

    const exists = this.db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1)
      .all();
    return exists.length === 0 ? { kind: "not_found" } : { kind: "stale" };
  }

  delete(id: string): boolean {
    const result = this.db.delete(templates).where(eq(templates.id, id)).run();
    return result.changes > 0;
  }
}
