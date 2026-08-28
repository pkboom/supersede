import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SettingsService,
  UnknownModelError,
} from "../../src/server/services/settingsService.js";
import {
  DEFAULT_MJML,
  TemplateService,
} from "../../src/server/services/templateService.js";
import { type TestDb, makeTestDb } from "../helpers/makeTestDb.js";

describe("services (integration)", () => {
  let h: TestDb;

  beforeEach(() => {
    h = makeTestDb();
  });
  afterEach(() => {
    h.cleanup();
  });

  describe("SettingsService", () => {
    it("get() lazily seeds the singleton with defaults", () => {
      const s = new SettingsService(h.db);
      const row = s.get();
      expect(row.id).toBe(1);
      expect(row.defaultProvider).toBe("anthropic");
      expect(row.defaultMode).toBe("cli");
      expect(row.defaultModel).toBe("claude-opus-4-7");
    });

    it("get() is idempotent — calling twice returns the same row", () => {
      const s = new SettingsService(h.db);
      const a = s.get();
      const b = s.get();
      expect(a.id).toBe(b.id);
    });

    it("update accepts opus and sonnet", () => {
      const s = new SettingsService(h.db);
      const sonnet = s.update({ defaultModel: "claude-sonnet-4-6" });
      expect(sonnet.defaultModel).toBe("claude-sonnet-4-6");
      const opus = s.update({ defaultModel: "claude-opus-4-7" });
      expect(opus.defaultModel).toBe("claude-opus-4-7");
    });

    it("update rejects unknown model with UnknownModelError", () => {
      const s = new SettingsService(h.db);
      expect(() => s.update({ defaultModel: "claude-haiku-4-5" })).toThrow(UnknownModelError);
    });
  });

  describe("TemplateService", () => {
    it("create defaults mjml and version", () => {
      const t = new TemplateService(h.db);
      const tpl = t.create({ name: "Welcome" });
      expect(tpl.mjml).toBe(DEFAULT_MJML);
      expect(tpl.version).toBe(1);
      expect(tpl.name).toBe("Welcome");
    });

    it("list returns summary without mjml body, ordered by updatedAt desc", () => {
      const t = new TemplateService(h.db);
      const a = t.create({ name: "A" });
      // small delay to ensure updatedAt differs
      const b = t.create({ name: "B" });
      const summaries = t.list();
      expect(summaries).toHaveLength(2);
      expect(summaries[0]).not.toHaveProperty("mjml");
      // B created after A so should appear first
      expect(summaries[0]?.id).toBe(b.id);
      expect(summaries[1]?.id).toBe(a.id);
    });

    it("get returns null for unknown id", () => {
      const t = new TemplateService(h.db);
      expect(t.get("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("update bumps version on success", () => {
      const t = new TemplateService(h.db);
      const tpl = t.create({ name: "X" });
      const r = t.update(tpl.id, 1, { name: "X-renamed" });
      expect(r.kind).toBe("ok");
      if (r.kind === "ok") {
        expect(r.row.version).toBe(2);
        expect(r.row.name).toBe("X-renamed");
      }
    });

    it("update returns stale on version mismatch", () => {
      const t = new TemplateService(h.db);
      const tpl = t.create({ name: "X" });
      t.update(tpl.id, 1, { name: "first" });
      const second = t.update(tpl.id, 1, { name: "second" });
      expect(second.kind).toBe("stale");
    });

    it("update returns not_found for unknown id", () => {
      const t = new TemplateService(h.db);
      expect(t.update("00000000-0000-0000-0000-000000000000", 1, { name: "x" }).kind).toBe(
        "not_found",
      );
    });

    it("delete returns true once, false thereafter", () => {
      const t = new TemplateService(h.db);
      const tpl = t.create({ name: "X" });
      expect(t.delete(tpl.id)).toBe(true);
      expect(t.delete(tpl.id)).toBe(false);
      expect(t.get(tpl.id)).toBeNull();
    });
  });
});
