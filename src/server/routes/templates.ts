import { Hono } from "hono";
import type { DbHandle } from "../../db/index.js";
import { isParsableMjml } from "../../shared/blocks/validate.js";
import { TemplateService } from "../services/templateService.js";
import type { AppEnv } from "../types.js";

export interface TemplatesRoutesOptions {
  db: DbHandle;
}

/**
 * Templates CRUD. No auth — the deployer is responsible for who can reach
 * the listener (localhost-only by default; reverse-proxy + network ACLs for
 * shared hosts).
 *
 *   GET    /api/templates       → 200 [{ id, name, description, updatedAt }]
 *   POST   /api/templates       → 201 row | 400 (bad body) | 422 (malformed mjml)
 *   GET    /api/templates/:id   → 200 row | 404
 *   PATCH  /api/templates/:id   → 200 row | 400 | 404 | 409 (stale) | 422 (malformed mjml)
 *   DELETE /api/templates/:id   → 204 | 404
 */
export function createTemplatesRoutes(opts: TemplatesRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const ts = new TemplateService(opts.db);

  app.get("/api/templates", (c) => {
    return c.json(ts.list());
  });

  app.post("/api/templates", async (c) => {
    let body: { name?: unknown; mjml?: unknown; description?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return c.json({ error: "Field `name` must be a non-empty string" }, 400);
    }
    if (body.mjml !== undefined) {
      if (typeof body.mjml !== "string") {
        return c.json({ error: "Field `mjml` must be a string" }, 400);
      }
      if (!isParsableMjml(body.mjml)) {
        return c.json({ error: "Field `mjml` failed parser validation" }, 422);
      }
    }
    if (body.description !== undefined && body.description !== null && typeof body.description !== "string") {
      return c.json({ error: "Field `description` must be string or null" }, 400);
    }
    const row = ts.create({
      name: body.name.trim(),
      mjml: body.mjml as string | undefined,
      description: body.description === undefined ? null : (body.description as string | null),
    });
    return c.json(row, 201);
  });

  app.get("/api/templates/:id", (c) => {
    const row = ts.get(c.req.param("id")!);
    if (!row) return c.json({ error: "Template not found" }, 404);
    return c.json(row);
  });

  app.patch("/api/templates/:id", async (c) => {
    let body: { name?: unknown; description?: unknown; mjml?: unknown; version?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body.version !== "number" || !Number.isInteger(body.version)) {
      return c.json({ error: "Field `version` (integer) is required" }, 400);
    }
    const patch: { name?: string; description?: string | null; mjml?: string } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim() === "") {
        return c.json({ error: "Field `name` must be a non-empty string" }, 400);
      }
      patch.name = body.name.trim();
    }
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== "string") {
        return c.json({ error: "Field `description` must be string or null" }, 400);
      }
      patch.description = body.description as string | null;
    }
    if (body.mjml !== undefined) {
      if (typeof body.mjml !== "string") {
        return c.json({ error: "Field `mjml` must be a string" }, 400);
      }
      if (!isParsableMjml(body.mjml)) {
        return c.json({ error: "Field `mjml` failed parser validation" }, 422);
      }
      patch.mjml = body.mjml;
    }

    const result = ts.update(c.req.param("id")!, body.version, patch);
    if (result.kind === "not_found") return c.json({ error: "Template not found" }, 404);
    if (result.kind === "stale") return c.json({ error: "Stale version" }, 409);
    return c.json(result.row);
  });

  app.delete("/api/templates/:id", (c) => {
    const ok = ts.delete(c.req.param("id")!);
    if (!ok) return c.json({ error: "Template not found" }, 404);
    return c.body(null, 204);
  });

  return app;
}
