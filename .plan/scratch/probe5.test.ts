import { describe, it, expect } from "vitest";
import { parseMjml, serializeMjml, setAttr } from "../../src/shared/blocks/index.js";
import type { BlockNode, TreeNode } from "../../src/shared/blocks/index.js";
import { createHash } from "node:crypto";

function walk(n: TreeNode[], f: (x: TreeNode) => void) {
  for (const x of n) { f(x); if (x.type !== "__unknown__" && x.type !== "mj-custom-passthrough" && x.children) walk(x.children, f); }
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function makeTemplate(i: number): string {
  return `<mjml><mj-body width="600px">${Array.from({length:5},(_,k)=>`
    <mj-section background-color="#ffffff" padding="20px 0"><mj-column>
      <mj-text font-size="14px" color="#333333">Copy block ${i}-${k} with realistic prose length for a marketing email body.</mj-text>
      <mj-button data-cmp="b/btn" data-cmp-v="3" data-cmp-i="i${i}${k}" href="https://x.test/c/${i}/${k}" background-color="#1f6feb" color="#ffffff" border-radius="4px" font-size="16px">Shop now</mj-button>
    </mj-column></mj-section>`).join("")}</mj-body></mjml>`;
}

/** Simulates one propagation: set background-color + border-radius on every stamped button. */
function propagate(src: string): string {
  const doc = parseMjml(src);
  walk(doc.body, (n) => {
    if (n.type !== "mj-button") return;
    const b = n as BlockNode;
    if (b.attrs.get("data-cmp") !== "b/btn") return;
    setAttr(b.attrs, "background-color", "#c2185b");
    setAttr(b.attrs, "border-radius", "999px");
    setAttr(b.attrs, "data-cmp-v", "4");
  });
  return serializeMjml(doc);
}

describe("Is the rewrite actually deterministic? (api.md §2.3 rests on this)", () => {
  it("same input, 50 runs, interleaved with unrelated parses — identical bytes", () => {
    const src = makeTemplate(1);
    const first = propagate(src);
    const hashes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      // Interleave unrelated work to perturb the module-level nid() counter.
      parseMjml(makeTemplate(i + 100));
      serializeMjml(parseMjml(makeTemplate(i + 200)));
      hashes.add(sha(propagate(src)));
    }
    console.log("distinct output hashes across 50 interleaved runs:", hashes.size, [...hashes]);
    expect(hashes.size).toBe(1);
    expect(propagate(src)).toBe(first);
  });

  it("node ids are per-parse and DO change — confirming they never reach output", () => {
    const ids1: string[] = []; const ids2: string[] = [];
    walk(parseMjml(makeTemplate(1)).body, (n) => ids1.push(n.id));
    walk(parseMjml(makeTemplate(1)).body, (n) => ids2.push(n.id));
    console.log("first parse ids :", ids1.slice(0, 4).join(","));
    console.log("second parse ids:", ids2.slice(0, 4).join(","));
    console.log("ids differ between parses:", ids1[0] !== ids2[0], "| output still identical:", propagate(makeTemplate(1)) === propagate(makeTemplate(1)));
  });
});

describe("Payload sizes — what actually has to cross the wire", () => {
  it("480 templates: afterMjml vs rich-diff vs hash-only", () => {
    const N = 480;
    let mjmlBytes = 0, instances = 0;
    for (let i = 0; i < N; i++) {
      const after = propagate(makeTemplate(i));
      mjmlBytes += after.length;
      walk(parseMjml(after).body, (n) => { if (n.type === "mj-button") instances++; });
    }
    // A rich diff row: AttrChange {key, from, to, reason} as JSON.
    const oneChange = JSON.stringify({ key: "background-color", from: "#1f6feb", to: "#c2185b", reason: "component-update" });
    const changesPerInstance = 3;
    const richBytes = instances * changesPerInstance * oneChange.length
      + N * JSON.stringify({ templateId: "x".repeat(36), templateName: "Welcome Series — Email 2", templateVersion: 12, status: "clean" }).length;
    const hashBytes = N * 16;
    console.log(`instances=${instances} across ${N} templates`);
    console.log(`  full afterMjml : ${(mjmlBytes/1024/1024).toFixed(2)} MB   <-- api.md's objection, correct`);
    console.log(`  rich diff JSON : ${(richBytes/1024).toFixed(0)} KB       <-- the demo payload`);
    console.log(`  per-template hash: ${(hashBytes/1024).toFixed(1)} KB     <-- the integrity pin`);
    console.log(`  rich + hash    : ${((richBytes+hashBytes)/1024).toFixed(0)} KB`);
  });
});
