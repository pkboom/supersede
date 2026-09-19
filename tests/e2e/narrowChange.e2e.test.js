import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeForComparison } from "../../src/html.js";
import { narrowProposal, proposeChange, readJob } from "../../src/job.js";
import { GROUPS, SHAPES, buildEmails, fileName } from "./emails.js";

const hasKey = Boolean(process.env.OPENAI_API_KEY);

function applyChange(source, change) {
  const at = source.indexOf(change.from);
  if (at === -1 || source.indexOf(change.from, at + change.from.length) !== -1) {
    throw new Error("Refusing to apply a change that is not unique.");
  }
  return source.slice(0, at) + change.to + source.slice(at + change.from.length);
}

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "extract-pattern-e2e-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeJob(group, present) {
  for (const file of buildEmails(group, present)) writeFileSync(join(root, file.id), file.source);
  return readJob(root);
}

function carries(value, expected) {
  const found =
    value.toLowerCase().includes(expected.toLowerCase()) ||
    normalizeForComparison(value).includes(normalizeForComparison(expected));
  expect(found, `${JSON.stringify(value)} does not carry ${JSON.stringify(expected)}`).toBe(true);
}

function expectedPerFile(present) {
  return present.map((found, index) => ({
    file: fileName(index),
    occurrences: found ? 1 : 0,
    status: found ? "unique" : "absent",
  }));
}

describe.skipIf(!hasKey)("extract pattern against Luna", () => {
  for (const [label, group] of Object.entries(GROUPS)) {
    describe(label, () => {
      for (const shape of SHAPES) {
        it(shape.name, async () => {
          const job = writeJob(group, shape.present);

          if (!shape.present[0]) {
            await expect(proposeChange(job, group.find)).rejects.toThrow();
            return;
          }

          const proposal = await proposeChange(job, group.find);
          expect(proposal.seed.id).toBe(fileName(0));
          for (const marker of group.elementCarries) carries(proposal.element.html, marker);

          const narrowed = await narrowProposal(job, proposal, group.replacement);
          carries(narrowed.change.from, group.spanCarries);

          if (group.propertyChange) {
            expect(narrowed.change.interpretation).toBe("instruction");
            expect(narrowed.change.to.toLowerCase()).not.toContain(group.retires.toLowerCase());
            expect(narrowed.change.to).not.toContain(group.replacement);
          } else {
            carries(narrowed.change.to, group.replacement);
          }

          expect(narrowed.determinism.perFile).toEqual(expectedPerFile(shape.present));
          expect(narrowed.determinism.status).toBe(
            shape.present.every(Boolean) ? "deterministic" : "partial",
          );
          expect(narrowed.covered).toEqual(
            shape.present.flatMap((found, index) => (found ? [fileName(index)] : [])),
          );

          for (const file of job.files.filter((entry) => narrowed.covered.includes(entry.id))) {
            const applied = applyChange(file.source, narrowed.change);
            if (group.propertyChange) {
              expect(applied).toContain(group.survives);
              expect(applied).not.toContain(group.replacement);
            } else {
              carries(applied, group.replacement);
            }
          }
        });
      }
    });
  }
});
