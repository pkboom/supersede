# Next

Plan: `ideas/PLAN-design-system.md` (2,106 lines, committed `f231f1e`).

Closed since the last pass: the drizzle journal hazard (`tag: "0000_initial"`,
`when: 1700000000000` — restored, so a database that already ran `0000` will not re-run it),
and `phase0-foundation`, which is fully merged into master.

## 1. Tag-mismatch guard on `ov-at-<path>-<attr>` — open code defect

The only defect the measurement created, and it is not mitigated anywhere.

- `src/shared/components/types.ts:65` defines `PATH_PREFIX`
- `src/shared/components/expander.ts:205` parses the path
- **Nothing stores or checks the expected tag.**

Excluding comments from the path protects against someone adding a comment. It does **not**
protect against r5 rearranging the component interior, after which `ov-at-2-href` silently
resolves to a different node — the exact drift the reference model was chosen to eliminate,
arriving through the override mechanism.

**Minimum fix, cheaper than retrofitting declared slots:** store the expected tag alongside the
path and throw at expansion when it no longer matches. Failing loudly at expansion is the whole
point; a wrong-node override renders 200 with the wrong content.

## 2. Measure one real brand corpus

`npm run measure -- <dir>` — recursive, `.mjml` only, JSON out.

The number that should govern the below-root decision has never been measured. The 38% below-root
share comes from 39 public template-library files (mjmlio/email-templates 25, Mailteorite 14),
and template libraries are *varied showcases* by design, so a consistent brand system should
measure lower. If a real brand comes back under 3 with a low below-root share, the below-root
machinery is still correct — a card's CTA is below its root either way — but far less urgent than
the current table implies.

Blocker is the corpus, not the tooling. **Not Inbox Monster client templates** — that crosses the
adjacent/non-competing line.

## 3. §12 Week 0 — Email Geeks Slack, half a day

Read for the modular-reuse complaint. §1 is a **contested bet**, not a settled one, and the plan
calls this "the only step that de-risks" it; the research wiki flags it twice as the one demand
source never reached. Cheapest item on this list, and it gates the most.

## Flags, not tasks

- **master is 18 commits ahead of origin, unpushed.** Deliberate or not is your call.
- **§12's gate above the gate still stands:** nothing in §7–§8 — brand scoping, auth, the API
  refactor, the largest block of work in the plan — before one real agency has touched the
  component model at all. Phase 0 landing does not open it. The brand-scoping refactor serves a
  multi-brand dimension that a single hand-run migration does not need.
