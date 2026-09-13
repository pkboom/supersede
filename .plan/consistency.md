# Internal-consistency audit — PLAN-design-system.md

**Audited snapshot:** `PLAN-design-system.md`, 852 lines, mtime `Sep 13 15:06:13 2026`,
sha256 `60dcb47b57eaa715019f6fc7208931a7c81b96c5ce9f14bd93f9d1bc58e07bdb`.
The file was edited by another lane mid-audit (§8's properties-panel heading changed from
"needs four states" to "simplified by D-2" between my first and second read), so **every line
number below is against that snapshot**, not against whatever is on disk now. Re-anchor by
quoted text if they have drifted.

Cross-checked against `.plan/verdict-model.md`, `.plan/critique.md`, `.plan/factcheck.md`.

**26 defects: 7 critical, 8 high, 8 medium, 3 low.**

---

## CRITICAL — an implementer would build the wrong thing, or would stall

### C1. §12 does not exist. Line 40 promises it and the document ends at §11.

`:40` — *"The plan proceeds — but §12 restructures it so the bet is tested cheaply and early
rather than assumed and built on for eight weeks."*

There is no §12. The last heading in the file is `### Consequence for D-1` at `:841`; the
document ends at `:852`. §1's entire resolution of "this is a bet on an open question, taken
deliberately" is a forward reference to a section that was never written. Everything the brief
attributes to §12 — the v1 scope decision (tool-authored templates only), the build order, the
deferral of the API refactor / brands schema / UI / dep bumps — exists **only** in
`.plan/critique.md:508-560` and has never been merged into the plan.

Consequences that follow from this one absence: D17, D23 below, and the fact that §7 and §8
read as immediate work.

**Fix:** write §12 from `.plan/critique.md` Q5. The content is already drafted there —
Week 0 (three experiments), Week 1 (Phase 0 reduced and timeboxed), Weeks 2–4 (vertical slice,
tool-authored templates only, terminal output, no UI/brands/API refactor/auth), Week 5 (one
hand migration for a real agency), Weeks 6–8 (build what that agency asked for) — plus the
explicit "what this defers" list. Until it exists, `:40` is a dangling promise and the plan has
no stated build order.

### C2. `:3-4` — the status header is false in both halves.

> Status: DRAFT. Sections 1–4 are evidence-complete and independently verified by two lanes.
> Sections 5–8 are pending design-lane output and marked PENDING.

§5–§8 are fully written and cite completed design documents (`.plan/propagation.md` 795 lines,
`.plan/schema.md`, `.plan/api.md` 816 lines, `.plan/ui.md` 954 lines). The token `PENDING`
appears **nowhere** in the file. A reader who trusts the header skips §5–§8 as unwritten, or
reads them expecting drafts and gets asserted design.

**Fix:** replace with a status that names D-2 as the governing verdict, says §5 and §6 are
retained as history under supersession banners, and says §7/§8 are designed but deferred per
§12.

### C3. D-1 (`:631-682`) has no supersession banner, though §5 and §6 both do.

`:842-843` — *"D-1's re-derive-and-verify machinery was designed for copy-model merges. Under
reference, apply is a pin bump and the diff is expand-vs-expand, so most of that apparatus is
moot."*

That sentence sits **160 lines after** the apparatus it retires. An implementer reading §11
top-to-bottom hits D-1 first and reads 52 lines of live-looking decided design: a four-step
resolution with a 16-byte per-template hash pin (`:654-662`), `ApplyRequest` needing
`componentVersion` plus a **policy-set hash** (`:672-674`), `onConflict` granularity and
`Conflict.resolution` (`:675-677`), and two routes justified by *"a conflict row must show
base/component/instance"* and *"the merge base at `data-cmp-v`"* (`:681-682`). The policy set,
the conflicts and `data-cmp-v` were all deleted by D-2 (`:711-713`).

**Fix:** hoist `:841-852` into a banner directly under the `### D-1` heading at `:631`, in the
same shape as `:286`. State what survives (410-Gone plan supersession; version-addressed
component reads with `Cache-Control: immutable`; a drift endpoint that must not call
`mjml2html`; per-item atomicity with `prevMjml`) and mark the rest history. The surviving list
itself is stated clearly enough to build from — it is only its **boundary** that is unmarked.

