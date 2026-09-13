import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultLLMAdapterFactory } from "../../src/llm/index.js";
import { createWebApp } from "../../src/server/createWebApp.js";
import { type TestDb, makeTestDb } from "../helpers/makeTestDb.js";

describe("/api/settings (integration, single-user)", () => {
  let h: TestDb;

  beforeEach(() => {
    h = makeTestDb();
  });
  afterEach(() => {
    h.cleanup();
  });

  function build(apiKey: string | null = "sk-test") {
    return createWebApp({
      db: h.db,
      llmAdapterFactory: defaultLLMAdapterFactory,
      apiKeyResolver: () => apiKey,
    }).app;
  }

  const JSON_HEADERS: HeadersInit = { "content-type": "application/json" };

  it("GET returns defaults + apiKeyConfigured: true when env is set", async () => {
    const app = build("sk-real");
    const res = await app.fetch(new Request("http://localhost/api/settings"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      defaultProvider: "anthropic",
      defaultMode: "cli",
      defaultModel: "claude-opus-4-7",
      apiKeyConfigured: true,
    });
  });

  it("GET returns apiKeyConfigured: false when env is unset", async () => {
    const app = build(null);
    const res = await app.fetch(new Request("http://localhost/api/settings"));
    const body = (await res.json()) as { apiKeyConfigured: boolean };
    expect(body.apiKeyConfigured).toBe(false);
  });

  it("PATCH accepts opus and sonnet", async () => {
    const app = build();
    const res = await app.fetch(
      new Request("http://localhost/api/settings", {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ defaultModel: "claude-sonnet-4-6" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { defaultModel: string };
    expect(body.defaultModel).toBe("claude-sonnet-4-6");

    const back = await app.fetch(new Request("http://localhost/api/settings"));
    expect((await back.json()) as { defaultModel: string }).toMatchObject({
      defaultModel: "claude-sonnet-4-6",
    });
  });

  it("PATCH rejects unknown model with 400", async () => {
    const app = build();
    const res = await app.fetch(
      new Request("http://localhost/api/settings", {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ defaultModel: "claude-haiku-4-5" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("PATCH rejects non-string defaultModel with 400", async () => {
    const app = build();
    const res = await app.fetch(
      new Request("http://localhost/api/settings", {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ defaultModel: 42 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("PATCH accepts defaultMode: 'cli'", async () => {
    const app = build();
    const res = await app.fetch(
      new Request("http://localhost/api/settings", {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ defaultMode: "cli" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { defaultMode: string };
    expect(body.defaultMode).toBe("cli");

    const back = await app.fetch(new Request("http://localhost/api/settings"));
    expect((await back.json()) as { defaultMode: string }).toMatchObject({
      defaultMode: "cli",
    });
  });

  it("PATCH rejects unknown defaultMode with 400", async () => {
    const app = build();
    const res = await app.fetch(
      new Request("http://localhost/api/settings", {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ defaultMode: "subscription" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
