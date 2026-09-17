# Component Propagation Engine — design

> **STATUS: the copy model this document designs has been overruled.**
> `.plan/verdict-model.md` selects the **reference** model
> (`<mj-component …/>` + server-side expansion). I ran its one unverified
> load-bearing claim and **it fails** — see §-1 — which sharpens the build
> order rather than reversing the verdict. §-1 records what carries over and
> what is now dead. Everything below §0 is preserved as written, because the
> measurements in it are still evidence and three of its sections transfer
> intact.

---

## -1. The model fork — conceded, with three measurements that change the build order

`verdict-model.md` is right and I am not going to defend my turf. Its decisive
arguments, in my own words, are ones my document already contained without
drawing the conclusion:

- **My worst case is its easiest case.** §0/D4 calls rich `<mj-text>` *"not an
  edge case… the main case for copy blocks"*, and my only answer was to classify
  it `opaque` and report it. Content you store whole and emit whole never needs
  to be understood, so the reference model deletes the category instead of
  cataloguing it.
- **Drift is self-inflicted.** The six detectors in §5, the `data-cmp-h`
  tripwire, and fingerprint orphan-adoption exist to recover a distinction that
  the copy model destroys at the instant it copies. Keeping component content
  and instance content in different places means it cannot be lost.
- **Blast radius is architectural, not a bug.** My own §3 measured
  `canonical is idempotent? false`. The copy model's write path is
  "re-serialize the corpus", so every serializer fidelity defect — present or
  future — becomes a corpus-wide data-loss event under a feature that runs
  unattended. P1 fixes D1; it does not fix the exposure.
- **Reversibility.** Reference → copy is the expander you already wrote.
  Copy → reference is inference over exactly the drifted and opaque instances
  §5 says will accumulate. The reverse trip does not exist.
- **`textPolicy`.** My §2 defends a conservative default against silently
  rewriting every button label in a brand. The reference model has no code path
  that can do it. Structural beats conservative.

### The three measurements (`.plan/scratch/probe6.test.ts`, `probe7.test.ts`)

**(1) The verdict's only unverified claim FAILS for the likeliest root type.**
It flagged `css-class` as needing verification "first". `schema.md` proposes
`css-class="mjcmp-<pathKey>"` as the overlay anchor. Measured — which element
actually receives `data-mjml-path`, and does it carry the class:

```
--- mj-section ---
  path="0"     on <table> class="(no class attr)"                              hasCssClass=false
  path="0/0"   on <div>   class="mj-column-per-100 mj-outlook-group-fix"       hasCssClass=false
--- mj-column ---
  path="0/0"   on <div>   class="mj-column-per-100 mj-outlook-group-fix mjcmp-test"  hasCssClass=true
```

For `mj-section`, mjml puts `css-class` on an outer `<div>` and a
`<table class="…-outlook">`, while `stampPaths` stamps a **bare `<table>` with
no class attribute at all**. The anchor works for `mj-column` and **not** for
`mj-section` — the most likely component root. `mj-wrapper` and `mj-hero` stamp
`0/0` (nothing stampable), so the question does not arise for them.

This does not reverse the verdict, because a working anchor exists and the same
probe found it: stamp the **expanded** source rather than the stored source
(next finding, right-hand result). But `css-class` as specified must be dropped,
and the canvas then addresses the expanded tree and must map back to stored
positions and mark component interiors non-editable. That is real, unscoped work
and it belongs in the cost table.

**(2) The silent off-by-one is real, and worse than described.** Stamping the
**stored** (unexpanded) source against **expanded** HTML:

```
stamped=3/3 missing=[]      <- render.ts warns only if stamped < expected
  top-level path="1" -> <table> background=#111111   <<< FOOTER (WRONG)
```

The reference tag is skipped by `buildStampPlan`, so the plan's next entry
matches the first rendered section — the component's own output. Every canvas
click on that section selects and edits the wrong block, `stamped === expected`,
and `render.ts:70` never warns. Stamping the expanded source instead gives
`stamped=6/6 missing=[]`, correct. **`render.ts` must expand before both
`mjml2html` and `stampMjmlPaths`**, and the two must be given the same string.

**(3) The worst failure is confirmed, and it is one line of code away.** An
unexpanded reference reaching the compiler:

```
errors: ["Element mj-component doesn't exist or is not registered"]
component-id reaches HTML? false
rest of the email still renders?  true
```

mjml **silently drops it** under soft validation and returns HTTP 200. The
warning lands in `result.errors`, which `render.ts:60-63` destructures and never
reads. A single missed expansion is a footerless email sent to a client's list
with no signal anywhere. This confirms `verdict-model.md`'s own "strongest
argument against my verdict" and upgrades `schema.md:127`'s throw-on-survivor
from good practice to **the single line standing between this product and its
worst outcome**. Week one, with a test, and `render.ts` should read `errors`
rather than discarding them.

### Contracts this lane is owed, recorded next to the evidence for them

These came out of the measurements above and are specced in `.plan/ui.md`
(§5.5, §5.6) and with schema-designer. They are listed here because this is the
document that holds the evidence justifying them, and a contract separated from
its evidence is the first thing to get negotiated away.

1. **`componentExpander` must return provenance, not a string.**
   `{ mjml, regions: ExpansionRegion[] }`, each region carrying
   `{start, end, expandedPathRange, componentId, revision, instancePath,
   overridable}`. Justified by finding (2): the overlay must stamp the expanded
   source, and nothing on the stamped side knows where in the source a path came
   from — `BlockNode`, `PlanEntry` and `StampResult` all lack offsets, and
   `parser.ts` discards `el.start`/`el.end` after slicing `rawXml`.
   `expandedPathRange` makes the join path-to-path so byte offsets never need to
   leave the server. This is a return-type change to an unwritten module: free
   today, expensive once it has callers.
   `overridable` must be keyed by inner path within the **outermost** region and
   **not partitioned per region**, or it breaks silently if `schema.md:1304`'s
   open below-root-slot question resolves toward declared slots.

2. **`expansionErrors[]` on the render contract, fed by two independent
   detectors.** `schema.md:951`'s throw-on-survivor guard fires only if the
   expander knows it should have expanded something; a bug in the guard, or a
   reference it never recognised, passes straight through. mjml's own
   `result.errors` catches exactly that class — a different layer with a
   different failure mode. A second check that fails whenever the first does is
   decoration. Disagreement between the two is itself a signal, and should be
   surfaced rather than reconciled silently. Cost is near zero: `errors` is
   already being read.

3. **The throw-on-survivor guard must cover export, not only render.** Finding
   (3) measured the failure: mjml silently drops an unexpanded reference and
   returns 200. A render that 500s is a visible, recoverable annoyance; an
   export that silently omits a footer leaves the building. `schema.md:954` puts
   bulk export in week one, so this is urgent rather than eventual.

4. **`render.ts` must read `result.errors`.** It currently destructures and
   discards them (`render.ts:60-63`), which is the proximate reason finding (3)
   is silent. Feeds both item 2 and the `data-cmp*`/`mj-component` noise filter
   from §9/P3.

### The gap in the verdict's cost table: adoption

Neither `verdict-model.md` nor `schema.md` costs **componentization**. An agency
arrives with 40 templates of literal `<mj-button>`s. Before a single reference
exists, something must find the recurring instances, decide which are the same
component, and rewrite them as `<mj-component/>`. That is `locateInstances` plus
§5(a)'s locked-attr fingerprint matcher plus a human review queue — a meaningful
slice of this document's machinery, needed **once, as migration tooling**, not
as permanent support surface. It does not change the verdict (one-time migration
is far cheaper than a permanent merge-and-drift engine) but it is missing from
the table, and §1/§5(a) here are the design for it.

Secondary omission: "make the footer say X" must be **routed** from the template
to the component in the AI pane. `verdict-model.md` §5 names the UX loss but
costs no work for the routing.

### What carries over, and what is dead

**Dead:** §2 entirely (three-way merge, `AttrPolicy`, `childPolicy`,
`mergeInstance`, `spliceComponent`) — the reference model has no merge.
Most of §5 (six drift detectors, `data-cmp-h`) — drift is a copy-model artifact.
`data-cmp`/`data-cmp-v`/`data-cmp-i` as a *stamping* scheme.

