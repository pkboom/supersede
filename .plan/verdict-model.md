# Verdict — reference vs copy

**REFERENCE.** Templates store `<mj-component …/>`; component content lives once, in
immutable revisions; expansion happens server-side at render and export. Add one escape
hatch the copy lane's best argument demands — **detach**, a per-instance one-way conversion
to plain MJML — and the copy model's entire merge/drift/policy apparatus stops being
necessary rather than being deferred.

This overturns the api lane's lean (`.plan/api.md:71`). Its reason — *"the stored MJML must
be self-contained, inspectable, and hand-editable"* — conflates **storage** with
**delivery**. Nothing is sent from `templates.mjml`. The ESP receives expander output. The
only readers of the stored form are this product and whoever opens the SQLite file.

---

## What I ran

Everything below was executed against this repo's real `parser.ts`, `serializer.ts` and
`mjml@4.18.0` (scratch scripts under `$CLAUDE_JOB_DIR/tmp`, nothing written into the repo).
Raw results are inline. Five probes:

| # | Question | Result |
|---|---|---|
| E1 | `<mj-component/>` inside `mj-column`, unregistered | `PASSTHROUGH(mj-component)` **at the correct tree position**, `rawXml` = exactly the tag, round-trips |
| E2/E3 | reference tag vs. copy stamp inside `<mj-wrapper>` | both buried in one opaque `rawXml` blob |
| E5 | expansion as a string substitution through that wrapper | **works**; copy-model splice cannot |
| B2 | copy-model instance on rich text | `mj-custom-passthrough`, **`attrs` unreadable** — three-way merge is impossible on it |
| C | 5 parse/serialize cycles | reference tag byte-identical; copy instance corrupted to `&amp;amp;amp;amp;amp;amp;` |

---

## 1. Parser opacity — checked in the parser, not assumed

Both models are hidden by the same opacity. They are **not** damaged equally by it, and the
reason is structural, not incidental.

**What the parser actually does.** Three demote paths, all confirmed by execution:

- `parser.ts:304-311` — an unmodeled tag becomes `CustomPassthroughNode`. `registry.ts:33-153`
  models 9 tags; `mj-wrapper`, `mj-hero`, `mj-group`, `mj-table`, `mj-navbar`, `mj-carousel`,
  `mj-accordion`, `mj-raw` are not among them.
- `parser.ts:408-417` — a modeled child outside `allowedChildren` is demoted.
- `parser.ts:435-446` — **any leaf with element children** is demoted whole. This is the one
  that matters: `<mj-text><p>Hello <b>world</b></p></mj-text>` — the normal form of email
  copy — becomes opaque.

**E1, the load-bearing measurement.** An unregistered `<mj-component component-id="8f2a"
revision="4" />` inside `mj-column` parses to:

```
mj-section
  mj-column
    PASSTHROUGH(mj-component) raw="<mj-component component-id=\"8f2a\" revision=\"4\" />"
    mj-button attrs=[["href","#"]]
```

It is a **node at its exact position**, whose `rawXml` is the tag and nothing else, and
`serializeMjml` re-emits it verbatim (`serializer.ts:78-85`). Registering it per
`.plan/schema.md:111-113` promotes it to a real `BlockNode`; leaving it unregistered already
works. There is no third state where it disappears.

**E2 — the wrapper case, where the brief expects the reference model to lose.** It does get
buried: `<mj-wrapper>` swallows the subtree into one passthrough, reference tag included.
**And it does not matter**, because of an asymmetry in what each model has to do with what
it finds:

- The reference model must locate a **fixed-shape, self-closing token** and substitute a
  string for it. E5 ran exactly that through the opaque wrapper and produced correct,
  compilable MJML. The container's opacity is irrelevant: you never parse the container.
- The copy model must locate a **variable-shape subtree**, read its attrs, three-way merge
  them against a base, merge or replace its children, and splice the result back at a byte
  range inside `rawXml` that nothing tracks. Inside a passthrough, the inputs to that merge
  do not exist. `.plan/propagation.md:224` measures the consequence: *"stamps in stored
  source: 2 / stamps reachable as BlockNodes: 1"*, and the design's honest response is a
  new `"opaque"` instance status meaning *found, reported, not propagated*.

**The sharpest form of it (B2).** The copy model's *worst* opacity case is the reference
model's *easiest* case. A rich-text copy block as a copy instance:

```
copy-model rich-text instance node type: mj-custom-passthrough | attrs readable: false
```

Unmergeable. The same rich text as a **component body** under the reference model compiles
with zero errors and `<b>world</b>` intact — because opaque content that you store whole and
emit whole never needs to be understood. `.plan/propagation.md:174-217` calls rich text *"not
an edge case… the main case for copy blocks"*. The reference model deletes that entire
category of failure instead of classifying it.

