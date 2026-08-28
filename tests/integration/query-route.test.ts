import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LLMError, LLMSchemaError } from "../../src/llm/types.js";
import { StubLLMAdapter, echoStub, malformedStub } from "../../src/llm/stubAdapter.js";
import { createWebApp } from "../../src/server/createWebApp.js";
import { type TestDb, makeTestDb } from "../helpers/makeTestDb.js";

describe("/api/templates/:id/query (integration, single-user)", () => {
  let h: TestDb;

  beforeEach(() => {
    h = makeTestDb();
  });
  afterEach(() => {
    h.cleanup();
  });

  const JSON_HEADERS: HeadersInit = { "content-type": "application/json" };

  function buildApp(opts: {
    adapter?: StubLLMAdapter;
    clock?: () => number;
    apiKey?: string | null;
    logger?: (record: Record<string, unknown>) => void;
  } = {}) {
    const adapter = opts.adapter ?? echoStub();
    return createWebApp({
      db: h.db,
      llmAdapterFactory: () => adapter,
      apiKeyResolver: () => (opts.apiKey === undefined ? "sk-test" : opts.apiKey),
      clock: opts.clock,
      logger: opts.logger,
    }).app;
  }

  async function createTemplate(app: ReturnType<typeof buildApp>, name = "X") {
    const res = await app.fetch(
      new Request("http://test/api/templates", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          name,
          mjml:
            "<mjml><mj-body><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>",
        }),
      }),
    );
    return (await res.json()) as { id: string; mjml: string; version: number };
  }

  it("happy path returns { mjml, reply, version } with bumped version", async () => {
    const stub = echoStub("renamed");
    const app = buildApp({ adapter: stub });
    const tpl = await createTemplate(app);
    const res = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}/query`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ query: "make button blue", version: 1 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mjml: string; reply: string; version: number };
    expect(body.mjml).toBe(tpl.mjml);
    expect(body.reply).toBe("renamed");
    expect(body.version).toBe(2);

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.model).toBe("claude-opus-4-7");
    expect(stub.calls[0]!.systemGuidance).toContain("MJML");
    expect(stub.calls[0]!.blockCatalog).toContain("Available block types");
  });

  it("returns 412 in API mode when ANTHROPIC_API_KEY env var is unset", async () => {
    const app = buildApp({ apiKey: null });
    // Default mode is now `cli`; flip to `api` so the 412 path is reachable.
    const patch = await app.fetch(
      new Request("http://test/api/settings", {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ defaultMode: "api" }),
      }),
    );
    expect(patch.status).toBe(200);

    const tpl = await createTemplate(app);
    const res = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}/query`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ query: "x", version: 1 }),
      }),
    );
    expect(res.status).toBe(412);
  });

  it("skips the 412 ANTHROPIC_API_KEY check when defaultMode === 'cli'", async () => {
    const stub = echoStub("from-cli");
    const app = buildApp({ adapter: stub, apiKey: null });
    // Flip mode to cli via the settings route before issuing the query.
    const patch = await app.fetch(
      new Request("http://test/api/settings", {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ defaultMode: "cli" }),
      }),
    );
    expect(patch.status).toBe(200);

    const tpl = await createTemplate(app);
    const res = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}/query`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ query: "hello", version: 1 }),
      }),
    );
    expect(res.status).toBe(200);
    expect(stub.calls).toHaveLength(1);
  });

  it("returns 404 for unknown template", async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request(
        "http://test/api/templates/00000000-0000-0000-0000-000000000000/query",
        { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ query: "x", version: 1 }) },
      ),
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 on stale version (early check, before invoking adapter)", async () => {
    const stub = echoStub();
    const app = buildApp({ adapter: stub });
    const tpl = await createTemplate(app);
    const res = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}/query`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ query: "x", version: 99 }),
      }),
    );
    expect(res.status).toBe(409);
    expect(stub.calls).toHaveLength(0);
  });

  it("returns 502 + DB unchanged when stub returns malformed MJML", async () => {
    const app = buildApp({ adapter: malformedStub() });
    const tpl = await createTemplate(app);
    const res = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}/query`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ query: "x", version: 1 }),
      }),
    );
    expect(res.status).toBe(502);

    const after = await app.fetch(new Request(`http://test/api/templates/${tpl.id}`));
    const row = (await after.json()) as { version: number; mjml: string };
    expect(row.version).toBe(1);
    expect(row.mjml).toBe(tpl.mjml);
  });

  it("returns 502 on adapter LLMSchemaError and 503 on generic LLMError", async () => {
    {
      const app = buildApp({ adapter: new StubLLMAdapter(new LLMSchemaError("retries exhausted")) });
      const tpl = await createTemplate(app);
      const res = await app.fetch(
        new Request(`http://test/api/templates/${tpl.id}/query`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ query: "x", version: 1 }),
        }),
      );
      expect(res.status).toBe(502);
    }
    {
      const app = buildApp({ adapter: new StubLLMAdapter(new LLMError("upstream 500")) });
      const tpl = await createTemplate(app, "Y");
      const res = await app.fetch(
        new Request(`http://test/api/templates/${tpl.id}/query`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ query: "x", version: 1 }),
        }),
      );
      expect(res.status).toBe(503);
    }
  });

  it("rate limit: 60 succeed, 61st returns 429; advance clock past window → next succeeds", async () => {
    let nowMs = 1_700_000_000_000;
    const stub = echoStub();
    const app = buildApp({ adapter: stub, clock: () => nowMs });
    const tpl = await createTemplate(app);
    let currentVersion = tpl.version;
    for (let i = 0; i < 60; i++) {
      const res = await app.fetch(
        new Request(`http://test/api/templates/${tpl.id}/query`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ query: `q${i}`, version: currentVersion }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { version: number };
      currentVersion = body.version;
      nowMs += 1;
    }
    const limited = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}/query`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ query: "61st", version: currentVersion }),
      }),
    );
    expect(limited.status).toBe(429);

    nowMs += 60 * 60 * 1000 + 1;
    const fresh = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}/query`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ query: "after-window", version: currentVersion }),
      }),
    );
    expect(fresh.status).toBe(200);
  });

  it("concurrent same-version writes — exactly one wins, the other gets 409", async () => {
    const stub = echoStub("concurrent");
    const app = buildApp({ adapter: stub });
    const tpl = await createTemplate(app);
    const [r1, r2] = await Promise.all([
      app.fetch(
        new Request(`http://test/api/templates/${tpl.id}/query`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ query: "first", version: 1 }),
        }),
      ),
      app.fetch(
        new Request(`http://test/api/templates/${tpl.id}/query`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ query: "second", version: 1 }),
        }),
      ),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const after = await app.fetch(new Request(`http://test/api/templates/${tpl.id}`));
    const row = (await after.json()) as { version: number };
    expect(row.version).toBe(2);
  });

  it("emits a structured claude-turn log with the spec'd shape on success", async () => {
    const captured: Record<string, unknown>[] = [];
    const app = buildApp({ adapter: echoStub("ok"), logger: (r) => captured.push(r) });
    const tpl = await createTemplate(app);
    const res = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}/query`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ query: "x", version: 1 }),
      }),
    );
    expect(res.status).toBe(200);
    const turn = captured.find((c) => c.event === "claude-turn") as Record<string, unknown> | undefined;
    expect(turn).toBeDefined();
    expect(turn).toMatchObject({
      event: "claude-turn",
      templateId: tpl.id,
      model: "claude-opus-4-7",
      exitOk: true,
    });
    expect(typeof turn?.promptBytes).toBe("number");
    expect(typeof turn?.durationMs).toBe("number");
    expect(typeof turn?.mjmlBytesIn).toBe("number");
    expect(typeof turn?.mjmlBytesOut).toBe("number");
  });

  it("rejects bad body (missing query / version) with 400", async () => {
    const app = buildApp();
    const tpl = await createTemplate(app);
    const noVersion = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}/query`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ query: "x" }),
      }),
    );
    expect(noVersion.status).toBe(400);
    const noQuery = await app.fetch(
      new Request(`http://test/api/templates/${tpl.id}/query`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ version: 1 }),
      }),
    );
    expect(noQuery.status).toBe(400);
  });
});