**Carries over unchanged:**
- **§8, the round-trip gate.** Unconditional. Both models parse and serialize.
- **§9 preconditions P1, P3, P5, P6.** P1 (entity double-escape) still blocks:
  the reference tag survives as a passthrough, but `ov-*` overrides on a
  *registered* `mj-component` go through `escapeAttrValue`. P3 is now sharper —
  soft mode is what makes finding (3) silent.
- **§3's payload shape.** `PropagationPlan` / `TemplatePlan` / `AttrChange` still
  describe a revision-bump dry run; the diff source becomes
  `expand(template, pins)` vs `expand(template, pins+1)`. The 256 KB body-cap
  finding and per-template lazy loading are model-independent, and the UI lane
  has built against them.
- **§4's failure model.** Per-template atomicity, pre-validation, `prevMjml`
  undo, abort-fraction — all apply to rewriting one attribute.
- **§6's performance numbers**, and the finding that `mjml2html` at 14.6 ms
  dominates parse+serialize at 2.15 ms by 7×. Under the reference model
  expansion is memoisable, so this improves.
- **§7's detect-and-refuse principle.** The category shrinks but never empties:
  a reference inside `<mj-wrapper>` is still buried, and `unreachable` must stay
  a first-class bucket rather than folding into "unchanged".
- **§1's fingerprint matcher and §5(a)**, repurposed as adoption tooling above.

---

Scope: the pivot feature. An agency edits a shared component (a brand's primary
button); every template using it updates. This document verifies the data-model
assumption that makes it cheap, designs the engine, and lists where the design
is wrong.

Evidence lives in `/Users/keunbae/code/email-design-system/.plan/scratch/`
(`propagation-proof.test.ts`, `probe2.test.ts`, `probe3.test.ts`, `bench.test.ts`).
They are scratch, not suite members. Run with
`npx vitest run .plan/scratch/<file>`.

---

## 0. The critical assumption: VERIFIED, with four defects that change the design

The `types.ts` A-prime claim holds. Custom `data-*` attributes on modeled tags
land in `BlockNode.attrs`, survive serialization in source order, and are stable
across repeated cycles. Component identity **can** be stamped as attributes and
"find every instance of component X" **is** a tree walk.

`PROOF 1/2` — 16 assertions, 15 passed:

```
BUTTON attrs order: [
  [ 'data-cmp', 'shoe-brand/primary-button' ],
  [ 'data-cmp-v', '7' ],
  [ 'href', 'https://x.test' ],
  [ 'background-color', '#1f6feb' ],
  [ 'color', '#ffffff' ],
  [ 'border-radius', '4px' ]
]
SECTION attrs order: [
  [ 'data-cmp', 'shoe-brand/hero' ], [ 'data-cmp-v', '3' ],
  [ 'background-color', '#fff' ]
]
```

- `serialize(parse(x))` is **byte-identical** to `x` when `x` is already in the
  serializer's canonical form. 10 successive cycles: no drift.
- Attr insertion order is exact — `data-*` stamps stay in front of the modeled
  attrs where they were written.
- `setAttr` on a stamped node preserves stamp position:
  `<mj-button data-cmp="b/btn" data-cmp-v="1" href="#" color="#000" background-color="#f00">`
- Unmodeled tags keep stamps inside `rawXml` verbatim:
  `<mj-wrapper data-cmp="brand/wrapper" data-cmp-v="2">…` re-emits unchanged.
- `stampMjmlPaths` is unaffected: `stamped=3 expected=3 missing=[]` on stamped
  source.

So the core bet is good. But the probes turned up four things that constrain the
design, one of which is a **blocking pre-existing data-corruption bug**.

### D1 (BLOCKING) — the serializer double-escapes entities on every cycle

`parser.ts` configures fast-xml-parser with `processEntities: false`, so
`attrs` and `text` hold the **raw, still-encoded source text**. `serializer.ts`
then escapes `&` again on the way out. Every parse→serialize cycle doubles the
escaping, without bound. This has nothing to do with stamps — it is the vanilla
path, and every real email hits it (`?utm_source=x&amp;utm_medium=y`).

`probe2.test.ts`, case A, on a template with **no** `data-*` at all:

```
cycle 1: <mj-button href="https://x.test/?a=1&amp;amp;b=2">Buy &amp;amp; save</mj-button>
cycle 2: <mj-button href="https://x.test/?a=1&amp;amp;amp;b=2">Buy &amp;amp;amp; save</mj-button>
cycle 3: <mj-button href="https://x.test/?a=1&amp;amp;amp;amp;b=2">Buy &amp;amp;amp;amp; save</mj-button>
cycle 4: <mj-button href="https://x.test/?a=1&amp;amp;amp;amp;amp;b=2">Buy &amp;amp;amp;amp;amp; save</mj-button>
```

Bare `&` in text corrupts the same way (`A & B` → `A &amp; B` → `A &amp;amp; B`).

The repo's own `assertRoundTrip` catches it immediately:

```
assertRoundTrip: Round-trip mismatch.
  source (first 200): …<mj-button href="https://x.test/?a=1&amp;b=2">Buy &amp; save…
```

**`assertRoundTrip` has zero call sites.** `grep -rn assertRoundTrip` outside
`roundTrip.ts` returns nothing; `fast-check` is used only in
`blocks.attrsHelpers.test.ts` and `blocks.headEdit.test.ts`. The documented
round-trip property test does not exist, which is why a bug this loud survived.

This is not an oversight I inferred — it is recorded. `OPERATIONS.md:163-172`,
under "Test coverage gaps":

> The block-primitive fixture-based tests (`blocks.{parser,serializer,roundtrip}.test.ts`
> and the property-test grammar generator) were removed because their fixture
> dir was destroyed in a Phase 10 cleanup. […] **the explicit round-trip
> invariant is no longer formally asserted at the unit layer**. A follow-up
> should rewrite the property-based generator and a small hand-curated fixture
> set to restore that gate.

The gate was deleted by accident and never rebuilt. §9 specifies what restoring
it must look like; it is a hard prerequisite, not a follow-up.

Propagation is *defined* as N parse/serialize cycles over a corpus. Shipping it
on top of D1 means every propagation run silently mangles every URL query string
and every ampersand in every template it touches. This must be fixed first.

**The fix, verified** (`probe3.test.ts`): since `attrs`/`text` already hold
encoded source text, the serializer must not re-encode. Drop `escapeText`
entirely; in `escapeAttrValue` keep **only** `"` → `&quot;` (needed because the
parser normalizes single-quoted source attrs and the serializer always emits
double quotes) and drop the `&` and `<` replacements.

```
case 0: <mj-button href="https://x.test/?a=1&amp;b=2">Buy &amp; save</mj-button>   stable x5 ✓
case 1: <mj-text data-cmp-lock="{&quot;attrs&quot;:[&quot;color&quot;]}">Caf&eacute; &mdash; 5 &lt; 10</mj-text>  stable x5 ✓
case 2: <mj-image src="https://c.test/i.png?w=1&amp;h=2" alt="A &quot;quoted&quot; alt" />  stable x5 ✓
```

Case 1 is byte-*different* from its source only in quote style
(`'{"a":1}'` → `"{&quot;a&quot;:1}"`), which is semantically identical and
idempotent thereafter. That is the correct invariant to promise, and it is
weaker than what `types.ts` currently implies:

> **Invariant to adopt:** `attrs` and `text` hold verbatim source fragments,
> already entity-encoded. Mutators (`setAttr`, inline text editor, AI pane)
> encode on entry. The serializer encodes nothing except `"` inside attribute
> values. `serialize(parse(x))` is idempotent for all `x`; byte-equal to `x`
> for all `x` in canonical form.

Without that invariant, an attribute is not a safe place to keep component
identity, because everything else in this design assumes attribute values
survive arbitrarily many rewrites unchanged.

**Do not "fix escaping" globally.** `headEdit.ts` double-escapes *deliberately*
and it is asserted: `blocks.headEdit.test.ts` case (iv) requires
`expect(next).toContain("&amp;amp;end")`. The contracts differ and only look
alike. `headEdit`'s `setTitle`/`setPreheader` receive **decoded** text from a UI
field and must encode on entry; the serializer receives **already-encoded**
source fragments and must not. The P1 fix touches `serializer.ts` only —
`escapeText` and `escapeAttrValue` — and must leave `headEdit.ts`,
`mjAttributes.ts` and their tests alone.