### C4. `:437-440` — §7 ends on "Unresolved, pending §11" for a question §11 decided.

> ### Unresolved, pending §11
> Whether `components` is a reference or a copy decides the rest of this section.

D-2 (`:684`) decided it: reference. A schema implementer reading §7 cold reaches its final
subsection and is told the section's foundational question is open, in a document that answers
it 250 lines later.

**Fix:** retitle to "Resolved by D-2: reference". State the resulting table set from
`.plan/verdict-model.md`'s cost table — `components` + `component_revisions` + `component_usages`
— and note that the "cannot support pinning" objection at `:439-440` is answered by immutable
revisions, not by a second history table bolted onto a head row.

### C5. `:601-605` — §10.3 prescribes copy-model machinery, with an inverted safety bias.

> The actual guarantee is a **post-turn restore** that re-applies stamps structurally, reusing
> the addressing already in `stampPaths.ts`. Match conservatively on `(path, type)` and
> **prefer false negatives**.

There are no stamps to restore under D-2. The reference-model answer is the opposite mechanism
with the opposite bias: extract the `mj-component` reference multiset before and after the LLM
turn and **reject the turn (502) on any change** — `.plan/verdict-model.md` §5, and this
document's own `:732-739`. That is a hard gate, and "prefer false negatives" is exactly the
wrong disposition for a gate. This is the defect most likely to be *built*: it reads as a
concrete, actionable instruction naming a real file.

**Fix:** replace the paragraph with the multiset gate. Keep the `IDENTITY_ATTRS_NOTE` argument
at `:595-599` only if restated for `mj-component` rather than `data-cmp`.

### C6. `:620-623` — §10.7 is entirely dead and presented as a live risk.

> **Stamps are a visible, user-editable implementation detail.** An agency hand-editing MJML
> will see `data-cmp-i="a3f91c22"` and eventually delete it, or copy-paste a block and duplicate
> the instance id. Duplicates do not corrupt a run (**merges key by path**) but per-instance
> history silently merges two instances. **Detect and re-mint on write.**

`data-cmp-i`, instance ids, per-instance history and path-keyed merges all cease to exist under
D-2. "Detect and re-mint on write" is a work item for a mechanism that will not be built.

**Fix:** delete, or rewrite as the reference-model version of the same human-error risk: someone
hand-editing `<mj-component component-id="…" revision="…"/>` deletes or duplicates the tag —
caught by the multiset gate (C5) and the throw-on-survivor guard (`:811-822`), which is exactly
`.plan/verdict-model.md` §5's argument that a self-closing tag with a readable slug is harder to
mangle than four `data-*` attributes spread across a subtree.

### C7. `:614-619` — §10.6 states a decision criterion D-2 already overrode.

> **If preservation is below ~95%, attribute-based identity is the wrong choice** and the
> comment-marker and side-table options deserve reconsideration.

Attribute-based identity is no longer the choice, so the threshold triggers a reconsideration of
a decision that has already been reversed on other grounds. Two further errors in the same item:
*"Everything in §5 rests on stamps surviving the Claude rewrite path"* — §5 is superseded; and
*"the largest single uncertainty"* — that title now belongs to §11 experiment (b) (`:794-796`),
whose failure condition (`ov-*` count above ~3) is the one thing that would re-open D-2.

**Fix:** restate as reference-tag survival through the AI pane, point at the 502 gate, and demote
"largest single uncertainty" to experiment (b).

---

## HIGH — materially misleading, but an alert reader would catch it

### D8. §3.5 (`:94-122`) — the gate is stale in its example, its vocabulary, and its decision rule.

Three problems, ascending in importance:

