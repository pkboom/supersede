import { eq } from "drizzle-orm";
import type { DbHandle } from "../../db/index.js";
import { settings } from "../../db/schema.js";

export const ALLOWED_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];
export const ALLOWED_MODES = ["api", "cli"] as const;
export type AllowedMode = (typeof ALLOWED_MODES)[number];
export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODE: AllowedMode = "cli";
export const DEFAULT_MODEL: AllowedModel = "claude-opus-4-7";

const SINGLETON_ID = 1;

export interface SettingsRow {
  id: number;
  defaultProvider: string;
  defaultMode: string;
  defaultModel: string;
  updatedAt: Date;
}

export class UnknownModelError extends Error {
  constructor(model: string) {
    super(`Model "${model}" is not in the allowed list: ${ALLOWED_MODELS.join(", ")}`);
    this.name = "UnknownModelError";
  }
}

export class UnknownModeError extends Error {
  constructor(mode: string) {
    super(`Mode "${mode}" is not in the allowed list: ${ALLOWED_MODES.join(", ")}`);
    this.name = "UnknownModeError";
  }
}

/**
 * Singleton settings service. Always operates on the row with `id = 1`,
 * lazily creating it on first read.
 */
export class SettingsService {
  constructor(private readonly db: DbHandle) {}

  /**
   * Read the singleton, lazily creating it on first access.
   *
   * The lazy INSERT sits on a READ path, which is a latent defect worth being
   * explicit about (plan §0.6): two concurrent GETs could both miss the SELECT
   * and both attempt the INSERT, raising a primary-key violation out of a
   * plain read. Unreachable at one user; reachable at five.
   *
   * `onConflictDoNothing` makes the seed idempotent, and we re-read afterwards
   * rather than trusting the value we tried to write — so the loser of a race
   * returns the winner's row instead of a row that was never persisted.
   */
  get(): SettingsRow {
    const existing = this.db
      .select()
      .from(settings)
      .where(eq(settings.id, SINGLETON_ID))
      .limit(1)
      .get();
    if (existing) return existing;

    const seeded: SettingsRow = {
      id: SINGLETON_ID,
      defaultProvider: DEFAULT_PROVIDER,
      defaultMode: DEFAULT_MODE,
      defaultModel: DEFAULT_MODEL,
      updatedAt: new Date(),
    };
    this.db.insert(settings).values(seeded).onConflictDoNothing().run();

    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.id, SINGLETON_ID))
      .limit(1)
      .get();
    // The re-read can only miss if the row was deleted between our INSERT and
    // this SELECT, which nothing in the app does; fall back to the seed rather
    // than throwing out of a read path.
    return row ?? seeded;
  }

  update(patch: { defaultModel?: string; defaultMode?: string }): SettingsRow {
    if (patch.defaultModel !== undefined && !ALLOWED_MODELS.includes(patch.defaultModel as AllowedModel)) {
      throw new UnknownModelError(patch.defaultModel);
    }
    if (patch.defaultMode !== undefined && !ALLOWED_MODES.includes(patch.defaultMode as AllowedMode)) {
      throw new UnknownModeError(patch.defaultMode);
    }
    // Ensure the singleton exists.
    this.get();
    const setObj: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.defaultModel !== undefined) setObj.defaultModel = patch.defaultModel;
    if (patch.defaultMode !== undefined) setObj.defaultMode = patch.defaultMode;
    const updated = this.db
      .update(settings)
      .set(setObj)
      .where(eq(settings.id, SINGLETON_ID))
      .returning()
      .all();
    return updated[0] as SettingsRow;
  }
}