### D2 — valueless attributes are silently dropped

```
BOOL node type: mj-button attrs: [ [ 'href', '#' ] ]
BOOL out: <mj-button href="#">x</mj-button>
```

`<mj-button data-cmp-locked href="#">` loses `data-cmp-locked` entirely. Design
consequence: **every stamp must be a valued attribute.** Never
`data-cmp-locked`, always `data-cmp-lock="1"`. (This is also a latent data-loss
bug for hand-authored MJML, worth its own fix; it is not blocking for us because
we control stamp shape.)

Related, same class: duplicate attribute names collapse last-wins
(`data-cmp="a" data-cmp="b"` → `data-cmp="b"`). Harmless here, noted.

### D3 — MJML itself rejects `data-*`, and strips it from rendered HTML

```
MJML errors: [{"line":3,"message":"Attributes data-cmp, data-cmp-v are illegal","tagName":"mj-section"}, …]
data-cmp reaches HTML? false
STRICT result: Error: ValidationError: … Attributes data-cmp, data-cmp-v are illegal
```

Three consequences:

1. `render.ts` uses `validationLevel: "soft"` and ignores `result.errors`, so
   preview works today. Anything that ever surfaces `errors` to the user will
   fill with stamp noise; filter `data-cmp*` out at that boundary.
2. Anyone flipping to `"strict"` breaks the entire product. Add a test that pins
   `"soft"`.
3. **Stamps never reach the rendered HTML.** You cannot use `data-cmp` as a
   canvas overlay anchor — `stampMjmlPaths`' positional `data-mjml-path` remains
   the only overlay mechanism, and it is recomputed per render, which is fine.
   It also means a **strip-on-export** step is mandatory: what goes to an ESP
   must be de-stamped, or the client's own MJML linting will light up.

### D4 — a large share of real templates is opaque to a tree walk

Two structures collapse whole subtrees into `CustomPassthroughNode`, where
attrs are unreachable and only `rawXml` exists:

```
mj-hero        -> mj-section > mj-column > mj-custom-passthrough
mj-navbar      -> mj-section > mj-column > mj-custom-passthrough
mj-raw         -> mj-section > mj-column > mj-custom-passthrough
mj-group       -> mj-section > mj-column > mj-custom-passthrough
mj-carousel    -> mj-section > mj-column > mj-custom-passthrough
mj-table       -> mj-section > mj-column > mj-custom-passthrough
mj-accordion   -> mj-section > mj-column > mj-custom-passthrough
```

Worse, `mj-wrapper` swallows everything beneath it. A template wrapped in
`<mj-wrapper>` — routine in agency work — parses to exactly one node:

```
with a wrapper:    mj-custom-passthrough
without (control): mj-section > mj-column > mj-button
```

And the single most common real-world shape, rich text, demotes too. `parser.ts`
demotes any leaf with element children:

```
RICH TEXT node kind: passthrough
<mj-text data-cmp="brand/copy"><p>Hello <b>world</b></p></mj-text>
```

The stamp survives (it is inside `rawXml`) but it is not addressable. A
propagation engine that only walks `BlockNode`s will silently skip these — the
exact flattering-silence failure mode. The design must classify them explicitly
as `opaque` and report them, never pass over them.

Two of the seven modeled block types are `contentField: "text"` leaves whose
realistic authored form has inline HTML. This is not an edge case. It is the
main case for copy blocks, and it is why §5 treats opacity as a first-class
instance status rather than an error.

**Measured, on a template with two identically-stamped buttons** (`probe4.test.ts` Q2):

```
shape:
mj-custom-passthrough (mj-wrapper)
mj-section
  mj-column
    mj-button
stamps in stored source: 2
stamps reachable as BlockNodes: 1
```

Half the instances are invisible to a tree walk, and the walk reports success.

**Correcting a claim I was handed:** it was put to me that `allowedChildren`
demotes *legal* MJML, with `<mj-section><mj-text>` as the example — a palette
rule misused as a parse gate. I tested it against the real compiler and that
specific claim is **wrong**. MJML rejects the same three cases the parser
demotes:

```
mj-section > mj-text   parser: demoted   mjml: "mj-text cannot be used inside mj-section, only inside: mj-attributes, mj-column, mj-hero"
mj-body    > mj-text   parser: modeled   mjml: "mj-text cannot be used inside mj-body, …"
mj-column  > mj-column parser: demoted   mjml: "mj-column cannot be used inside mj-column, …"
control (valid)        parser: modeled   mjml: no errors
```

Where the parser demotes, MJML agrees. `allowedChildren` is not misfiring.

The underlying concern is real but the mechanism is different, and the
difference matters for the fix. `BLOCK_REGISTRY` models **9 tags out of MJML's
~30**, and its `allowedChildren` lists are narrower than MJML's content model
(`mj-section` legally accepts `mj-group` and `mj-raw`; `mj-column` accepts
`mj-table`, `mj-accordion`, `mj-carousel`, `mj-navbar`, `mj-raw`). Every one of
those is legal MJML that demotes to opaque. So the coverage gap is a **registry
breadth** problem, not an `allowedChildren` correctness bug — which means the
fix is "model more tags", not "stop gating on allowedChildren". Removing the
gate would let genuinely invalid MJML through as a modeled node and break the
serializer's structural assumptions.

### Baseline note

`npx vitest run tests/` before any of my files: **41 tests failing, 5 files**
(`tests/integration/*`, `TypeError: Cannot read properties of undefined
(reading 'cleanup')` in the DB helper). The suite is red at HEAD. Not caused by
this work; it means "tests pass" is currently not available as a propagation
safety signal.

---

## 1. Identity and stamping

### The three candidates

| Mechanism | Survives round-trip | Survives hand-edit | Survives AI rewrite | Verdict |
|---|---|---|---|---|
| Attributes (`data-cmp`) | Yes — proven | Mostly; visible and deletable | Depends entirely on prompt discipline | **Chosen** |
| Comment markers (`<!-- cmp:… -->`) | Yes, as `UnknownNode` | Poorly — detaches from its node on any reorder | Worse — LLMs drop comments readily | Rejected |
| Side table of index paths (`"0/1/2"`) | N/A | No — any insert above shifts every path | No | Rejected as primary |

`stampPaths.ts` is worth reading for what it teaches, not for reuse: it
deliberately **recomputes** `data-mjml-path` from scratch on every render
(`render.ts` calls `stampMjmlPaths(source, result.html)` per cache miss) because
positional paths are only valid for the instant they were derived. Persisting
them is the mistake it is designed to avoid. We reuse its path *format* for UI
targeting inside a single plan, and never store it.

### The stamp

Three valued attributes, always in this order, always first on the node:

```
data-cmp="<brandSlug>/<componentSlug>"   identity  — which component
data-cmp-v="<n>"                         base      — version last synced
data-cmp-i="<8-char id>"                 instance  — this occurrence
data-cmp-h="<8-char hash>"               tripwire  — hash of merged values at last write
```

`data-cmp-v` is the load-bearing one: it is the **merge base** (§2), not a
"current version" marker. `data-cmp-i` gives per-instance history and lets the
dry-run diff address an instance without a positional path.

`data-cmp-h` is a self-contained override tripwire, adopted from the audit
lane's proposal. It hashes the attr values as the engine last wrote them. A
mismatch proves the instance was modified locally *without needing the base
version to be available* — which is exactly the `unknown-base` case (§5c) where
three-way merge degrades. With the hash, `unknown-base` degrades to "we know
this instance was locally modified, treat every attr as a conflict" instead of
"we know nothing". It costs 8 characters and makes the worst case honest.

Precedent for in-band `data-*` sentinels in this codebase: `stampPaths.ts:532`
already ships `data-mjml-passthrough` as exactly this kind of marker.

Deliberately **not** stamped: the override set, and the ownership policy. See
§2 for why — this was the audit lane's main counter-proposal and I am rejecting
two thirds of it on purpose.

### Hand-edit and AI-rewrite survival

