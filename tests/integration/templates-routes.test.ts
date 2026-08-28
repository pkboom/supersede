import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultLLMAdapterFactory } from "../../src/llm/index.js";
import { createWebApp } from "../../src/server/createWebApp.js";
import { type TestDb, makeTestDb } from "../helpers/makeTestDb.js";

describe("/api/templates routes (integration, single-user)", () => {
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

  const JSON_HEADERS: HeadersInit = { "content-type": "application/json" };

  it("POST creates with default mjml; GET list returns summary without mjml field", async () => {
    const app = build();
    const create = await app.fetch(
      new Request("http://test/api/templates", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Welcome" }),
      }),
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; mjml: string; version: number };
    expect(created.mjml).toBe("<mjml><mj-body></mj-body></mjml>");
    expect(created.version).toBe(1);

    const list = await app.fetch(new Request("http://test/api/templates"));
    expect(list.status).toBe(200);
    const rows = (await list.json()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("mjml");
    expect(rows[0]?.id).toBe(created.id);
  });

  it("GET /:id returns 404 for unknown id", async () => {
    const app = build();
    const res = await app.fetch(
      new Request("http://test/api/templates/00000000-0000-0000-0000-000000000000"),
    );
    expect(res.status).toBe(404);
  });

  it("PATCH bumps version on success", async () => {
    const app = build();
    const create = await app.fetch(
      new Request("http://test/api/templates", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "X" }),
      }),
    );
    const tpl = (await create.json()) as { id: string };
    const patch = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ version: 1, name: "X-renamed" }),
      }),
    );
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as { version: number; name: string };
    expect(updated.version).toBe(2);
    expect(updated.name).toBe("X-renamed");
  });

  it("PATCH returns 409 on stale version", async () => {
    const app = build();
    const create = await app.fetch(
      new Request("http://test/api/templates", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "X" }),
      }),
    );
    const tpl = (await create.json()) as { id: string };
    await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ version: 1, name: "first" }),
      }),
    );
    const stale = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ version: 1, name: "second" }),
      }),
    );
    expect(stale.status).toBe(409);
  });

  it("PATCH rejects bad mjml type with 400", async () => {
    const app = build();
    const create = await app.fetch(
      new Request("http://test/api/templates", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "X" }),
      }),
    );
    const tpl = (await create.json()) as { id: string };
    const bad = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ version: 1, mjml: 123 }),
      }),
    );
    expect(bad.status).toBe(400);
  });

  it("DELETE returns 204 then 404 on second call", async () => {
    const app = build();
    const create = await app.fetch(
      new Request("http://test/api/templates", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "X" }),
      }),
    );
    const tpl = (await create.json()) as { id: string };
    const d1 = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}`, { method: "DELETE" }),
    );
    expect(d1.status).toBe(204);
    const d2 = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}`, { method: "DELETE" }),
    );
    expect(d2.status).toBe(404);
  });

  it("POST rejects empty name with 400", async () => {
    const app = build();
    const res = await app.fetch(
      new Request("http://test/api/templates", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "  " }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("PATCH rejects missing version with 400", async () => {
    const app = build();
    const create = await app.fetch(
      new Request("http://test/api/templates", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "X" }),
      }),
    );
    const tpl = (await create.json()) as { id: string };
    const res = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Y" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
