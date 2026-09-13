/**
 * originGuard — DNS-rebinding / CSRF defence (plan §0.6).
 *
 * README.md claimed this defence while it did not exist. These tests are what
 * make the claim true, so they assert the attack shapes rather than just the
 * happy path.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { defaultLLMAdapterFactory } from "../../src/llm/index.js";
import { createWebApp } from "../../src/server/createWebApp.js";
import {
  hostnameOf,
  isLoopbackHost,
  isLoopbackOrigin,
} from "../../src/server/middleware/originGuard.js";
import { makeTestDb, type TestDb } from "../helpers/makeTestDb.js";

describe("originGuard — unit", () => {
  describe("hostnameOf", () => {
    it("strips the port", () => {
      expect(hostnameOf("localhost:3000")).toBe("localhost");
      expect(hostnameOf("127.0.0.1:8080")).toBe("127.0.0.1");
    });

    it("keeps bracketed IPv6 intact", () => {
      expect(hostnameOf("[::1]:3000")).toBe("[::1]");
      expect(hostnameOf("[::1]")).toBe("[::1]");
    });

    it("lowercases and trims", () => {
      expect(hostnameOf("  LocalHost:3000 ")).toBe("localhost");
    });

    it("handles a bare hostname with no port", () => {
      expect(hostnameOf("evil.test")).toBe("evil.test");
    });
  });

  describe("isLoopbackHost", () => {
    it.each(["localhost", "127.0.0.1", "[::1]", "localhost:5173", "127.0.0.1:3000"])(
      "accepts %s",
      (h) => expect(isLoopbackHost(h)).toBe(true)
    );

    it.each([
      "evil.test",
      "evil.test:3000",
      "127.0.0.1.evil.test",
      "localhost.evil.test",
      "notlocalhost",
      "example.com",
    ])("rejects %s", (h) => expect(isLoopbackHost(h)).toBe(false));

    it("rejects missing/empty", () => {
      expect(isLoopbackHost(undefined)).toBe(false);
      expect(isLoopbackHost("")).toBe(false);
    });
  });

  describe("isLoopbackOrigin", () => {
    it.each(["http://localhost:5173", "http://127.0.0.1:3000", "http://[::1]:3000"])(
      "accepts %s",
      (o) => expect(isLoopbackOrigin(o)).toBe(true)
    );

    it.each(["http://evil.test", "https://example.com", "null", "not-a-url", ""])(
      "rejects %s",
      (o) => expect(isLoopbackOrigin(o)).toBe(false)
    );
  });
});

describe("originGuard — integration", () => {
  let h: TestDb;
  beforeEach(() => {
    h = makeTestDb();
  });
  afterEach(() => {
    h.cleanup();
  });

  const app = () =>
    createWebApp({
      db: h.db,
      llmAdapterFactory: defaultLLMAdapterFactory,
      apiKeyResolver: () => null,
    }).app;

  it("allows a loopback Host", async () => {
    const res = await app().request("http://localhost/api/health");
    expect(res.status).toBe(200);
  });

  it("BLOCKS a rebound Host on a read route", async () => {
    // The DNS-rebinding case: the browser dialled evil.test, which now resolves
    // to 127.0.0.1. Exfiltrating templates over GET is the interesting attack,
    // so reads must be guarded too — not just mutations.
    const res = await app().request("http://localhost/api/templates", {
      headers: { Host: "evil.test" },
    });
    expect(res.status).toBe(403);
  });

  it("BLOCKS a rebound Host on a mutating route", async () => {
    const res = await app().request("http://localhost/api/templates", {
      method: "POST",
      headers: { Host: "evil.test", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(403);
  });

  it("BLOCKS a cross-origin Origin even when Host is loopback", async () => {
    const res = await app().request("http://localhost/api/templates", {
      headers: { Origin: "http://evil.test" },
    });
    expect(res.status).toBe(403);
  });

  it("allows a loopback Origin", async () => {
    const res = await app().request("http://localhost/api/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(200);
  });

  it("does not leak the offending Host back in the response body", async () => {
    const res = await app().request("http://localhost/api/health", {
      headers: { Host: "evil.test" },
    });
    const body = await res.text();
    expect(body).not.toContain("evil.test");
  });

  it("guards /api/render too", async () => {
    const res = await app().request("http://localhost/api/render", {
      method: "POST",
      headers: { Host: "evil.test", "Content-Type": "application/json" },
      body: JSON.stringify({ source: "<mjml></mjml>" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a suffix-attack hostname that merely CONTAINS a loopback name", async () => {
    for (const host of ["localhost.evil.test", "127.0.0.1.evil.test"]) {
      const res = await app().request("http://localhost/api/health", {
        headers: { Host: host },
      });
      expect(res.status, host).toBe(403);
    }
  });
});