Hand-editing: attributes survive ordinary edits and are self-describing enough
that an editor who sees `data-cmp="shoe-brand/primary-button"` will usually
leave it. They will sometimes delete them. Handled as drift (§5), not prevented.

AI rewrite is the serious threat. `src/server/routes/query.ts:116` accepts any
LLM output that passes `isParsableMjml` and writes it straight to the row.
`promptBuilder.ts` already says *"Preserve all `<mj-raw>`, comments, and
unmodeled MJML constructs verbatim"* — stamps must be added to that sentence,
and prompt text alone is not a guarantee. Add a mechanical post-check:

```ts
/** Count `data-cmp` stamps per component key, for pre/post comparison. */
export function stampCensus(mjml: string): Map<string, number>;
```

In the query route, compare the census before and after. A drop is not fatal
(the user may legitimately have asked to remove a button) but it must be
reported in the reply and recorded, so silent stamp erosion becomes visible
rather than being discovered six weeks later as "propagation stopped working".

### Export

```ts
/** Strip all `data-cmp*` attributes. Call on every ESP-bound export. */
export function stripStamps(mjml: string): string;
```

Implemented as parse → walk → `deleteAttr` → serialize for modeled nodes, plus a
regex pass over `CustomPassthroughNode.rawXml`. Note the asymmetry: stamped MJML
is the stored form, de-stamped MJML is the delivered form, and the two must
render identically (D3 confirms MJML drops `data-*` from HTML anyway, so they
do — worth an assertion in the export test).

---

## 2. The splice algorithm and the override model

This is the question the product lives or dies on, so state the requirement
plainly: **if a designer changed this button's label to "Buy now", a brand-color
propagation must not revert it.** A propagation that clobbers per-instance work
is worse than no propagation, because the damage is spread across 40 templates
and discovered one at a time.

### Rejected: two-way replace

"Take the new component definition, overwrite the instance." Simple, and wrong:
it erases every per-instance `href` and every piece of copy. Nobody would use it
twice.

### Rejected: an explicit per-instance ownership list

The audit lane proposed stamping `data-cmp-own="href,color,…"` (component-owned
attrs) and `data-cmp-slots="text"` per instance, arguing that provenance cannot
live out-of-band because `schema.ts:12` persists a single `mjml text` column and
`BlockNode.id` is a per-parse counter (`parser.ts:37-41`), useless as a key.

**The premise is correct and my design already satisfies it.** Nothing about a
*template* is stored out-of-band. `data-cmp-v` is in-band, and what it points at
is a **component definition** — a new first-class entity in its own tables, not
derived from any template. Component version history is not template provenance.

**The proposed lists are still the wrong shape**, for the reason the project's
own conventions give: one writer, one trigger. Ownership is a property of the
component, not of each occurrence of it. Stamping it per instance means N copies
of one fact, each independently editable by a hand-editor and each needing
rewrite on every propagation — a second writer to state the engine also owns.
When component v5 adds a newly-owned attr, every v3-stamped instance carries a
stale list, and the list and the component now disagree with no way to tell
which is right. Keep the policy on the component, where changing it is one edit
with one obvious trigger.

What I **did** take from the proposal is `data-cmp-h` (§1), which is the part
that carries information nothing else has: a local-modification signal that
survives the base version being unavailable. That is a genuine gap in my design
and the hash closes it.

### Chosen: declared ownership + three-way merge against the stamped base

Two mechanisms, each doing one job.

**(a) Ownership policy, declared on the component, per attribute.** The agency
decides once what is theirs and what is the template author's.

```ts
export type AttrPolicy =
  /** Component-owned. Always overwritten. Instance edits are reverted — and
   *  the dry run says so out loud, because silently reverting is the thing
   *  this whole design exists to prevent. */
  | "locked"
  /** Component supplies a starting value; three-way merged thereafter. */
  | "default"
  /** Instance-owned. Propagation never reads or writes it. */
  | "slot";
```

Brand colour and border-radius are `locked`. Padding and font-size are
`default`. `href`, `src` and `alt` are `slot`. Unlisted attributes default to
`"default"` — the merging policy, not the clobbering one, because the failure
mode of `default` is a visible conflict and the failure mode of `locked` is
silent destruction.

**`textPolicy` defaults to `"slot"`, not `"default"`.** This is a correction: my
first draft defaulted it to `"default"` like everything else, and the audit lane
was right to call it out. Three-way merge on text is safe *when the base is
available* — instance "Buy now" ≠ base "Shop now" means an override, kept. But
at `unknown-base`, and on the first propagation after adopting an unstamped
instance, there is no base, and merge degrades to take-component. That silently
rewrites every button label in the brand to the component's label. It is
unrecoverable across 40 templates and it is the single worst thing this engine
could do. The safe default costs one conservative decision; the unsafe default
costs a customer.

**(b) Three-way merge for every `default` attribute.** Base = the component
definition at `data-cmp-v`, ours = the instance as stored, theirs = the new
component version. Standard resolution:

| ours vs base | theirs vs base | result |
|---|---|---|
| same | changed | take theirs (`component-update`) |
| changed | same | keep ours (instance override, silent) |
| changed | changed, same value | take theirs (convergent, silent) |
| changed | changed, different value | **conflict** — default keep ours, surfaced |
| absent (deleted) | changed | conflict — default keep absent |
| same | absent (removed upstream) | remove (`component-remove`) |
| changed | absent | conflict — default keep ours |

This is why `data-cmp-v` must name the version the instance was **last synced
to** rather than the newest. Retaining every published component version
immutably is what makes the base available; version rows are append-only and
never pruned (pruning would turn old instances into `unknown-base`, §5c).

The base is also what makes overrides durable across repeated propagations: an
instance created at v3, hand-edited, propagated to v5, hand-edited again, merges
correctly at v6 because the v5 write rebased the stamp.

### Text content

`textPolicy: AttrPolicy` on the component, same three values, merged the same
way against `BlockNode.text`. In practice copy components are `slot` and label
components (a button saying "Shop now" across a brand) are `default`.

### Structure

A component whose root is a container (`mj-section`, `mj-column`, `mj-social`)
raises the genuinely hard case: three-way merging *trees*, not attribute maps.
**v1 does not attempt it.** A container component declares one of:

- `childPolicy: "owned"` — children are replaced wholesale from the new version.
  Any instance edit inside is lost; the dry run enumerates what is lost.
- `childPolicy: "slot"` — a child marked `data-cmp-slot="<name>"` keeps its
  subtree verbatim; everything else is `owned`. Slots are matched by name, so
  reordering does not break them.

If the new version changes the slot set (renames, removes), the plan marks every
instance `blocked` with `reason: "slot-set-changed"` and refuses rather than
guessing. Tree merge is a real algorithm and a v1 that half-does it will
destroy work quietly. Refusing is honest and cheap to explain.

### Signatures