- `:101` — the worked example is `<mj-text data-cmp="brand/copy">`, a copy-model stamp.
- `:110` — *"The stamp survives inside `rawXml`, but it is not addressable"* — copy-model framing.
- `:115-119` — **the decision rule is now wrong.** *"Opacity over ~20% → fix `parser.ts` first."*
  `.plan/verdict-model.md` §1 (probes E1/E5) established that an unregistered `<mj-component/>`
  parses to a passthrough **at its exact tree position** with `rawXml` equal to the tag, and that
  expansion is a string substitution that runs straight through an opaque `mj-wrapper` and
  produces compilable MJML. Opacity does not gate the reference engine the way it gated copy.

**Recommendation — restate, do not delete, and merge it with experiment (b).** The gate still
earns its afternoon, but it now decides something different. Specifically:

1. It is **not** redundant with the v1 tool-authored-templates scope (the §12-that-does-not-exist
   / `.plan/critique.md:517`). It is what tells you whether that scope is a boundary you are
   choosing or a defect you are hiding — critique.md says exactly this at `:512-515`.
2. What it now sizes is the **componentization/adoption cliff** at `:824-831`, not the engine's
   ceiling: how much of an incoming agency corpus can be found and rewritten into references at
   all.
3. `.plan/verdict-model.md`'s closing section states outright that §3.5's gate is **repurposed**
   into the `ov-*`-count experiment. In this document those are two separate, uncross-referenced
   experiments — §3.5 at `:113` and experiment (b) at `:794-796` — both described as "ten real
   templates", both an afternoon. **Merge them into one pass with two counts** and cross-reference
   from both sites.
4. Drop the `~20% → fix parser.ts first` trigger. Keep the `mj-wrapper` modelling argument, which
   survives on its own merits at `:555-561`.

### D9. `:345-347` — §6's banner omits a survivor that `:851-852` says survives.

The banner's survivor list is "the measured performance numbers, the 'blocked must not become
furniture' point, and detect-and-report for opaque nodes". But `:851-852` states that per-item
atomicity — *"each template row and its run-item carrying `prevMjml` must commit together, or
undo corrupts in one of two directions"* — also survives. That is §6's bullet at `:356-357`,
currently sitting under a banner that implies it does not.

**Fix:** add durable run records / `prevMjml` / per-item atomicity to the `:347` survivor list.

### D10. `:365-368` — an uncorrected copy of the claim the fact-check singled out.

> The serializer **re-indents everything**, drops valueless attrs, and collapses duplicate attrs,
> so the first diff on **any** template looks like the whole file changed.

`.plan/factcheck.md` #20 — *"This is the one claim I would not let ship as written"* — measured
0/10 lines changed on 2-space input and 1 line on a realistic template. §10.2 (`:575-582`) carries
the correction and explains why stating it universally is dangerous. The uncorrected original
survives 210 lines earlier, in §6. Two statements of one fact, one right and one wrong.

**Fix:** replace with the conditional wording, or delete it — under reference neither side of the
diff is re-serialized (`:697-703`), so the problem largely dissolves anyway.

### D11. `:210-211` — an uncorrected copy of factcheck #13.

> `normalizeWhitespace` … its own comments document **two off-by-one bugs** already fixed in it

§9 `:523-524` carries the correction: *"comments document **one** off-by-one (`m[0].length - 1`,
`roundTrip.ts:29-33`) plus one missing-normalization-rule fix (the `>\s+<` collapse, `:20-25`) —
not two off-by-ones."* The correction landed in §9 and not in §0.3.

**Fix:** `:210` → "two already-fixed defects in it, one of them an off-by-one."

### D12. `:477-487` — §8's reformat-noise subsection is copy-model, and trains the reader on a deleted UI.

The whole subsection presupposes a propagation diff that re-serializes. Under reference it does
not (`:697-703`: *"A reference bump changes one character"*). Worse, `:482` ends the argument with
*"a habit that later gets applied to **the conflict section**"* — D-2 deleted the conflict UI
(`:713`).

**Fix:** delete, or re-scope explicitly and narrowly to the **detach** path and to hand-edited
templates, where a re-serialize genuinely happens. Cut the "conflict section" clause either way.

### D13. `:490` — *"Unchanged means the merge was a no-op."*

No merge exists. **Fix:** "the pinned revision already matches" — one clause.

### D14. `:454-458` — §8 says the canvas overlay is free; §11 experiment (a) found it is not.

