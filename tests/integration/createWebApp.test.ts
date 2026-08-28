import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultLLMAdapterFactory } from "../../src/llm/index.js";
import { createWebApp } from "../../src/server/createWebApp.js";
import { type TestDb, makeTestDb } from "../helpers/makeTestDb.js";

describe("createWebApp (integration)", () => {
  let h: TestDb;

  beforeEach(() => {
    h = makeTestDb();
  });
  afterEach(() => {
    h.cleanup();
  });

  function build() {
    return createWebApp({
      db: h.db,
      llmAdapterFactory: defaultLLMAdapterFactory,
      apiKeyResolver: () => null,
    }).app;
  }

  it("GET /api/health returns 200 with version + ts", async () => {
    const app = build();
    const res = await app.fetch(new Request("http://test/api/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string; ts: string };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
    expect(typeof body.ts).toBe("string");
  });

  it("POST /api/render compiles MJML to HTML", async () => {
    const app = build();
    const source =
      "<mjml><mj-body><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>";
    const res = await app.fetch(
      new Request("http://test/api/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { html: string };
    expect(body.html).toContain("<html");
    expect(body.html).toContain("hi");
  });

  it("POST /api/render rejects missing source with 400", async () => {
    const app = build();
    const res = await app.fetch(
      new Request("http://test/api/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown route", async () => {
    const app = build();
    const res = await app.fetch(new Request("http://test/api/nonsense"));
    expect(res.status).toBe(404);
  });
});