```ts
// src/shared/components/types.ts

export interface ComponentDef {
  /** "<brandSlug>/<componentSlug>" — matches the `data-cmp` attribute value. */
  key: string;
  version: number;
  /** Root block type. `mj-custom-passthrough` roots are not propagatable. */
  rootType: Exclude<BlockType, "mj-custom-passthrough">;
  /** Canonical attrs for this version, insertion-ordered, stamps excluded. */
  attrs: Map<string, string>;
  text?: string;
  /** Serialized children for container roots; undefined for leaves. */
  children?: TreeNode[];
  policies: Map<string, AttrPolicy>;
  /** Policy for attrs absent from `policies`. Default "default". */
  defaultPolicy: AttrPolicy;
  textPolicy: AttrPolicy;
  childPolicy: "owned" | "slot";
}

// src/shared/components/locate.ts

export type InstanceStatus =
  | "ok"
  | "opaque"        // inside a passthrough node — stamp present, unaddressable (D4)
  | "unknown-base"  // data-cmp-v names a version we do not hold
  | "no-instance-id"
  | "drift";        // locked attrs mutated or removed since the stamped base

export interface LocatedInstance {
  instanceId: string | null;
  componentKey: string;
  baseVersion: number;
  /** Index path into the parsed body, e.g. "1/0/2". Valid for this parse only. */
  path: string;
  node: BlockNode | CustomPassthroughNode;
  status: InstanceStatus;
}

/**
 * Walk a parsed document for every stamped node, INCLUDING passthrough nodes
 * whose `rawXml` carries a stamp — those are returned with status "opaque"
 * rather than skipped, so an un-propagatable instance is reported, not lost.
 */
export function locateInstances(
  doc: MjmlDocument,
  componentKey?: string
): LocatedInstance[];

// src/shared/components/merge.ts

export interface AttrChange {
  key: string;
  from: string | null;
  to: string | null;
  reason: "component-update" | "component-add" | "component-remove" | "locked-reset";
}

export interface Conflict {
  key: string | "__text__";
  base: string | null;
  componentValue: string | null;
  instanceValue: string | null;
  /** v1 always "keep-instance"; the field exists so the UI can offer a choice
   *  later without a data-shape migration. */
  resolution: "keep-instance" | "take-component";
}

export interface MergeResult {
  attrs: Map<string, string>;
  text?: string;
  children?: TreeNode[];
  changes: AttrChange[];
  conflicts: Conflict[];
}

/**
 * Three-way merge of one instance. Pure — takes and returns values, mutates
 * nothing. `base` is the component at the instance's `data-cmp-v`; pass null
 * when that version is unavailable, which degrades to locked-only application
 * and marks every `default` attr as a conflict.
 */
export function mergeInstance(
  instance: BlockNode,
  base: ComponentDef | null,
  next: ComponentDef
): MergeResult;

// src/shared/components/splice.ts

/**
 * Apply merged values to a parsed document in place and re-stamp
 * `data-cmp-v` to the new version. Returns the serialized MJML; does NOT
 * write to the DB. Instances with status !== "ok" are left untouched and
 * reported by the caller's plan.
 */
export function spliceComponent(
  doc: MjmlDocument,
  next: ComponentDef,
  merges: ReadonlyMap<string, MergeResult>  // keyed by LocatedInstance.path
): string;
```

---

## 3. The dry-run diff

This is the feature that sells the product, so it is not a preview of the write
— it **is** the write. The plan is computed, persisted, shown, and applied by
id. Apply performs no merging of its own; it writes the `afterMjml` the user
approved. Any other arrangement lets the preview and the write disagree, which
is the one bug users never forgive in a tool like this.

Granularity: **per attribute**, rolled up per instance, rolled up per template.
Per-template is what fits on screen; per-attribute is what makes it trustworthy.

**Diff canonical-before against after, never raw-before against after.** The
first propagation of any hand-authored template also reformats it, and a diff
that shows reformatting noise destroys the dry run's credibility at the exact
moment the user is deciding whether to trust it. Measured on a realistic sample
(`probe4.test.ts` Q3), the reformat is smaller than feared — **2 of 10 lines** —
and it is worth knowing precisely what those two lines are:

```
BEFORE  <mj-section background-color='#ffffff'>
AFTER   <mj-section background-color="#ffffff">
BEFORE  <mj-button href="/x?a=1&amp;b=2" disabled>Shop &amp; Save</mj-button>
AFTER   <mj-button href="/x?a=1&amp;amp;b=2">Shop &amp;amp; Save</mj-button>
```

Quote-style normalization, the D1 entity bug, and the D2 valueless-attr drop.
**After P1 and P6 land, only the quote-style line remains.** Indentation already
matches, so "the whole file reformats" is not what happens.

The same probe returned one result that matters more than the diff size:

```
canonical is idempotent? false
```

Because of D1, `serialize(parse(x))` is not a fixed point — **there is currently
no canonical form at all**, so "diff against the canonical before" is not even
expressible until P1 lands. That is a second, independent reason P1 gates
everything.

Post-P1, the plan computes `canonicalBefore = serialize(parse(beforeMjml))` and
diffs `afterMjml` against it. Reformatting is reported as one line of prose
("formatting normalized — first propagation for this template"), never as diff
rows. The *write* still includes the reformat; the user is told, not shown 200
rows of it.

```ts
// src/shared/components/plan.ts

export type TemplateStatus =
  | "clean"       // changes, no conflicts
  | "conflicts"   // changes, some instance overrides contested
  | "drift"       // at least one instance opaque / unknown-base / mutated
  | "blocked"     // would not serialize or compile — excluded from apply
  | "unchanged";  // stamps found, merge is a no-op

export interface InstancePlan {
  instanceId: string | null;
  path: string;
  nodeType: BlockType;
  status: InstanceStatus;
  changes: AttrChange[];
  textChange?: { from: string; to: string };
  conflicts: Conflict[];
}

export interface TemplatePlan {
  templateId: string;
  templateName: string;
  /** Optimistic-concurrency token, checked again at apply. */
  templateVersion: number;
  status: TemplateStatus;
  instances: InstancePlan[];
  /** Present unless status is "blocked" or "unchanged". */
  afterMjml?: string;
  /** Why it is blocked, in words a user can act on. */
  blockedReason?: string;
}

export interface PropagationPlan {
  planId: string;
  componentKey: string;
  fromVersions: number[];   // the distinct bases found across the corpus
  toVersion: number;
  createdAt: Date;
  templates: TemplatePlan[];
  summary: {
    templatesScanned: number;
    templatesAffected: number;
    instancesAffected: number;
    attrsChanged: number;
    conflicts: number;
    drifted: number;
    blocked: number;
    /** Instances located but NOT propagatable — opaque nodes (§7). A headline
     *  figure, never a footnote: under-reporting it is how the engine lies. */
    unreachable: number;
  };
}

export function buildPropagationPlan(args: {
  db: DbHandle;
  componentKey: string;
  toVersion: number;
}): PropagationPlan;
```