§8 concludes *"highlighting changed regions needs **no new backend field**."* Experiment (a)
(`:772-792`) **RAN AND FAILED** for `mj-section`, the likeliest component root, and its stated
consequence is: *"The canvas must instead address the **expanded** tree and map back to stored
positions, marking component interiors non-editable. **That is real, previously unscoped work**
and belongs in the cost table."* §8 is the section a UI implementer reads; it does not mention the
result. Related: `:449-452`'s "largest saving in the whole plan" is undercut by the same finding
and does not say so.

**Fix:** add experiment (a)'s result and its cost to §8; strike "no new backend field"; qualify
the "largest saving" claim.

### D15. `:624-625` — §10.8 is resolved twice over, and its figure contradicts D-1's table.

*"Plans persist `afterMjml` for the whole corpus — ~9MB per plan at 480 templates × 18KB."*

Resolved by D-1 step 3 (`:659`: *"Apply re-derives. Nothing large persisted"*) and again by D-2's
expand-on-demand. The text says neither. Separately, the two figures disagree: §10.8 says ~9 MB
for 480 templates; D-1's table at `:646` says full `afterMjml` = **1.06 MB** over the same 480
templates / 2,400 instances. One of them is counting only changed templates and neither says so.

**Fix:** mark resolved; reconcile or drop the 9 MB figure, stating which subset each counts.

---

## MEDIUM

### D16. `:164` — the one broken Phase 0 cross-reference.

> Identical output means the `settings.default_mode` drift (**§0.5**) is a false alarm

The `default_mode` drift lives in **§0.6** (`:247`, body at `:262-269`). §0.5 (`:231`) is the
stampPaths visibility item that was inserted ahead of it.

**I checked every Phase 0 cross-reference in the document; this is the only wrong one.**
`:90`, `:299`, `:304`, `:586`, `:587` → §0.2 ✓. `:240` → §0.4 ✓. `:268` → §0.1 ✓.
**Fix:** §0.5 → §0.6.

### D17. `:128` — the Phase 0 gate points at two superseded sections and omits the build order.

*"Nothing in §5–§8 may start before this lands."* §5 and §6 are superseded; §7 and §8 are
deferred by the §12 that does not exist. It also silently drops critique.md's accepted second
gate (`:558-561` there): *"nothing in §5–§8 should start before one real agency has tried the
component model at all."*

**Fix:** point at §12 once it exists, and restore the second gate.

### D18. `:547` — a botched in-place patch, mid-sentence.

> … it is closer to "templates where no copy block contains a `<b>`". **and** two of the seven
> modeled block types are `contentField:"text"` leaves whose realistic authored form contains
> inline HTML.

Lowercase sentence start after a full stop, and the fragment duplicates `:104-105` verbatim.
**Fix:** delete the fragment.

### D19. `:552-564` — §10.1's DECIDED block is measured in copy-model units.

*"`locateInstances` returns opaque instances with `status:"opaque"`"*; *"a template with two
identically-stamped buttons yields **1 of 2 reachable**."* The reference-model equivalents are
probes E1/E2/E5 in `.plan/verdict-model.md`. The `mj-wrapper` modelling argument and the
`RightPanel.tsx:579` finding (*"the product is instructing people into the hole"*) both survive
and are worth keeping verbatim.

**Fix:** keep the wrapper argument; restate the reachability measurement for `<mj-component/>`.

### D20. `:606-608` — §10.4 is sized for a blast radius the reference model does not have.

*"A propagation writing N templates while a user edits one of them, half-applying and then
409-ing on template #17."* Under reference each write is one attribute (`:702-703`), not a
whole-template rewrite. Still a real risk, roughly an order of magnitude smaller.

**Fix:** restate with the reference blast radius and cross-reference the 410-Gone supersession
rule at `:844-847`, which is the mechanism that actually addresses it.

### D21. `:609-613` — §10.5 is correct but does not point at its far worse sibling.

The same soft-validation mechanism applied to `mj-component` is the product's worst outcome —
`:804-822`: a footerless email sent to a client's list with HTTP 200 and no signal anywhere.
Risk 5 does not mention it.

