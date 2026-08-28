/**
 * blocks.attrsHelpers.test — covers `setAttr`, `deleteAttr`, `getAttr` from
 * `src/shared/blocks/attrsHelpers.ts`.
 *
 * Insertion-order invariants under test:
 *   - On UPDATE of an existing key, iteration order is unchanged.
 *   - On INSERT of a new key, the entry is appended.
 *   - On DELETE, remaining keys preserve their relative order.
 *
 * The property test uses fast-check to randomly drive a sequence of
 * insert/update/delete operations and compares the helper-driven Map's
 * iteration order to a reference list maintained by hand.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  deleteAttr,
  getAttr,
  setAttr,
} from "../../src/shared/blocks/attrsHelpers.js";

describe("attrsHelpers (deterministic)", () => {
  it("setAttr appends a new key at the end", () => {
    const m = new Map<string, string>();
    setAttr(m, "a", "1");
    setAttr(m, "b", "2");
    setAttr(m, "c", "3");
    expect([...m.keys()]).toEqual(["a", "b", "c"]);
  });

  it("setAttr on an existing key preserves the key's iteration index", () => {
    const m = new Map<string, string>();
    setAttr(m, "a", "1");
    setAttr(m, "b", "2");
    setAttr(m, "c", "3");
    setAttr(m, "b", "BEE");
    // Order unchanged; value updated.
    expect([...m.keys()]).toEqual(["a", "b", "c"]);
    expect(getAttr(m, "b")).toBe("BEE");
  });

  it("deleteAttr removes the entry while preserving the order of the rest", () => {
    const m = new Map<string, string>();
    setAttr(m, "a", "1");
    setAttr(m, "b", "2");
    setAttr(m, "c", "3");
    setAttr(m, "d", "4");
    deleteAttr(m, "b");
    expect([...m.keys()]).toEqual(["a", "c", "d"]);
  });

  it("getAttr returns undefined for a missing key", () => {
    const m = new Map<string, string>();
    expect(getAttr(m, "nope")).toBeUndefined();
  });

  it("setAttr after deleteAttr appends to the (now-shorter) end", () => {
    const m = new Map<string, string>();
    setAttr(m, "a", "1");
    setAttr(m, "b", "2");
    deleteAttr(m, "a");
    setAttr(m, "a", "1.b"); // re-insert: appended.
    expect([...m.keys()]).toEqual(["b", "a"]);
  });
});

// ---------------------------------------------------------------------------
// Property test: random insert/update/delete sequences
// ---------------------------------------------------------------------------

type Op =
  | { kind: "set"; key: string; value: string }
  | { kind: "del"; key: string };

const keyArb = fc.constantFrom(
  "a",
  "b",
  "c",
  "d",
  "e",
  "background-color",
  "padding"
);
const valueArb = fc.stringMatching(/^[A-Za-z0-9#%-]{1,8}$/);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant<"set">("set"),
    key: keyArb,
    value: valueArb,
  }),
  fc.record({ kind: fc.constant<"del">("del"), key: keyArb })
);

/**
 * Reference implementation: maintains an ordered list of keys + a value-bag.
 * Used to verify the Map's iteration order matches the spec.
 */
function applyOpsRef(ops: Op[]): { keys: string[]; values: Map<string, string> } {
  const keys: string[] = [];
  const values = new Map<string, string>();
  for (const op of ops) {
    if (op.kind === "set") {
      if (!values.has(op.key)) keys.push(op.key);
      values.set(op.key, op.value);
    } else {
      if (values.has(op.key)) {
        const idx = keys.indexOf(op.key);
        keys.splice(idx, 1);
        values.delete(op.key);
      }
    }
  }
  return { keys, values };
}

describe("attrsHelpers (property)", () => {
  it("preserves insertion order under random insert/update/delete sequences", () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 0, maxLength: 50 }), (ops) => {
        const m = new Map<string, string>();
        for (const op of ops) {
          if (op.kind === "set") {
            setAttr(m, op.key, op.value);
          } else {
            deleteAttr(m, op.key);
          }
        }
        const ref = applyOpsRef(ops);
        // Same iteration order, same set of keys.
        const observed = [...m.keys()];
        if (observed.length !== ref.keys.length) return false;
        for (let i = 0; i < observed.length; i++) {
          if (observed[i] !== ref.keys[i]) return false;
        }
        // Same value at every key.
        for (const k of ref.keys) {
          if (getAttr(m, k) !== ref.values.get(k)) return false;
        }
        return true;
      }),
      { numRuns: 200 }
    );
  });
});