The UI reads the summary for the headline ("38 templates, 214 buttons, 3
conflicts, 2 drifted, 1 blocked"), the template list for the middle tier, and
expands an instance to the attribute rows. Rendered before/after HTML is offered
per template on demand, not precomputed — §6 shows why.

### Reconciling with `api.md` §2.3 — re-derive, but verify

`api.md` §2.3 specifies the opposite arrangement: preview returns a light
response, apply **re-derives** the rewrite from `{change, pins, onConflict}`,
and nothing is persisted. Its stated objection to persisted plans is payload
size. Both halves of that are worth testing rather than arguing, so I did.

**Its determinism premise is correct.** The rewrite is pure. 50 runs of the same
propagation, interleaved with unrelated parses to perturb the module-level
`nid()` counter, produced **one distinct output hash**:

```
distinct output hashes across 50 interleaved runs: 1 [ 'ed69356c3893e2f0' ]
first parse ids : n_2ck,n_2cj,n_2ch,n_2ci
second parse ids: n_2d4,n_2d3,n_2d1,n_2d2
ids differ between parses: true | output still identical: true
```

`BlockNode.id` does vary between parses, and it never reaches output — which is
the specific thing that could have broken determinism and does not.

**Its size objection is directionally right and my plan was wrong.** Measured
over 480 templates / 2400 instances:

```
full afterMjml   : 1.06 MB     <-- persisting every rewrite
rich diff JSON   : 667 KB      <-- per-attribute rows for every instance
per-template hash:   7.5 KB    <-- an integrity pin
```

(`api.md`'s "50 MB" comes from 200 × the 256 KB body cap; realistic corpora are
1-9 MB. Smaller than claimed, still too large for one response.) The finding that
actually changes my design is the middle row: **the rich diff is 667 KB and the
body cap is 256 KB** (`createWebApp.ts:15`). My §3 assumed only `afterMjml`
needed to stay out of the response. Per-instance rows do not fit either.

**So neither document was right, and the fix satisfies both.**

1. **Preview returns the summary plus per-template rows only** — `{templateId,
   name, version, status, instanceCount, conflictCount, unreachableCount}`, about
   120 bytes each, **58 KB at 480 templates**. Comfortably inside the cap.
2. **Per-instance `AttrChange[]` and `Conflict[]` load per template, on expand**,
   from `GET …/plans/:planId/templates/:templateId`. This is what a diff screen
   does anyway — nobody expands 480 templates at once.
3. **Apply re-derives**, as `api.md` wants. No `afterMjml` is persisted.
4. **But the plan stores a 16-byte hash of each template's re-derived output**
   (7.5 KB total), and apply compares its fresh re-derivation against that hash
   before writing. Mismatch ⇒ that template fails `failed-plan-drift` and writes
   nothing.

Step 4 is the part I will not give up, and it costs 7.5 KB. Determinism is a
property of the code *as it is today*; `api.md` concedes it "stops holding the
moment anyone routes propagation through the LLM", and it also stops holding if
anyone changes the serializer, the registry defaults, or a merge rule between
preview and apply. The failure it names — "the user approves preview A and gets
rewrite B" — is silent, corpus-wide, and exactly what this feature must never do.
An invariant stated in a comment is a hope; a hash compared before the write is
a guarantee. Re-derivation plus verification is strictly better than either
document alone: no blob, and no trust.

**One gap in `api.md`'s pin set, independent of the above.** `pins` covers
template versions only. The three-way merge (§2) also reads the **component
definition and its policy set**, and an edit to either between preview and apply
changes the rewrite with no version mismatch to catch it. `ApplyRequest` needs
`componentVersion` and a policy-set hash alongside the template pins. Cheap, and
without it the determinism argument has a hole that pins do not cover.

**`onConflict: "abort" | "skip"` is too coarse** once merges produce
per-instance conflicts. It is adequate for v1, where every conflict resolves
`keep-instance`, but it cannot express "apply these 37; on the 3 conflicts I
reviewed, take-component on one and keep-instance on two". Accept it for v1;
note that `Conflict.resolution` exists so the request can grow a
`resolutions: Array<{instanceId, key, resolution}>` field without a redesign.

---

## 4. Failure and partial application

Propagating to 40 templates, #17 fails. The answer is **per-template atomic,
batch non-atomic, with a durable report** — and the reason is mostly that the
plan phase should make apply-time failure nearly impossible.

**Validate everything before writing anything.** The plan phase already parses,
merges, splices and serializes every template. Extend it to run
`isParsableMjml` and `mjml2html(…, { validationLevel: "soft" })` on each
`afterMjml`. A template that fails is `blocked`, excluded from apply, and shown
with its reason. By the time the user clicks Apply, every template in the run
has been proven to serialize and compile. The residual apply-time failure modes
are only two: a stale `templates.version` (someone edited concurrently) and a DB
error.

**Why not one transaction for all 40.** `better-sqlite3` would make it trivial,
and it is still the wrong choice. Template #17 failing is almost always
template-local — it was already broken, or someone is editing it right now.
Blocking a brand-colour rollout to 39 templates on one unrelated template's
problem inverts the cost: the agency wanted 39 templates updated and got zero,
and now has to find and fix #17 before anything moves. All-or-nothing is right
when partial state is incoherent; here each template is independently coherent
before and after.

**The exception, by error class.** Systemic failures abort the whole run
immediately: DB unavailable, the component definition itself failing to load,
more than a configurable fraction of items failing (default 25% — if a quarter
of writes are failing, the assumption behind the run is wrong). Template-local
failures skip and continue.

**Durability is what makes partial application acceptable.** "39 of 40 applied"
is only survivable if the run is recorded. Each item stores its `prevMjml`, so:

- per-template undo is a write of the stored previous MJML, under the same
  optimistic version check;
- "undo run" is that, iterated, and can itself partially fail — reported the
  same way;
- "retry failures" re-plans only the failed items against current state, since
  their versions have moved.

```ts
export interface PropagationItemResult {
  templateId: string;
  outcome: "applied" | "skipped-blocked" | "failed-stale" | "failed-error";
  fromVersion: number;
  toVersion?: number;
  error?: string;
}

export interface PropagationResult {
  runId: string;
  planId: string;
  aborted: boolean;
  abortReason?: string;
  items: PropagationItemResult[];
  applied: number;
  failed: number;
  skipped: number;
}

export function applyPropagationPlan(args: {
  db: DbHandle;
  planId: string;
  /** Template ids to apply; omit for "all non-blocked". */
  only?: string[];
}): PropagationResult;
```

Concurrency reuses what exists: `TemplateService.update(id, expectedVersion, …)`
already returns `{ kind: "stale" }`, and `templates.version` is already the
token. No new mechanism.

---

## 5. Detecting drift

Drift is not an error to be repaired quietly. It is the highest-value thing the
product knows, and it belongs on screen. Six kinds, all detectable:

**(a) Stamp deleted entirely.** The instance is simply absent; nothing to find
by walking. Detect by *fingerprint*: for each component version, store a hash of
its `locked` attribute values. Scan unstamped nodes of the component's
`rootType` and flag a match as `possible-orphan` — "this looks like
shoe-brand/primary-button but carries no stamp; adopt it?" Adoption writes a
fresh stamp. This is the only detector that finds what the walk cannot, and it
will produce false positives (two components sharing a brand colour); it is a
suggestion queue, never automatic.

**(b) Locked attrs mutated.** `mergeInstance` already computes it: if the
instance's `locked` values differ from base, the instance was hand-edited
against policy. Status `drift`; the change still applies (that is what `locked`
means) but the plan shows the reversion explicitly as `locked-reset`, never
silently.

**(c) `data-cmp-v` names a version we do not hold.** Someone hand-typed it, or
history was pruned. Status `unknown-base`; degrade to locked-only application
and mark every `default` attribute a conflict. `data-cmp-h` (§1) is what makes
this degradation informative rather than blind: recompute the hash and you know
whether the instance was locally modified even with no base to compare against.
Text is untouched here regardless, because `textPolicy` defaults to `slot`.

**(d) `data-cmp` present, `data-cmp-i` missing.** Instance id lost in an AI
rewrite. Not fatal — mint one on the next write. Counted, because a rising count
means the AI pane is eroding stamps.

**(e) The node is inside a passthrough** — rich `<mj-text><p>…</p></mj-text>`,
`mj-hero`, `mj-wrapper`, etc. (D4). Detect by regexing
`CustomPassthroughNode.rawXml` for `data-cmp=`. Status `opaque`. **Cannot be
propagated**; must be listed. This will be the largest drift bucket in real
usage, and under-reporting it is precisely the flattering-silence failure: the
run says "38 templates updated", the six opaque ones stay on the old brand
colour, and nobody notices until a client does.

**(f) Whole-template opacity.** A template wrapped in `mj-wrapper` parses to one
passthrough node. Detect at plan time: `doc.body.length === 1 &&
body[0].type === "mj-custom-passthrough"` → `blocked`, reason
`"template body is opaque (mj-wrapper or unmodeled root)"`.

Surfacing: a per-component health view — instances by status, drift trend over
runs — and a drift badge in the plan header. The number to watch is
**instances located vs. instances propagated**; when the gap grows, the engine
is quietly doing less than it claims.

```ts
export interface DriftReport {
  componentKey: string;
  byStatus: Record<InstanceStatus, number>;
  possibleOrphans: Array<{ templateId: string; path: string; confidence: number }>;
  opaqueInstances: Array<{ templateId: string; path: string; reason: string }>;
  blockedTemplates: Array<{ templateId: string; reason: string }>;
}

export function scanDrift(db: DbHandle, componentKey: string): DriftReport;
```

**Two routes this needs that `api.md`'s table does not expose** (flagged by the
UI lane, which built screens against them):

- `GET /api/brands/:brandId/components/:key/drift` → `DriftReport`. The
  per-component health view is the surfacing half of this section; without a
  route, drift is computed and discarded.
- `GET /api/brands/:brandId/components/:key/versions/:v` → `ComponentDef`.
  Version-addressed, not id-addressed. The properties panel must show the base
  values and policies at the instance's `data-cmp-v` — the merge base, not the
  newest version — or a conflict row cannot display the three values
  (base/component/instance) it needs to be judged. `api.md` addresses components
  by `componentId` only, which cannot reach an older version.

---

## 6. Performance — measured, not estimated

`bench.test.ts`, synthetic templates in this repo's own shape, Node 20 on this
machine, 200 iterations after warmup:

```
sections= 6 size=   5.6KB  parse=0.560ms  parse+serialize=0.636ms  x480 templates=305ms
sections=20 size=  18.4KB  parse=2.000ms  parse+serialize=2.148ms  x480 templates=1031ms
sections=60 size=  55.0KB  parse=7.317ms  parse+serialize=7.658ms  x480 templates=3676ms
mjml2html 20-section: 14.6ms each -> x480 = 7.0s
```