**Caveat, stated because it fails closed and should stay that way.** A naive
`/<mj-component\b[^>]*?\/>/` misses a raw `>` inside an override value (probe A returned
`undefined`). The parser's own quote-aware `readElement` (`parser.ts:82-99`) handles it
correctly. So: the expander must use the parser's scan, not a naive regex, **and** all
`ov-*` values must be entity-encoded. Both failure modes leave an unexpanded reference,
which the mandatory "throw if any `mj-component` reaches the compiler"
(`.plan/schema.md:127`) turns into a 500 rather than a missing footer.

## 2. The dry-run diff — the reference model's is *better*, not worse

This was posed as possibly decisive against reference. It decides the other way.

"Revision 4 → 5" is not the diff, and nobody should ship it as one. The diff is
`expand(template, pins)` vs `expand(template, pins bumped)` — two strings, both pure
functions of stored data, both memoisable on `(componentId, revision)`. That is real
before/after MJML, and real before/after rendered HTML, exactly as the demo requires.

It is *cleaner* than the copy model's. The copy model cannot diff before against after,
because its own write path reformats the template; `.plan/propagation.md:600-615` has to diff
`canonicalBefore = serialize(parse(before))` instead, and explain the reformat away in a
line of prose. Probe D, on a realistic template:

```
line 6:  BEFORE <mj-text>Buy &amp; save</mj-text>
         AFTER  <mj-text>Buy &amp;amp; save</mj-text>
```

That is a `<mj-text>` with **no relationship to the component being propagated**, changed by
the act of propagating. Post-P1 the corruption goes away and quote-style normalisation
remains. The reference model's number is zero, because neither side of its diff is ever
re-serialized: probe D confirms a revision bump changes **one character** and leaves every
other byte identical.

Blast radius per propagation run: copy = every byte of 23 templates; reference = one
attribute value in each.

And the generalisation matters more than D1 itself. The copy model's write path is
"re-serialize the corpus", so **every** serializer fidelity defect — present or future —
becomes a corpus-wide data-loss event under a feature that runs unattended. Probe C:
5 cycles → `&amp;amp;amp;amp;amp;amp;`. D1 is fixable; the exposure is architectural.
`.plan/propagation.md:612` (*"canonical is idempotent? false"*) plus a round-trip gate with
zero call sites is what that exposure looks like when nobody is watching.

## 3. Per-instance overrides — reference supports them, and more simply

Agencies need per-instance text. The reference model's encoding is `ov-*` attributes on the
reference tag, consumed by the expander. `.plan/schema.md:822-826` admits this is
unthought-through; it is the one place the schema lane is genuinely behind. Probe B settles
the mechanical half:

```
after 5 parse/serialize cycles:
  <mj-component component-id="8f2a" revision="4" ov-text="Buy now" ov-href="https://x.test/?a=1&amp;b=2" />
```

Byte-identical, entity intact — because as a passthrough it bypasses `escapeAttrValue`
entirely. (Register it and D1 applies to `ov-href` until P1 lands. P1 must land regardless.)

The design half is *smaller* than the copy model's, not larger, and this is the crux:

- **No merge.** Expansion regenerates the instance from the definition every time, then
  applies the override. There is no base, no three-way resolution, no `unknown-base`
  degradation, no convergent-edit case, no conflict UI.
- **No drift.** An override is a literal attribute on the reference tag in the template. It
  cannot be silently reverted, because propagation only ever writes `revision`. Six drift
  detectors (`.plan/propagation.md:§5`), the `data-cmp-h` tripwire, and fingerprint-based
  orphan adoption exist solely to recover a distinction the copy model destroys at the
  moment it copies. The reference model keeps component content and instance content in
  different places, so it cannot be lost.
- **Two policies, not three.** An attribute is component-owned (no `ov-` accepted) or
  overridable. `locked`/`default`/`slot` collapses; so does `textPolicy`, whose default
  `.plan/propagation.md:425-434` correctly identifies as able to *"silently rewrite every
  button label in the brand… unrecoverable across 40 templates"*. The reference model has no
  code path that can do that.
- **Nested overrides reuse the copy lane's own design.** `ov-slot-headline="…"` matched
  against `<mj-text data-slot="headline">` in the component body is `childPolicy: "slot"`
  applied at expansion instead of at splice — same naming design, no merge engine under it.

## 4. Export and portability — near-parity; one real concession

Export is one function either way: copy strips `data-cmp*`, reference expands. Both produce
plain MJML, and D3 (`.plan/propagation.md:153-172`) confirms MJML drops `data-*` from HTML
anyway, so the copy model needs its strip step for the client's linter, not for correctness.

