/**
 * Loose MJML well-formedness check shared by routes that accept user-supplied
 * MJML. The parser is intentionally permissive (lossless-or-passthrough),
 * which means strings like `<<<not real mjml>>>` would pass `parseMjml`
 * silently — wrapped in a passthrough node. Routes need a stricter gate so
 * persisted/return-to-LLM mjml retains a recognisable document shape.
 *
 * Rule: must contain a `<mjml>` root tag, a `<mj-body>` tag, and parse
 * without throwing. Both `templates.ts` PATCH/POST and `query.ts`
 * server-side LLM-output validation MUST use this — NOT a per-file regex.
 */
import { parseMjml } from "./parser.js";

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