12 brands × 40 templates = 480. **Parse-all-on-every-propagation is fine**:
about **1 second** for the whole corpus at a realistic 18KB average, single
threaded, and the parse dominates the serialize by 10:1 so there is no point
optimizing emission.

The cost that actually matters is **`mjml2html`, at 14.6ms — seven times the
parse+serialize of the same template.** Compiling all 480 for validation is
**7 seconds**, which is past the budget for a synchronous request. So:

- Plan phase: parse + locate + merge + splice + serialize + `isParsableMjml`
  for **all** templates (~1s at 480). Cheap enough to do on every dry run.
- `mjml2html` validation for **changed templates only** — typically a handful.
  A 40-template change costs 0.6s, acceptable inline.
- Above ~100 changed templates in one run, move the compile pass to a background
  job with progress. Do not compile the unchanged.

**Where it breaks.** Linear scan is the ceiling: at ~2,500 templates the plan
phase crosses 5s and stops being interactive. The fix at that point — not now —
is a denormalized `templates.component_keys` column (a JSON array of distinct
`data-cmp` values, written on every template save) so the candidate set comes
from SQL instead of a full-corpus parse. It is derived state that can desync, so
it must be a *cache* with a `reindex` operation and a periodic full-scan
verification, not a source of truth.

**Trigger to build it:** plan phase exceeds 3 seconds, or template count exceeds
500. Building it now would add a second writer to derived state for a problem
that does not exist at 480 templates and 1 second.

---

## 7. Unreachable instances — the decision

D4 is not a bug to be fixed on the way past; it decides whether the engine is
credible. `mj-wrapper` is the standard way to do a full-width background, so it
is in a large share of real agency templates, and a stamped button inside one is
byte-preserved but invisible to a tree walk. Three options were put to me.

**(b) Splice into `rawXml` by byte offsets — rejected.** The suggestion is to do
what `stampPaths.ts` does: find the attribute in the raw slice and patch it in
place. It is the wrong lesson from that file. `stampPaths` splices into
**rendered HTML that is then thrown away** — the result is never re-parsed,
never stored, and never has to round-trip. Splicing into a `CustomPassthroughNode`'s
`rawXml` and persisting it means the slice is no longer a verbatim capture of
anything, which is the single property that makes passthrough safe. It also
requires a second attribute reader/writer operating on raw strings — a divergent
parser, in a codebase whose whole A-prime design is "one parser, policy-free".
Two parsers that disagree is how you get corruption nobody can trace.

**(c) Detect and refuse — mandatory, ship first, regardless of anything else.**
Cheap, correct, and it converts the only truly dangerous failure into an
ordinary one. An engine that silently skips unreachable instances reports "38
templates updated" while six templates keep the old brand colour; the lie is
discovered by the client. An engine that says "38 updated, 6 unreachable — here
they are" is merely limited. `locateInstances` therefore returns opaque
instances with `status: "opaque"` rather than skipping them, the count is in
`PropagationPlan.summary.unreachable`, and it is a headline figure in the UI,
not a footnote. This is not a mitigation for (a) being unfinished — it stays
permanently, because registry coverage will never be total.

**(a) Model `mj-wrapper` as a real container — yes, but as scoped follow-on
work, not a precondition.** The risk is genuinely small. The raw walker is
generic: `readElement` tracks depth by name with the `(?![\w-])` lookahead
already in place, and nested and sibling same-name elements are confirmed
working (`probe4.test.ts` Q2). Modeling `mj-wrapper` is a registry entry —
`isContainer: true`, `allowedChildren: ["mj-section"]` — plus `"mj-wrapper"` in
`BlockType` and a `PropertiesForm` view filter. No parser surgery. Note that
MJML rejects `mj-wrapper` inside `mj-wrapper`, so `allowedChildren` need not
include it and the nesting case disappears.

`mj-hero` is **not** in that batch. It is a container with its own layout
semantics and a different child model; it earns its own decision later.

Sequencing: (c) before the first propagation run ever executes. (a) as the first
improvement after, measured — see the §10 risk about counting modeled vs. opaque
nodes on real templates, which should decide how many more tags follow
`mj-wrapper` and in what order.

---

## 8. The restored round-trip gate

`OPERATIONS.md` calls this a follow-up. For this feature it is a precondition,
and the reason is asymmetric: everything else in this design fails visibly and
recoverably. Silent MJML corruption does not. Propagation reaches into N live
templates and rewrites them in one action; a fidelity regression corrupts a
brand's entire template set simultaneously, and the corruption is
self-concealing because the output still parses and still renders.

### What the existing test does and does not assert

`blocks.passthrough.test.ts` is real coverage and I am not dismissing it. Six
hand-written cases: `mj-style` in head, `mj-wrapper` at body level,
`border-radius` on `mj-section`, `letter-spacing` on `mj-text`, `mj-class` on
`mj-text`, and an HTML comment staying `__unknown__`. Each asserts node
classification, then `normalizeWhitespace(out) === normalizeWhitespace(src)`.

It genuinely covers part of the unknown-attr claim — cases (3), (4) and (5) are
exactly "an attr the registry does not model survives", which is the foundation
of attribute stamping. That is why §0 reports the assumption as verified rather
than merely plausible.

What it does not assert, and what each gap let through:

- **One generation only.** Every case is `parse → serialize` once. D1 needs two
  generations to become visible and is invisible at one. This is the gap that
  matters most.
- **Never byte equality**, always whitespace-normalized. Legitimate for
  indentation, but it also hides quote-style and escaping changes.
- **No adversarial values.** No entities, no `&`, no single quotes, no embedded
  `"`, no unicode, no CDATA. D1 is an entity bug; the corpus contains no
  entities.
- **No generator.** Six fixtures chosen by the person who wrote the code, so
  they encode the same assumptions.
- **`normalizeWhitespace` itself is untested**, and its own comments document
  two already-fixed off-by-one bugs in its index arithmetic. Every fidelity
  assertion in the suite routes through it. An oracle nothing tests is not an
  oracle.

### Spec for the restored gate

Three files. The invariant that matters is **N-generation idempotency**, not
single round-trip.

**`tests/unit/blocks.roundtrip.property.test.ts`** — generator-based, `fast-check`
(already a devDependency, already used in two suites).

Generate MJML documents from a grammar over the real content model: `mjml` →
optional `mj-head` (with `mj-title`, `mj-preview`, `mj-style`, `mj-attributes`)
→ `mj-body` → 0-6 `mj-section` → 1-3 `mj-column` → 0-6 leaves drawn from the
modeled types plus deliberate unmodeled ones (`mj-wrapper`, `mj-hero`,
`mj-raw`, `mj-table`), plus comments and stray text at every level.

The attribute-value generator is the part that earns its keep, because it is
what was missing:

```
entities        &amp; &lt; &gt; &quot; &#39; &eacute; &mdash; &nbsp;
bare specials   &  <  >  "  '
quote styles    double-quoted, single-quoted, single containing "
urls            https://x/?a=1&amp;b=2&utm_source=q
unicode         é 日本語 👍 zero-width joiner
whitespace      leading/trailing/internal runs, tab, newline inside a value
empty           attr=""
long            2KB value
stamps          data-cmp / data-cmp-v / data-cmp-i / data-cmp-h shapes
```

Four properties, per generated document:

1. **Idempotency at N generations (the headline).** With
   `s₁ = serialize(parse(src))` and `sₖ₊₁ = serialize(parse(sₖ))`, assert
   `sₖ === s₁` for k = 2..10, **byte-exact**. This is the property whose absence
   let D1 through, and it is the property propagation actually depends on —
   a template will be parsed and re-serialized many times over its life.
2. **Semantic preservation against the source.**
   `normalizeWhitespace(s₁) === normalizeWhitespace(src)`, modulo a declared and
   enumerated normalization set (currently: quote style). The exception list is
   part of the test, so widening it is a deliberate, reviewed act rather than a
   silent relaxation.
3. **Value preservation.** Every generated attribute key/value pair and every
   text body is recoverable from `parse(s₁)` exactly as generated. This catches
   corruption that happens to be idempotent — a bug that eats a character once
   and then stays stable passes property 1.