The honest concession: **at the raw-DB level the copy model degrades better.** `SELECT mjml
FROM templates` yields usable MJML; the reference model's dump yields `<mj-component>` tags
no other tool understands. Two mitigations, both cheap, both required from day one:

1. A bulk "export all templates as expanded MJML" endpoint. Not a nice-to-have — it is the
   thing that makes the answer to "what if we leave" one command.
2. **Key references by human-readable slug, not UUID** — `component-id="shoe-brand/footer"`,
   exactly as the copy lane keys `data-cmp`. `.plan/schema.md:89` uses `8f2a…`; a human
   reading raw MJML can act on the first and not the second. Costs nothing, decided now.

## 5. Hand-editing and the AI pane — reference is enforceable, copy is not

`query.ts:116` writes any LLM output that passes `isParsableMjml` straight to the row.

Under the copy model, stamp integrity is **unenforceable by construction**, and the design
says so: `.plan/propagation.md:329` — *"A drop is not fatal (the user may legitimately have
asked to remove a button)"*. The AI pane's whole purpose is editing the copied content, so
no post-check can distinguish a legitimate edit from stamp erosion. The mitigation is a
census that reports.

Under the reference model, the reference is opaque and the model has no legitimate reason to
touch one, so the check is a **hard gate**: extract the reference multiset before and after,
reject 502 on any change (`.plan/schema.md:120-126`). Same for a human editing raw MJML — a
self-closing tag with a readable slug is harder to mangle than four `data-*` attributes
spread across a subtree, and a mangled one fails loudly at expansion instead of quietly
detaching an instance.

The cost is real and belongs on the other side of the ledger: **"make the footer say X" stops
working in the AI pane**, and a component instance is not editable in place on the template
canvas (`.plan/schema.md:165-168` embraces this as design-system semantics — I agree, but it
is a UX loss and needs an "edit component →" affordance, not silence).

## 6. Cost to a demo-able dry-run in 8 weeks part-time — reference, clearly

Shared prerequisites, unaffected by this verdict: P1 entity fix, the N-generation round-trip
gate, the drizzle `meta/` fix. The reference model does not make these optional; it makes
them less catastrophic when they slip.

| Copy model | Reference model |
|---|---|
| `locateInstances` w/ 5 statuses | `usageExtractor` (parse → DFS → rows) |
| `mergeInstance` — 7-row three-way table, text policy, `unknown-base` degradation | — |
| `AttrPolicy` locked/default/slot + per-component policy UI | 2 policies, no UI beyond a checkbox |
| `childPolicy` owned/slot, slot-set-change blocking | same slot naming, no merge |
| `spliceComponent` | string substitution |
| plan table persisting full `afterMjml` for the corpus | expand-on-demand, memoised |
| `applyPropagationPlan`: per-template atomicity, abort fraction, `prevMjml` undo | rewrite one attr through existing `TemplateService.update` |
| 6 drift detectors + fingerprint orphan-adoption queue | — |
| `stampCensus` + prompt hardening (reports) | reference multiset gate (rejects) |
| conflict-resolution UI | — |
| — | `componentExpander` (recursive, memoised, depth cap, throw on survivor) |
| — | `stampPaths` stampable-leaf + `css-class` detector |
| — | `components` + `component_revisions` + `component_usages` tables |

The difference is not line count, it is **novel algorithm**. Three-way merge with a policy
model and six drift states is three weeks of building and then permanent support surface,
for a solo founder part-time. Expansion is a pure function plus a memo table.

Where reference costs *more*: the overlay. `.plan/schema.md:131-168` is right that a skipped
plan entry lets the next `mj-section` match the component's `<div>` and stamp everything one
element early while `stamped === expected`, so `render.ts:70` never warns. The fix (stampable
leaf + `css-class="mjcmp-<pathKey>"` detector + the one-root-element invariant at
`.plan/schema.md:160`) is sound but **unverified** — `.plan/schema.md:834-837` flags that
which element receives `css-class` varies by root type. **Verify that first, one round-trip
test per allowed root type.** It is the only place this verdict rests on an unexecuted claim.

## 7. Reversibility — the decisive asymmetry

- **Reference → copy is a function you will already have written.** Run the expander over
  every template, write the result back, stamp `data-cmp` from the reference attrs. ~40
  lines, deterministic, runnable per-template. You can migrate the whole corpus in an
  afternoon and land exactly the copy model's stored form.
- **Copy → reference is inference.** Find instances by stamp, prove each still matches some
  revision, and decide by hand what to do with every instance that doesn't — and
  `.plan/propagation.md:§5` is a catalogue of how much of that the copy model accumulates
  *by design*. Opaque and drifted instances cannot be converted without a human each.