**Fix:** one cross-reference to the throw-on-survivor guard.

### D22. `:415-416` — a copy-model justification attached to a possibly-surviving mechanism.

*"route token propagation through `<mj-attributes>` so bodies stay byte-identical."* The
byte-identical-bodies motive exists because copy's write path re-serializes the template. Under
reference it does not. The mechanism may still be wanted; the stated reason for it no longer
holds.

**Fix:** re-derive the justification or drop the clause.

### D23. §7 (`:377`) and §8 (`:442`) carry no deferral marker and read as immediate work.

An implementer reading §7 cold starts building the brands schema and the route refactor;
§8's headline file impact (`:445` — *"24 created, 11 modified, 0 deleted"*) reads as a sprint
plan. Per `.plan/critique.md:553-557` — which `:40` promises §12 will adopt — the brands schema,
the entire `.plan/api.md` route refactor, the UI lane and the dep bumps are all deferred to weeks
6–8, contingent on a design partner asking for them.

**Fix:** a one-line deferral banner at the head of each, pointing at §12. This is the defect the
brief asked about directly, and the answer is: **no, neither section acknowledges deferral.**

---

## LOW

### D24. `:247` — §0.6's heading says "two drifted facts"; the section covers four items.

README's absent Host check, `settings.default_mode`, `SettingsService.get()`'s INSERT-on-read,
and `package.json`'s description. The INSERT-on-read defect is not a drifted fact at all.

### D25. `:296` — *"So the stamp carries its own provenance."*

§5's banner says read the section as history, but this is the section's live concluding
assertion and it is now false. One clause; worth a strikethrough so the section's own conclusion
does not read as surviving.

### D26. `:89-90` — two live constraints are stranded inside a superseded section.

§3 correctly points at §5 for the charset constraint, and §5's banner correctly flags it as
surviving. But the two things that actually survive §5 — the `[A-Za-z0-9._/-]` charset rule (now
governing `ov-*` values and the `component-id` slug) and the impossibility of out-of-band
provenance — are buried in a section headed "SUPERSEDED IN PART", which is where an implementer
will *not* look.

**Fix:** promote both into §11's "Two decisions locked now" (`:835`), which already carries the
slug-not-UUID and entity-encoding rules and is where these belong.

---

## Checked and clean — no padding

- **§1 and §2.** The wiki-inversion correction landed completely and consistently; §1 now states
  the bet as contested and cites the wiki against itself correctly. The §2 LOC table matches
  `.plan/factcheck.md` #18 figure-for-figure, and the "32 lines, not 96" correction is present
  with its consequence stated.
- **§0.1's test figures.** Both withdrawn splits ("42 failed / 167 passed", "222 passed / 2
  failed") appear exactly once, at `:135`, explicitly labelled withdrawn and non-reproducing.
  Neither survives anywhere else in the document. The replacement figures (193 = 41 integration +
  152 unit; 2 failed / 229 passed from `.plan/scratch/` collection) match `.plan/factcheck.md` §C.
  **Clean — this is the correction handled best in the document.**
- **§0.2's linearity correction.** "exponential" appears exactly once (`:176`), inside the
  sentence that performs the correction. The measured series (9→13→17→21→25→29→33, +4/generation)
  matches factcheck #4. Clean.
- **§9 in full.** All three remaining fact-check corrections landed here and only here:
  "**second** largest file — `web/src/canvas/Canvas.tsx` is 1,229" (`:511`), "reaches via a **type
  assertion** (not a destructuring)" (`:527`), "**one** off-by-one … not two off-by-ones"
  (`:523-524`). Also correctly relocates the `console.warn` out of `stampPaths.ts` to
  `render.ts:72`. **§9 is the cleanest section in the document** and needs nothing.
- **Phase 0 cross-references** other than `:164` — all six verified correct (see D16).
- **D-2's own body (`:684-731`) and `:732-831`.** Internally consistent, correctly scoped, and
  honest about experiment (a)'s failure and experiment (b) being unrun. The "strongest argument
  against this verdict" section (`:748-771`) correctly converts into build order rather than
  hedging. No defects found.
