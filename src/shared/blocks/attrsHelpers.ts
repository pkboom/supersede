/**
 * Attr-Map mutation helpers (A-prime contract).
 *
 * Every modeled `BlockNode.attrs` is a `Map<string, string>` whose iteration
 * order IS the source order the MJML was authored in. The
 * serializer iterates this Map in insertion order and emits each `key="value"`
 * directly, so the Map's order IS the on-disk attr order.
 *
 * Insertion-order invariant:
 *   - On UPDATE of an existing key, JS `Map.set(key, value)` preserves the
 *     key's existing iteration index. We rely on this to keep the source's
 *     attr order stable when the right-panel form edits an existing attr.
 *   - On INSERT of a new key, the new entry is appended to the end of the
 *     iteration order. New attrs go after existing ones — minimal disruption.
 *   - On DELETE, remaining keys preserve their relative order.
 *
 * This file is the canonical mutation API for `BlockNode.attrs`. UI code
 * should NOT touch the Map directly — go through these helpers so the
 * insertion-order intent is documented at every call site.
 */

export function setAttr(
  attrs: Map<string, string>,
  key: string,
  value: string
): void {
  // Map.set preserves insertion index when key already exists, appends when
  // new — exactly the A-prime invariant.
  attrs.set(key, value);
}

export function deleteAttr(attrs: Map<string, string>, key: string): void {
  attrs.delete(key);
}

export function getAttr(
  attrs: Map<string, string>,
  key: string
): string | undefined {
  return attrs.get(key);
}
