/**
 * Round-trip helper module — relocated from `src/server/fidelity.ts:24-49`.
 *
 * Purpose: shared `normalizeWhitespace` + an `assertRoundTrip` helper used by
 * property tests. NO server runtime path consumes this — the runtime
 * fidelity gate is being deleted (Lane C). After A-prime lossless passthrough
 * lands, `parse` then `serialize` is byte-equal modulo whitespace for any
 * input, so the assertion below is a useful guard for property tests but no
 * longer a gating runtime check.
 */
import { parseMjml } from "./parser.js";
import { serializeMjml } from "./serializer.js";

/**
 * Collapse whitespace runs *outside of* `<mj-text>` / `<mj-button>` content,
 * so cosmetic indentation differences between input and serializer output
 * don't trigger a false-positive lossy result. Inside text content we keep
 * the literal whitespace so user-visible formatting is meaningful.
 *
 * Strict-between-tags rule (Lane B addition): outside protected ranges, also
 * strip whitespace that sits *strictly between two tags* (`>` followed by
 * whitespace followed by `<`). Without this, a flush input `<a><b>` and an
 * indented input `<a>\n  <b>` normalize to different strings (the former
 * stays `<a><b>`, the latter becomes `<a> <b>`), which breaks the round-trip
 * property test for sources that happen to have no inter-tag whitespace.
 */
export function normalizeWhitespace(source: string): string {
  // Splice out content of mj-text and mj-button so we don't normalize their text.
  // The match boundary trick — `lastIndexOf("<", m.index + m[0].length)` —
  // breaks when the very next char after the close tag is `<` of a SIBLING
  // close tag (e.g. `</mj-text></mj-column>`): lastIndexOf returns the
  // sibling's `<` instead of the in-match close. Use `m[0].length - 1` so we
  // search strictly within the match.
  const protectedRanges: Array<{ start: number; end: number; body: string }> = [];
  const re = /<\s*(mj-text|mj-button)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const bodyStart = source.indexOf(">", m.index) + 1;
    const closeStart = source.lastIndexOf("<", m.index + m[0]!.length - 1);
    protectedRanges.push({
      start: bodyStart,
      end: closeStart,
      body: source.slice(bodyStart, closeStart),
    });
  }
  // Rebuild: outside protected ranges → collapse whitespace; inside → keep.
  function collapseOutside(s: string): string {
    return s
      .replace(/>\s+</g, "><") // strip inter-tag whitespace entirely
      .replace(/\s+/g, " ") // collapse remaining runs to single space
      .trim();
  }
  let out = "";
  let i = 0;
  for (const r of protectedRanges) {
    out += collapseOutside(source.slice(i, r.start)) + " ";
    out += r.body;
    out += " ";
    i = r.end;
  }
  out += collapseOutside(source.slice(i));
  return out.trim();
}

/**
 * Property-test helper: parse → serialize → compare. Throws an Error with a
 * useful message on mismatch so test output points at the specific input.
 */
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