4. **Render equivalence.** `mjml2html(src)` and `mjml2html(s₁)` produce equal
   HTML. Slow, so run it on a `numRuns: 50` sample, not the full set.

Run counts: 1000 for properties 1-3, 50 for property 4. Seed pinned in CI,
random locally, and every counterexample `fast-check` shrinks gets promoted into
the fixture file below — a found bug becomes permanent coverage.

**`tests/unit/blocks.roundtrip.fixtures.test.ts`** — hand-curated, roughly
40-60 cases, asserting the same four properties. Generators do not produce
real-world shapes, so this holds: the `mj-wrapper` full-width background;
`<mj-text>` with `<p>`, `<a>`, `<b>`, inline `style`; `mj-raw` with conditional
comments; `mj-attributes` in head; `mj-include`; a full stamped component
instance; a tracking URL with five `utm_*` params; every case from D1-D4 in this
document; every shrunk counterexample the generator has ever produced. Fixtures
live inline as string constants, not in a fixture directory — the last set was
lost when a directory was cleaned up, and inline constants cannot be deleted by
a cleanup that does not know what they are.

**`tests/unit/blocks.normalizeWhitespace.test.ts`** — ~15 cases pinning the
oracle: the two documented off-by-one cases (`</mj-text></mj-column>`, flush
`<a><b>` vs indented), protected ranges for `mj-text`/`mj-button`, nested and
adjacent protected ranges, unterminated tags, empty input. Nothing else may be
trusted until this is.

**Wiring.** `assertRoundTrip` gets its first call sites here. A pre-commit or CI
gate on `src/shared/blocks/**` runs all three. If the suite cannot be made green
(it is red at HEAD — see §0), these three files at minimum must pass and be kept
passing.

**Cost:** roughly a day. It is the cheapest insurance in this plan.

---

## 9. Preconditions — none of this ships before these land

| # | Item | Why blocking |
|---|---|---|
| P1 | Fix serializer entity double-escape (D1) | Propagation is repeated round-trips; without it every run corrupts every `&` in every template it touches. Fix verified in `probe3.test.ts`. |
| P2 | Restore the round-trip gate per §8 — three files, N-generation idempotency | `OPERATIONS.md:163-172` records that the gate was deleted by accident and never rebuilt. `assertRoundTrip` has **zero call sites**. Propagation rewrites N live templates at once; a silent fidelity regression corrupts a brand's whole set simultaneously and conceals itself. |
| P2b | Detect-and-refuse for unreachable instances (§7 option c) | Without it the engine reports success on templates it did not touch. Silent no-op is the one failure mode that must not ship, and it is cheap to prevent. |
| P3 | Pin `validationLevel: "soft"` in `render.ts` with a test; filter `data-cmp*` from any user-facing `errors` | D3: `"strict"` throws on every stamped template. Soft mode is load-bearing and currently undocumented — `render.ts:60` destructures `errors` and never reads it, so the constraint is invisible to the next person to touch that line. |
| P4 | Extend `promptBuilder.ts` preservation clause to `data-cmp*`; add `stampCensus` pre/post check in `query.ts` | The AI pane is the main stamp-erosion vector and currently has no guard. |
| P5 | Fix or quarantine the 41 failing integration tests | "Tests pass" is not currently an available safety signal for a feature that rewrites the whole corpus. |
| P6 | Never emit valueless stamp attributes; fix the silent drop; add a regression test | D2: they are silently dropped. |

---

## 10. Risks — where this design is wrong

**The override model is a guess about how agencies work.** Three-way merge is
correct given the premise that instance edits are intentional and durable. If
the real workflow is "the brand file is law, template edits are mistakes", then
`locked`-everything is right and all this machinery is overhead. I have no
evidence either way and neither does the codebase. Ship with a small number of
real components and watch whether users hit conflicts or resent them.

**Declared ownership pushes work to the wrong moment.** Somebody has to sit down
and mark every attribute of every component `locked`/`default`/`slot` before the
feature does anything useful. That is a configuration tax paid up front, and
up-front configuration is exactly what people skip. The mitigation — sane
defaults, `default` for anything unlisted — means an unconfigured component
merges rather than clobbers, which is safe but makes the feature feel weak on
first use. Alternative worth prototyping: infer the initial policy set from
observed variance across existing instances (attrs that vary are `slot`, attrs
that are identical everywhere are `locked`). That is a better first-run
experience and I would build it second, not first.

**D4 may be fatal to the value proposition, not merely inconvenient — and §7
only makes it honest, not solved.** Detect-and-refuse guarantees the engine
never lies. It does not guarantee the engine is useful. If most agency templates
wrap their body in `mj-wrapper` and write copy as rich `mj-text`, the reachable
surface is small and a scrupulously honest report mostly says "cannot
propagate", which is a worse product than one that works. Modeling `mj-wrapper`
(§7a) recovers the first case; the second needs `mj-text` to keep inner HTML as
opaque *content* on a `BlockNode` instead of demoting the whole node, which is
real parser work.

**Measure before building either.** Take ten real agency templates, count
modeled vs. opaque nodes, and count stamped-reachable vs. stamped-total. If
opacity is above ~20%, fix the parser first — the engine's ceiling is the
parser's coverage, and no amount of engine design raises it. I could not run
this measurement: the repo has no corpus of real templates, only synthetic
fixtures. **This is the largest unresolved question in the plan** and it is
answerable in an afternoon by anyone with ten real client templates.

**I corrected one claim I was handed and may have been too confident doing it.**
I was told `allowedChildren` demotes legal MJML, with `<mj-section><mj-text>` as
the example. I tested three such cases against mjml@4.18.0 and the compiler
rejects all three, so the parser agrees with MJML rather than misfiring. But I
tested three cases, not the content model exhaustively, and `BLOCK_REGISTRY`'s
`allowedChildren` lists *are* narrower than MJML's in ways I did enumerate
(`mj-group`/`mj-raw` in `mj-section`; `mj-table`/`mj-accordion`/`mj-carousel`/
`mj-navbar`/`mj-raw` in `mj-column`). A systematic diff of the registry against
MJML's real content model is worth an hour and would settle it properly. My
narrower claim — that the demote is correct *where it fires on the cases I
tested* — is what the evidence supports; treat the general claim as untested.

**The reformat trap is smaller than reported but I may be generalizing from one
sample.** I measured 2 of 10 lines on one hand-authored template whose
indentation already matched the serializer's. A template using 4-space or tab
indentation reformats every line, and I did not measure that case. The
canonical-before diffing strategy (§3) handles it either way, so the design does
not change — but "2 of 10" should not be quoted as a general figure.

**`data-cmp-h` adds a fourth stamp attribute and a second writer to instance
state.** I argued against per-instance duplication when rejecting
`data-cmp-own`, then accepted a hash on the same node. The distinction I am
drawing — the hash carries information nothing else has, the ownership list
duplicates a component-level fact — is real, but it is a judgment call and
someone could reasonably hold that four stamp attributes is two too many. If the
hash proves to drift or confuse, drop it: `unknown-base` degrades less
gracefully without it but nothing breaks.

**Stamps in stored MJML are a visible, user-editable implementation detail.** An
agency that hand-edits MJML will see `data-cmp-i="a3f91c22"` and will eventually
delete it, or copy-paste a block and duplicate the instance id. Duplicate
instance ids are not handled above: the design keys merges by path, so
duplicates do not corrupt a run, but per-instance history silently merges two
instances. Detect and re-mint on write.

**The plan carries `afterMjml` for the whole corpus.** At 480 templates × 18KB
that is ~9MB per plan, persisted. Fine at this scale, ugly at 5,000. Plans
should expire (24h) and be garbage-collected.

**"Blocked" is a category users will learn to ignore.** If every run reports the
same three permanently-blocked templates, the blocked count becomes furniture
and a genuinely new blocker hides in it. Blocked items need an acknowledged
state, so the plan can distinguish "blocked, known" from "blocked, new".

**I did not verify the AI pane's actual stamp-preservation rate.** That requires
live LLM calls against real templates and it is the single largest uncertainty
in the design — everything in §1 rests on stamps surviving the rewrite path.
Measure it before committing to attribute-based identity: if preservation is
below ~95%, the comment-marker and side-table options deserve reconsideration
despite their own flaws.
