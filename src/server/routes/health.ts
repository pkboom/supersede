import { Hono } from "hono";

const { version } = await import("../../../package.json", {
  with: { type: "json" },
}).then((m) => m.default);

export function createHealthRoutes(): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => {
    return c.json({ ok: true, version, ts: new Date().toISOString() });
  });

  return app;
}