Start with reference. If the merge machinery turns out to be genuinely wanted, expand into
it. The reverse trip does not exist.

---

## Hybrid

**H1 — store both the expansion and the reference, kept in sync.** Worst of both. Two copies
of one truth in a single text column, with no checksum and no invalidation, inside a blob an
LLM rewrites. Reject.

**H2 — per-component choice: footers by reference, buttons by copy.** Coherent, but it is the
*union* of both costs — you build the expander **and** the merge engine — to buy something
`ov-*` plus detach already gives. Reject.

**H3 — reference storage + per-instance detach. Recommended, and it is what makes the verdict
safe.** Detach expands one instance in place, drops the reference, and marks it detached in
the UI. Not a second engine: it is the expander you already wrote, invoked once, at the
user's request. This answers `.plan/api.md:71-74`'s real requirement — *"a designer must be
able to break from the component for one template without breaking the component"* — without
any merge machinery, and agencies will ask for it as a feature regardless of which model wins.

---

## The strongest argument against my own verdict

**The copy model is the only one whose stored artifact is the thing the customer bought.**

An agency's asset is 40 templates of MJML. Under the copy model that asset sits in the
database in its final form: greppable, diffable in git, hand-editable in any editor, openable
in any other MJML tool, and — critically — **intact if this product's expander has a bug or
the company disappears**. Under the reference model the stored form is a proprietary
intermediate that is worthless without the expander and the `component_revisions` rows, and
correctness now depends on a code path that runs on every render and every export. A bug in
the expander is not one bad template, it is every email that uses that component, and E2 +
probe A show the expander must reason about tags buried inside opaque blobs with quote-aware
scanning — the exact kind of code that is subtly wrong for months.

There is a second, sharper edge to it: mjml's soft validation **silently drops an unexpanded
reference** (probe A: `"Element mj-component doesn't exist or is not registered"`,
`component-id` reaches HTML: `false`, and the section still renders). A single expansion miss
is a footerless email sent to a client's list with a 200 response and no warning. The copy
model has no equivalent failure — its stored MJML is always complete. The hard-throw at
`.plan/schema.md:127` is what stands between the reference model and that outcome, and it is
one line of code protecting the product's worst possible failure.

I still come down on reference, because that one line is testable and the copy model's
equivalent exposure — unattended re-serialization of the entire corpus on every propagation
run, plus unmergeable rich text, plus six kinds of drift — is neither one line nor testable.
But the argument is real and it should shape the build order: **the throw-on-survivor guard
and the bulk export endpoint are week one, not week six.**

## What would have to be true for me to switch

1. **Per-instance overrides turn out to be the dominant workflow, not the exception.** If
   real agency usage is "every instance of this button differs", the reference model
   degenerates into a reference tag carrying ten `ov-*` attributes — at which point you have
   reimplemented the copy model with worse ergonomics. Signal to watch: average `ov-*` count
   per instance above ~3. The copy lane's own caveat (`PLAN-design-system.md`, *"the override
   model assumes instance edits are intentional and durable"*) is the same uncertainty from
   the other side.
2. **`css-class` does not survive compilation onto the element `stampPaths` matches**, for
   one or more allowed root types, and no other overlay anchor works. That breaks the canvas
   for every template using a component and is the reference model's only unverified
   load-bearing claim.
3. **Customers demand that stored MJML be directly portable** — someone reads the DB, or
   wants git-tracked template files. A bulk export endpoint is the mitigation; if it isn't
   accepted, the copy model wins on that requirement alone.
4. **Nested-component expansion costs more than the DAG argument promises.** The acyclicity
   claim (`.plan/schema.md:544-546`) is sound *because* revisions are immutable and pins are
   per-instance; if pins ever float, it evaporates and cycle detection becomes real work.

## The cheap experiment that de-risks the residual uncertainty

Two hours, before writing any schema:

1. Compile one component per allowed root type (`mj-section`, `mj-wrapper`, `mj-hero`) with
   `css-class="mjcmp-test"` injected, and assert `stampMjmlPaths` stamps the component as one
   consumed unit with `missing: []` and the *next* sibling section stamped correctly. This is
   item 2 above, and it is the only thing here I could not settle by reading and running the
   existing code.
2. Take ten real agency templates and count `ov-*`-shaped needs by hand: for each place a
   component would go, how many attributes differ per instance? Above ~3 on average, re-open
   this verdict. This is `PLAN-design-system.md:§3.5`'s opacity gate, repurposed — it is the
   same afternoon and it now answers the more decisive question.
