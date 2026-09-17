import { parseMjml } from "./parser.js";
import { serializeMjml } from "./serializer.js";

/**
 * Collapse whitespace outside `<mj-text>` / `<mj-button>` content so cosmetic
 * indentation differences don't read as a lossy round trip; inside them
 * whitespace is user-visible and kept.
 *
 * Idempotent, and must stay so: callers compare normalized strings against
 * already-normalized ones.
 */
export function normalizeWhitespace(source: string): string {
  const protectedRanges: Array<{ start: number; end: number; body: string }> = [];
  const re = /<\s*(mj-text|mj-button)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const bodyStart = source.indexOf(">", m.index) + 1;
    // Search strictly within the match: `m.index + m[0].length` would find the
    // `<` of a tightly-packed sibling close tag (`</mj-text></mj-column>`).
    const closeStart = source.lastIndexOf("<", m.index + m[0]!.length - 1);
    protectedRanges.push({
      start: bodyStart,
      end: closeStart,
      body: source.slice(bodyStart, closeStart),
    });
  }
  function collapseOutside(s: string): string {
    return s
      // Strip inter-tag whitespace entirely, so `<a><b>` and `<a>\n  <b>`
      // normalize alike.
      .replace(/>\s+</g, "><")
      .replace(/\s+/g, " ")
      .trim();
  }
  let out = "";
  let i = 0;
  for (const r of protectedRanges) {
    out += collapseOutside(source.slice(i, r.start));
    out += r.body;
    i = r.end;
  }
  out += collapseOutside(source.slice(i));
  return out.trim();
}

export function assertRoundTrip(source: string): void {
  const parsed = parseMjml(source);
  const emitted = serializeMjml(parsed);
  const a = normalizeWhitespace(source);
  const b = normalizeWhitespace(emitted);
  if (a !== b) {
    const head = source.length > 200 ? source.slice(0, 200) + "..." : source;
    throw new Error(
      `Round-trip mismatch.\n  source (first 200): ${head}\n  normalized source: ${a}\n  normalized emitted: ${b}`
    );
  }
}
