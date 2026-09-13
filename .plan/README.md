# Design records — reasoning, not specification

These documents are **dated records of how decisions were reached**, committed
because `ideas/PLAN-design-system.md` states conclusions while the argument that
produced them lived only in untracked files. A decision whose reasoning is
untracked becomes folklore: the next person can see *what* was chosen but not
*what would change it*, so they either cannot revisit it or revisit it blind.

**They are not the current spec, and parts of them are now known wrong.** Where
a record and the plan disagree, the plan wins; where the plan and the code
disagree, the code wins. Read them for the argument, not the answer.

Known supersessions as of this commit:

- **`verdict-model.md`** adjudicated D-2 (reference vs copy) and made the verdict
  conditional on experiment (b). That experiment has since run against 39 real
  templates and **failed its threshold** (mean 3.48 differing attributes, 38%
  below the root). The stated consequence — "re-open D-2" — was itself wrong and
  is corrected in plan §11: the result says flat *root-only* overrides are
  insufficient, which is a scoping question, not a reference-vs-copy question.
- **`critique.md` / `consistency.md`** argue for modelling `mj-wrapper` as a
  container. **Withdrawn by measurement:** it is 5 of 219 opaque nodes (2.3%),
  and the cost is higher than assumed because mjml renders it structurally
  identically to `mj-section`.
- **`ui.md`, `api.md`, `schema.md`** describe §7/§8 work that is **deferred and
  unbuilt**. They are designs, not descriptions of anything that exists.
- **`.plan-research/blocks-audit.md`** predates the Phase 0 fixes; the entity
  double-escape and `normalizeWhitespace` issues it reports are fixed.

Throwaway probe scripts (`.plan/scratch/`) stay untracked.
