/**
 * The canonical mutation API for `BlockNode.attrs`, whose iteration order is
 * the order the MJML was authored in and the order the serializer emits.
 * `Map.set` keeps an existing key's position and appends a new one, which is
 * exactly the intent; going through these helpers keeps that on the record at
 * every call site.
 */

export function setAttr(
  attrs: Map<string, string>,
  key: string,
  value: string
): void {
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
