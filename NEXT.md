# Next

Plan: `ideas/PLAN-design-system.md` (2,125 lines, committed `855f3cd`).

Closed since the last pass: the drizzle journal hazard (`when: 1700000000000` restored — drizzle
keys re-runs on `folderMillis`, not the tag, so preserving that value is what stops a database
that already ran `0000` from re-running it); `phase0-foundation`, fully merged into master; the
tag-mismatch guard below; and the two flags that used to sit at the bottom of this file (master is
pushed and in sync, `.plan/` design records are committed with their supersessions marked).

## 1. Same-tag sibling swap — the part the guard does NOT catch

The previous item here (nothing stores or checks the expected tag) is **FIXED** in `855f3cd`.
Every `ov-at-<path>-<attr>` now requires a companion `ov-tag-<path>="mj-button"` and expansion
throws on mismatch — required rather than optional, because an opt-in guard on a silent-corruption
path is documentation, not a guard. An assertion with no matching override also throws, so a stale
guard cannot sit in a template looking like protection it no longer provides.

**What remains open is narrower and should not be written up as if it were the same problem.** Two
siblings with the *same tag* swapping places still resolves to the wrong one: `ov-at-2-href`
asserted as `mj-button` applies happily to the other `mj-button`. Renders 200, wrong link.

This is genuinely less urgent than the original hole — reordering two buttons inside one component
is rarer than reordering a button past a text block, and it needs a same-tag pair to exist at all.
It is listed because the fix above narrowed the failure without closing the class, and an
unrecorded residual becomes a claim that the class was closed.

Declared slots (§11) are the real answer and are not built. Do not reach for a second positional
mechanism to patch a positional mechanism.

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

## 4. Browser check on the expander changes — developer task

`render.ts` and the expander both changed after the last UI verification (below-root overrides,
then the tag assertion). Canvas click-selection depends on `stampMjmlPaths` and `mjml2html`
receiving the *same* expanded string; nothing in the suite covers the overlay. Per project
CLAUDE.md this is a developer test, so it is listed here rather than done.

## Flags, not tasks

- **`ideas/PLAN-design-system.md:1984` now contradicts the corrected §11.** The §12 table still
  reads "Above ~3 average, `ov-*` degenerates into the copy model and **D-2 re-opens**", which is
  the claim §11 was explicitly corrected to reject. Experiment (b) came back at 3.48, so that row
  currently instructs a reader to re-open a decision the plan elsewhere says stays closed. The §11
  correction is right; the table row was missed.
- **§12's gate above the gate still stands:** nothing in §7–§8 — brand scoping, auth, the API
  refactor, the largest block of work in the plan — before one real agency has touched the
  component model at all. Phase 0 landing does not open it. The brand-scoping refactor serves a
  multi-brand dimension that a single hand-run migration does not need.
