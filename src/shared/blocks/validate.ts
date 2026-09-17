import { parseMjml } from "./parser.js";

/**
 * Stricter than `parseMjml`, which is lossless-or-passthrough and so accepts
 * `<<<not real mjml>>>` by wrapping it. Anything persisted or handed back to
 * an LLM has to still look like a document.
 */
export function isParsableMjml(source: string): boolean {
  if (!/<\s*mjml\b/i.test(source)) return false;
  if (!/<\s*mj-body\b/i.test(source)) return false;
  try {
    parseMjml(source);
    return true;
  } catch {
    return false;
  }
}
