import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeForComparison } from "../../src/html.js";
import { narrowProposal, proposeChange, readJob } from "../../src/job.js";
import { splitRequestWithLuna } from "../../src/pipeline/splitRequest.js";
import { GROUPS, buildEmails, fileName } from "./emails.js";

const hasKey = Boolean(process.env.OPENAI_API_KEY);

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "split-request-e2e-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function carries(value, expected) {
  const found =
    value.toLowerCase().includes(expected.toLowerCase()) ||
    normalizeForComparison(value).includes(normalizeForComparison(expected));
  expect(found, `${JSON.stringify(value)} does not carry ${JSON.stringify(expected)}`).toBe(true);
}

describe.skipIf(!hasKey)("split one request against Luna", () => {
  for (const [label, group] of Object.entries(GROUPS)) {
    it(label, async () => {
      const split = await splitRequestWithLuna(group.instruction);

      expect(split.instruction).toBe(group.instruction);
      carries(split.find, group.splitFindCarries);
      carries(split.replacement, group.splitReplacementCarries);
      expect(normalizeForComparison(split.find)).not.toContain(
        normalizeForComparison(group.splitReplacementCarries),
      );

      for (const file of buildEmails(group, [true])) writeFileSync(join(root, file.id), file.source);
      const job = readJob(root);

      const proposal = await proposeChange(job, split.find);
      expect(proposal.seed.id).toBe(fileName(0));
      for (const marker of group.elementCarries) carries(proposal.element.html, marker);

      const narrowed = await narrowProposal(job, proposal, split.replacement);
      carries(narrowed.change.from, group.spanCarries);
      expect(narrowed.determinism.status).toBe("deterministic");

      if (group.propertyChange) {
        expect(narrowed.change.interpretation).toBe("instruction");
        expect(narrowed.change.to.toLowerCase()).not.toContain(group.retires.toLowerCase());
      } else {
        carries(narrowed.change.to, group.splitReplacementCarries);
      }
    });
  }
});
