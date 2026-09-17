# Front-end plan: builder → agency email design system

Scope: `web/` only. **Rewritten against D-2 = REFERENCE** (`.plan/verdict-model.md`,
`PLAN-design-system.md` §11). Earlier drafts of §3–§5 assumed the copy model and are superseded;
§8.3 records what the verdict deleted so nobody re-derives it.

Reconciled with `.plan/api.md`, `.plan/propagation.md`, `.plan/schema.md` and the team lead's
findings. Where a peer decided something, I use their names.

The thesis: *editing a shared component propagates to every template using it, and you see exactly
what will change before it happens.*

---

## 0. What the codebase gives us, and what it takes away

**1. The canvas is already document-source-agnostic in everything but its imports.** `Canvas.tsx`
reads three contexts and otherwise only touches MJML bytes. The component editor is a **provider
swap, not a second editor** — the largest single saving in this plan, and it survives D-2 intact.

**2. Switching documents inside the autosave debounce silently discards the edit.** `useTemplate`'s
load effect has deps `[id, …]`; its cleanup clears the debounce timer and aborts the in-flight PATCH
without flushing. The new IA triples how often users switch documents. Fixed in §6.

**3. The canvas selection overlay has two failure modes, and my proposed fix only catches one.**

*Missing stamps.* `stampMjmlPaths` returns `{ html, stamped, expected, missing }`; `render.ts:69-77`
spends `missing` on one `console.warn`, then returns `c.json({ html })` and discards it. A block the
matchers missed has no `data-mjml-path`, reports no bbox, gets no overlay, and is unselectable
forever. The browser is **structurally blind — not merely silent, but unable to know.** Returning
`{ html, unstamped }` is three lines of already-computed data. Adopted into Phase 0 by the lead;
§5.6 depends on it.

*Wrong stamps — and this one defeats the fix above.* `propagation-designer` measured stamping stored
source against expanded HTML producing **`stamped=3/3 missing=[]` with the top-level path landing on
the wrong section**. Every click selects the wrong block, the counts look perfect, and the warning
can never fire. So `unstamped[]` reports honestly on absence and says nothing about correctness:
**it is a completeness check, not a correctness check**, and I should not have implied otherwise.

Correcting my own proposal: the fix for mis-stamping is structural (expand before stamping, §5.5),
not a reported count. `unstamped[]` is still worth the three lines — it catches the registry-gap
class and gives the mjml 4→5 bump a smoke alarm — but the two failure modes need different
detection, and the more dangerous one is the silent-and-plausible one.

> **Shipped.** `render.ts` now returns `{ html, unstamped }` on both the cached and uncached paths,
> with the completeness-vs-correctness limit written into the comment at the call site. §5.6 can be
> built against it today.

**4. "Unreachable" is a registry-membership bug, and our own UI copy points users into it.**
`schema-designer` spotted this and I verified all three parts:

- `parser.ts:304` — `if (!isModeledType(tag))` collapses the **entire element slice** into one
  opaque `CustomPassthroughNode`. Registry membership is the sole gate.
- `mj-wrapper` is absent from `BLOCK_REGISTRY` (grep count: 0).
- `RightPanel.tsx:578` tells users, in so many words, to *"paste a custom MJML tag like
  `<mj-wrapper>`"* — while `mj-wrapper` is the standard way to do full-width backgrounds.

So we instruct people into the hole and then cannot see them in it. **Adding `mj-wrapper` to the
registry as a container (`allowedChildren: ["mj-section"]`) deletes that slice outright**, and it is
roughly the same amount of code as special-casing the symptom. Fix the cause, then design for what
is left.

**5. The model allow-list is defined twice, and the two copies fail asymmetrically.** My citation of
`Settings.tsx:5` in the outcome-D discussion sent `schema-designer` to check it, and they found the
identical literal in two places. I verified:

```
src/server/services/settingsService.ts:5   export const ALLOWED_MODELS = [...]   ← validates
web/src/settings/Settings.tsx:5            const ALLOWED_MODELS = [...]          ← what the user picks
```

No shared import, no test asserting they agree — and note the server's copy *is* exported, so the
duplication is not even load-bearing; the web file simply declares its own. The asymmetry is the
dangerous part and it lands on this lane:

- Add a model **server-side only** → it never appears in the UI. Silent, harmless.
- Add a model **UI-side only** → `SettingsService.update` throws `UnknownModelError`. **The settings
  page offers a radio button the server rejects** — a rejection on a control the user was offered,
  with nothing they can do about it.

Same defect class as the `default_mode` schema-vs-migration drift, which has already bitten once.
The fix is cheap and the wiring exists: `web/vite.config.ts` and `web/tsconfig.json` already alias
`@shared` → `src/shared` (it is how `web/src/blocks/index.ts` reaches the block registry). Move both
lists to `src/shared/settings/models.ts` and import from one place. Worth doing before brand scoping
touches settings.

This also means **"which models are offered" currently has two answers** — relevant if outcome D's
repeat-hint (§2.1) ever points at the model setting, since it would be pointing at a control whose
options may not match what the server will accept.

**6. But "unreachable" is two different problems, and the second has no registry fix — it is
routine, not residue.** `schema-designer` drew this distinction and I verified it; I had wrongly
lumped them together.

*Class A — registry gaps.* `mj-hero`, `mj-navbar`, `mj-wrapper`, and any genuinely unmodeled tag.
Same shape, same fix, and the tag-naming explainer (§5.4) makes the next one self-reporting. This
class shrinks toward zero as the registry fills.

*Class B — rich leaf content, and there is no registry entry that fixes it.* `parser.ts:433-445`
demotes **any leaf with an element child** to a passthrough, with the comment "we don't model
that". So:

```
<mj-text>Read our <a href="/terms">terms</a></mj-text>     → CustomPassthroughNode
<mj-text>Buy <b>now</b></mj-text>                          → CustomPassthroughNode
```

A link or a bold word inside body copy — which is in essentially every marketing email — makes that
text block opaque: no attribute form, no inline editing, a raw-MJML textarea instead. **This is true
today, with no components involved.** It has gone unnoticed because `src/templates/starter.mjml`,
the repo's only fixture, contains exactly two `mj-text` blocks and both are plain prose (verified).
Nothing has ever exercised the path.

I cannot size Class B without real templates, and it changes how much design the unreachable state
deserves: if most text blocks in real agency templates carry inline HTML, this is not an edge case
being reported in a corner of the roll-out screen, it is the default experience of editing text.
**Counting `mj-text` blocks containing `<` in a handful of real templates is a ten-minute check and
I would want it before sizing §5.4.** Raised in §8.1.

So §4.2 and §5.4 keep the unreachable bucket exactly as the lead asked. Class A justifies it
shrinking; Class B means it must not be designed as rare.

Three changes fall in my lane and are free: **the help text at `RightPanel.tsx:578` must stop
recommending `mj-wrapper`** once the registry covers it; the unreachable explainer (§5.4) must name
the tag that caused it; and it must distinguish the two classes, because "this is inside an
`<mj-hero>`" invites a fix and "this text block contains a link" does not — telling a user that
formatting their copy made it uneditable needs different words and probably a different remedy.

---

## 1. Navigation & IA

### 1.1 Route table

Brand in the URL, keyed by **slug** (`schema.md`). All lanes independently landed on path scoping.

```
/                                             → <Navigate> to /b/:lastBrandSlug/templates
/brands                                       → BrandsRoute   (list, create, rename name; §1.2)
/b/:brandSlug                                 → <Navigate> to ./templates

  ── inside <SidebarShell> ──
  /b/:brandSlug/templates                     → TemplateEmpty          (unchanged component)
  /b/:brandSlug/templates/:templateId         → TemplateRoute          (unchanged component)
  /b/:brandSlug/components                    → ComponentLibraryRoute  (§3.1)
  /b/:brandSlug/components/:componentId       → ComponentRoute         (§3.3)
  /b/:brandSlug/components/:componentId/usage → ComponentUsageRoute    (§3.5)
  /b/:brandSlug/tokens                        → TokensRoute
  /settings                                   → Settings               (stays global; §0.5 only)

  ── full-screen takeover, NOT inside SidebarShell ──
  /b/:brandSlug/rollout/:planId               → RolloutRoute           (§4)
```

`/settings` stays global (`api.md` §0.1: provider/mode/model describe the *deployment*, not a brand).
That page needs no change.

`RolloutRoute` — renamed from "publish" for a reason D-2 makes real: under reference, **publishing a
revision and rolling it out are two separate acts** (§3.3). Calling the propagation screen "publish"
would collide with the button that creates the revision. It sits outside `SidebarShell` because it
needs full width, and hiding the rail signals a decision point you complete or cancel.

### 1.2 Slug is identity, name is label — so there is no rename field

`schema-designer` corrected an earlier statement of theirs that I had built on: **`brands.slug` and
`components.key` are immutable.** Under D-2 they are half of every reference in the corpus
(`component-id="shoe-brand/footer"`), so editing one orphans every template using that brand's
components.

Concretely, for this lane:

- **Every rename affordance binds to `name`**, never to slug or key. The library card's inline
  rename, the brand row's rename, the component editor's title field — all `name`.
- **No slug/key field appears in any edit surface.** It is create-time-only and read-only
  thereafter. A genuine re-slug is a rare dedicated command that rewrites references, not something
  reachable from a settings panel where someone can wander into it.
- The create form is the one place the slug is editable, and it is the one place to explain that it
  is permanent — at the moment the user is choosing it, not after.

This is the kind of rule that gets violated by accident six weeks later when someone adds an "edit"
pencil to a list row. I proposed a comment at each list component; **`schema-designer`'s version is
better and I am adopting it — make the type unable to express the mistake.** No `slug` field on the
brand update DTO, no `key` field on the component update DTO, so a rename affordance bound to the
wrong field does not compile. Same reasoning as scoping a service per-brand so an unscoped call
cannot be written.

That is an ask for whoever owns the route types rather than something this lane can do alone, but it
is worth making now: a comment relies on the next person reading it, and a missing field relies on
nothing.

### 1.3 Vocabulary: `version` ≠ `revision`

`schema.md` flags a trap worth respecting in every string in this UI:

- **`version`** — the optimistic-concurrency lock token on mutable rows. **Never shown to a user.**
  Surfacing it invites people to reason about an implementation detail.
- **`revision`** — the immutable published component revision a template pins. **The only one the
  user ever sees**, written `r4`, never `v4`.

Under D-2 this matters more than it did, because the pin is now visible on every instance (§5.2).
Worth a lint rule eventually; for now a review checklist item, because the words are interchangeable
in English and will drift back.

### 1.4 Landing screen

**`/b/:brandSlug/templates`.** Familiar, matches today, no conditional rule. I considered landing on
the library since it is the differentiator, and rejected it: a landing screen that changes depending
on whether the brand has components yet is a hidden rule. The library is pinned *above* templates in
the rail instead — the discovery benefit without the surprise.

### 1.5 Sidebar

```
┌──────────────────────────────┐
│ ◆ Acme Corp              ▾   │  <BrandSwitcher/>
├──────────────────────────────┤
│ COMPONENTS               +   │  <ComponentList/>
│   Header                12   │  ← usageCount, free on the list response
│   Footer            23  ↑    │  ← ↑ = a newer revision exists, templates are behind
│   Product card       7  ▲    │  ← ▲ = unreachable instances
├──────────────────────────────┤
│ TEMPLATES                +   │  <TemplateList/>   ← today's component, brand-scoped
│   Welcome series             │
│   Abandoned cart             │
├──────────────────────────────┤
│ ◇ Brand tokens               │
│ ⚙ Settings                   │
├──────────────────────────────┤
│ [ Ask Claude…            ]   │  <SidebarQueryInput/>  ← + reply surface (§2.1)
└──────────────────────────────┘
```

Components above templates: the usage count is what makes the rollout screen make sense before you
open it. `↑` is new under D-2 and is the pull — *"r5 exists, 23 templates are still on r4"* is a
standing invitation to the screen that sells the product.

**The brand switcher must not imply tenancy.** `schema.md` is explicit: no auth, no isolation, the
deployer owns every brand in the file. No lock icons, no "workspace", no member counts. It is a
filter and should read as one.

`ComponentList` is a near-copy of `TemplateList`. **Deliberately duplicating ~110 lines rather than
extracting a shared `<ResourceList/>`** — two call sites is not enough evidence to pick the right
abstraction, and the lists will diverge. Revisit at the third.

---

## 2. Provider restructuring (the enabling change)

```
web/src/hooks/useDocument.ts    NEW   reducer + debounce/backoff/conflict machinery — a verbatim
                                      move of useTemplate's body, parameterised by a { get, patch }
                                      adapter
web/src/hooks/useTemplate.ts    MOD   thin wrapper over useDocument
web/src/hooks/useComponent.ts   NEW   same wrapper for the component draft
```

The adapter must be the **module-level functions** from `api/templates.ts`, not a re-implemented
fetch, because `tests/unit/web.useTemplate.spec.tsx` (346 lines — `api.md` §7 rates it the largest
single test cost in the repo) works by `vi.spyOn(templatesApi, "getTemplate")`. Route through the
module export and its reducer/backoff/conflict coverage survives. Hard constraint.

Context renames: `TemplateDataContext` → `DocumentDataContext`, `TemplateActionsContext` →
`DocumentActionsContext`. `TemplateProviders` keeps its name; `ComponentProviders` is its twin.

### 2.1 Ask-Claude under reference: from an apology to a decision point

I raised this as a product consequence of D-2 that had not been costed: `query.ts` replaces the whole
template with the model's output, so under reference Claude receives
`<mj-component component-id="shoe-brand/footer" revision="4" />` and nothing about what it renders
as. "Make the footer links bigger" becomes impossible — the bytes are not there. I named two exits,
both lossy: send expanded and every reference silently becomes copy on one turn; send the reference
form and Claude works on a document with holes.

**`schema-designer` found a third that beats both, and it changes what this pane is** (schema.md
§1.0): expand for the prompt with delimited regions, take back expanded, and **re-collapse
mechanically** — canonically comparing each returned region against our own expansion and swapping
the `<mj-component/>` back where they match. The property that makes it safe is that *we know
exactly what we sent*, so every deviation is detectable rather than hoped-about.

The part that lands in my lane is what happens when a region comes back **changed**. It is
diagnosable, not just detectable, and that turns the worst moment in this feature into the best one:

| | Condition | Treatment |
|---|---|---|
| **A** | interior canonically identical | restore the reference, no UI |
| **B** | changes root-level and overridable | auto-convert to `ov-*`, **informational** |
| **C** | changes reach below the root | **blocking choice** |
| **D** | region structurally broken — delimiter dropped, region missing, region invented | **reject the turn, apply nothing** |

**D is not a deeper C, and it must not inherit C's dialog.** `schema-designer`'s distinction, and it
is the right one: in C we know what the model meant and can offer a choice; in D we do not know what
happened, so any choice we offer is a guess wearing a decision's clothes — presented in a blocking
modal, which is precisely where a guess does the most damage, because the user will trust it.

And **D is the likeliest failure, not the rare branch it looks like** — long documents and weaker
models both produce it, and `ALLOWED_MODELS` in `Settings.tsx:5` makes `claude-sonnet-4-6` one click
away (verified; the default is opus, but the switch is a radio button on a settings page and looks
innocuous). So if D inherits C's dialog it will be the most-seen dialog in the feature and the least
able to support itself.

**So the disclosure I had specced — "here is what Claude cannot see" — is deleted.** It was an
apology for a limitation, shown before the user did anything. It is replaced by a post-turn state on
the path users actually walk, and this is the better trade: a designed decision point beats a
pre-emptive excuse, and users discover the component system by using it rather than by reading about
its edges.

This finally gives the Ask-Claude reply surface a concrete purpose. `SidebarQueryInput` renders no
reply at all today ("the canvas IS the reply"); it now needs one, and it needs three visually
distinct treatments:

```
┌ B — informational ───────────────┐ ┌ C — blocking ────────────────────┐ ┌ D — failed ──────────────┐
│ Made the footer button green.     │ │ Rewrote the footer layout.        │ │ Couldn't verify this      │
│                                    │ │                                    │ │ turn.                     │
│ ● Footer · set for this template   │ │ ▲ This changed Footer beyond what  │ │                           │
│   button colour #1f6feb → #16a34a  │ │   can be set per-template.         │ │ The response came back in │
│                                    │ │   Not applied yet.                 │ │ a shape we couldn't check │
│   23 other templates are unchanged.│ │                                    │ │ against your template, so │
│   [ change Footer everywhere ]     │ │   ( ) Change Footer everywhere (23) │ │ nothing was applied.      │
│                                    │ │   ( ) Detach this footer            │ │                           │
│                                    │ │   ( ) Discard                       │ │ Your template is          │
│                                    │ │                    [ Apply ]        │ │ unchanged.                │
│                                    │ │                                     │ │        [ Try again ]      │
└────────────────────────────────────┘ └─────────────────────────────────────┘ └───────────────────────────┘
      already applied                         nothing applied yet                    nothing applied
```

**B must not be a modal**: the edit landed correctly and the user asked for it. It needs to say *what
scope it took* and offer the upgrade, because "I asked for green and got green" hides that 23 other
templates did not change — and that silence is what surprises people three weeks later.

**C genuinely blocks**, because there is no safe default: "change 23 templates" and "fork this one
permanently" are both too consequential to pick for someone.

**D offers no choices at all** — one button, and the most important sentence is *"your template is
unchanged."* The prompt stays in the box so retry is one click, since D is a transient failure and
making someone retype is the wrong tax on the likeliest branch. If D repeats for the same prompt, the
retry affordance grows a hint — a shorter request, or the model setting — because at that point the
cause is systematic rather than unlucky, and `claude-sonnet-4-6` being selectable makes the model a
real suspect. I would not build the hint until D's rate is observed.

If a turn produces both B and C, C resolves first. D preempts everything, because in D there is no
trustworthy B or C to report.

> **The invariant worth extracting, because it now applies in seven places.** *A change whose scope
> is narrower than the user would assume must say so at the moment it happens.* Each case below is
> correct behaviour that reads as breakage when silent, and each costs about one line.
>
> 1. **Outcome B** — the edit landed in one template, not 23.
> 2. **Component save** (§3.3) — r5 published, nothing moved. `schema-designer` raised this as the
>    mirror of the first.
> 3. **Detach** (§5.3) — this instance stops receiving updates.
> 4. **Partial roll-out** (§4.6) — "update all 23" where 3 are unreachable gives you 20. Roll-out is
>    per-template atomic, so **partial success is the normal outcome, not the error path**, and it
>    will be the most-seen completion state in the feature. "Updated ✓" on a run that skipped three
>    templates is the same failure as the silent component save. §4.6 already shows every count for
>    this reason; worth knowing it is an instance of a rule rather than a one-off.
> 5. **Brand-scoped search** — *not currently designed, and the one that will bite hardest.* Once
>    every list is `WHERE brand_id = ?`, "all templates" silently means "all templates in this
>    brand". Browsing is fine — the switcher-as-filter framing (§1.5) handles it. Search is not: a
>    user searches for a template they know exists, gets nothing, and the reason is that it is in
>    another brand. Scope narrower than assumed, invisible, at the exact moment they are most
>    certain the tool is broken.
>
>    So if search ships, **a zero-result search must count across brands**: *"No matches in Acme —
>    2 matches in other brands"* rather than "No results". That is a real query cost on the empty
>    path only, which is the one path where it is worth paying. `schema-designer` found this one;
>    I had no search surface designed at all, which is exactly why it is worth writing down now
>    rather than discovering when someone adds a search box.
> 6. **Shallow detach** (§5.3) — the nested Button stays linked. The **only case here where the
>    disclosure guards against *under*-estimating what survives** rather than over-estimating what
>    changed, and the failure it prevents is the nastiest of the six: *"I detached it and it still
>    changed on me"*, learned about an action that cannot be undone.
>
>    **Keep that asymmetry visible rather than tidying it into the general rule.** The inversion is
>    the reason case 6 exists at all — a later reader who normalises all six into "say when scope is
>    narrower" will read case 6 as a duplicate of case 3 and delete one of them, and the one that
>    looks redundant is the one guarding the irreversible action.
> 7. **Locking an attribute** (§3.4) — `ownedAttrs` is declared per revision and revisions are
>    immutable, so locking `background-color` in r5 locks nothing for the 14 templates pinned to r4.
>    They keep overriding it until they re-pin. Correct — it is what pinning means — and it reads as
>    *"I locked it and they're still changing it."*
>
>    The lock confirmation needs *"applies to templates on r5+ · 14 still on r4 · [review
>    roll-out]"*. **Same root cause as case 2 but not the same copy**, and worth keeping separate for
>    that reason: a save that changes nothing is mildly surprising, whereas a *lock* that changes
>    nothing contradicts what the word means. The stronger the false expectation, the less the
>    generic sentence will do, so this is another one a tidier should not fold upward.

**One dependency worth flagging early:** the attribute-level diff that decides "is this edit
override-shaped?" is *the same computation* as experiment 0.1(b) (§8.1 item 0), which decides whether
`ov-*` is viable at all. Built once, it answers both the runtime question and the design question —
which is a good argument for building it early rather than at the end.

Honest about cost: this is the most machinery of the three exits, with bigger prompts and a
string-level re-collapse in the LLM path. I think it is right, because the alternative degrades the
headline feature on exactly the templates a design system is supposed to improve — the ones full of
shared components.

---

## 3. The component library

### 3.1 Grid — `/b/:brandSlug/components`

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Acme Corp · Components                                     [ + New component ]  │
│  6 components · 1 with an unrolled revision · 1 needs attention                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐         │
│  │ ░  rendered      ░ │  │ ░  rendered      ░ │  │ ░  rendered      ░ │         │
│  ├────────────────────┤  ├────────────────────┤  ├────────────────────┤         │
│  │ Header             │  │ Footer             │  │ Product card       │         │
│  │ r4 · used in 12    │  │ r5 · used in 23    │  │ r2 · used in 7     │         │
│  │ all on r4          │  │ ↑ 23 still on r4   │  │ ▲ 2 unreachable    │         │
│  │              ✎ Edit│  │  roll out    ✎ Edit│  │  usage       ✎ Edit│         │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────────────┘
```

At most one status line per card — the worst wins. `all on r4` is worth showing rather than showing
nothing: "everything is in sync" is information, and a card that goes quiet when healthy makes the
healthy state indistinguishable from a card that has not loaded.

Thumbnails are real rendered output behind an `IntersectionObserver`. `propagation.md` §6 measured
`mjml2html` at 14.6ms for a 20-section template; a component is far smaller, so a screen of six is
comfortable.

### 3.2 Empty state

```
        No components yet.

        A component is a block — a header, a footer, a product card —
        that lives in one place and updates everywhere it is used.

        [ Create a blank component ]   [ Extract one from a template ]
```

"Extract from a template" is the honest on-ramp — nobody starts from nothing. **The highest-value
optional item here and the first thing I would build after the rollout screen.** Under D-2 it does
more work than it did under copy: it lifts the subtree into a revision *and replaces it with a
reference*, so the template gets smaller. It must refuse subtrees inside passthrough containers
(§0.4) with a plain explanation naming the tag.

### 3.3 Editing a component — and the two-step flow D-2 buys us

Same canvas, `ComponentRoute` adds a header. The important change from my earlier drafts:
**publishing a revision and rolling it out are separate, and separating them is a feature.**

```
Step 1                                              Step 2
┌────────────────────────────────────┐              ┌────────────────────────────────────┐
│ Footer · draft   [ Publish r5 ]    │   ──────►    │ Footer r5 published.               │
│                                    │              │ 23 templates still on r4.          │
│ nothing changes for anyone yet     │              │            [ Review roll-out ]     │
└────────────────────────────────────┘              └────────────────────────────────────┘
```

Under the copy model these had to be one scary button: materialising the component *was* the write
to 23 templates. Under reference, publishing r5 is immutable and inert — no template moves until its
pin does. So a component author can publish safely at 5pm and roll out on Monday with the team
watching. That is a real workflow improvement and the header should make it obvious, which is why
step 1's button says what it does *not* do.

**The step-2 banner is mandatory, not decorative** — `schema-designer` frames it as the user-visible
half of the pin-over-float decision, and I think that is exactly right. The silence here is the
mirror of outcome B in §2.1: the user edits the footer, saves, and 23 templates keep rendering r4.
Correct, intended, and completely invisible. Without the disclosure a pinned system **reads as
broken rather than as safe**, and the lesson the user learns is "component edits don't work" — at the
moment they are most likely to abandon the feature, having just done the thing the product is for.

One line prevents it: *"Saved as r5 · 23 templates still on r4 · [review roll-out]"*. That is the
same invariant as §2.1's callout, applied on the other side of the product, and it is worth building
in step 1's success path rather than waiting for someone to report the feature as broken.

Three mode differences from the template editor, and only three:

1. **Autosave saves a draft.** `[ Publish r5 ]` mints the immutable revision.
2. **Roll-out is a second, separate act** — it navigates to `RolloutRoute`.
3. **Each attribute gets an "overridable per template" checkbox** (§3.4).

`schema.md` adds an invariant that helps the canvas: a revision's body must contain **exactly one
root element**, so an instance is always exactly one selectable box. Worth enforcing in the editor
with a visible rule, not a save-time error.

### 3.4 Declaring what templates may override

D-2 deletes the three-policy trio (`locked`/`default`/`slot`) entirely — there is no merge, so there
is nothing for a merge policy to govern. What remains is binary: **may a template set `ov-<attr>` on
this attribute, or not.** One checkbox, which is where my first draft started before `propagation.md`
talked me into three policies. The simpler model was right for the architecture we actually chose.

```
│  Content                                               │
│   href                                                 │
│   [ https://acme.com               ]                   │
│   ☑ Templates can override this                        │
│                                                         │
│   background-color                                      │
│   [■] [ #111111                    ]                   │
│   ☐ Templates can override this                        │
│      brand colour — same in every email                 │
```

**Resolved, and it exists — `verdict-model.md:159` specifies exactly two policies and
`schema-designer`'s spec had missed it.** Without it a component author has no way to say *"the brand
blue is not yours to change"*, which is the one thing a design system must be able to say. The
checkbox above is therefore real rather than a nicety, and it writes `mj-own="background-color color"`
on the component root, parsed at publish and **stored on the revision alongside `rootTag`** — so the
instance panel still needs no fetch (§5.2).

```
overridable = BLOCK_REGISTRY[rootTag].allowedAttrs − ownedAttrs
```

**The default is "overridable", and that is the right default for this product.** A new component is
fully overridable until its author locks something, rather than rigid until opened up. The opposite
default is Knak's, and *"difficult to copy paste modules from one template to next"* is what it
produces — the complaint this whole plan exists to answer. Permissive by default, locked by
deliberate act.

### 3.5 Usage — `/b/:brandSlug/components/:componentId/usage`

Replaces the "health/drift" view from earlier drafts. Drift, in the copy-model sense, no longer
exists: nothing can diverge because nothing is copied. What remains is **revision skew** plus
unreachable instances.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Footer · usage                                            31 instances          │
│                                                                                   │
│   r5 (current)     0                                                              │
│   r4              26    ↑ behind                              [ roll out r5 ]     │
│   r2               2    ↑ behind                                                  │
│   ⊘ unreachable    3    cannot be found — see below                               │
│                                                                                   │
│   28 of 31 can be rolled out.   ← the number that matters                        │
│                                                                                   │
│  UNREACHABLE (3)                                                                  │
│   Spring sale       inside <mj-hero>                       [ open template ]      │
│   Welcome series    inside <mj-text> rich copy             [ open template ]      │
│   Receipt           inside <mj-navbar>                     [ open template ]      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

"28 of 31 can be rolled out" is the metric `propagation.md` §5 asked for — located versus actionable.
When that gap grows, something is quietly doing less than it claims. Naming the offending tag per row
makes the next registry gap (§0.4) self-reporting rather than requiring a bug report.

Revision skew is legitimately multi-valued: r4 and r2 can coexist because pins are explicit. That is
the cost of the dry run existing at all — an auto-follow `revision="head"` would make propagation
free and delete the product. Worth stating so nobody proposes auto-follow as a simplification.

> **From `schema.md`:** `instancePath` is **not durable** — reordering renumbers it. So this is a
> live read, every action is "open the template now", and there is **no saved queue, no bookmarking,
> no review-later list**. Anything storing a path would silently point at the wrong block after the
> next edit. Stated so nobody adds it back.

---

## 4. The roll-out dry run — `/b/:brandSlug/rollout/:planId`

The demo screen. It survives D-2 with its three panes intact, because — per the verdict — the diff
is `expand(template, pins)` vs `expand(template, pins bumped)`, both pure functions of stored data.
**"Revision 4 → 5" is not the diff and must not ship as one.**

### 4.1 Two diffs, and showing both is the reference model's dividend

D-2 gives this screen something the copy model structurally could not, and it is worth building the
header around:

| Question | Answer | Size |
|---|---|---|
| *What will my readers see differently?* | the expanded diff — rendered before/after | large, rich, visual |
| *What are you writing to my file?* | `revision="4"` → `"5"` | **one attribute per instance** |

Under copy the second answer was "every byte of 23 templates, including an entity-escaping bug that
turns `&amp;` into `&amp;amp;`". Under reference it is one character. An agency deciding whether to
let software touch their clients' templates is asking exactly that question, and *"here is everything
your readers will see; here is the single attribute we change in your file"* is the sentence that
closes it. No copy-model build can say it.

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│  ‹ Back to Footer                          Roll out “Footer”   r4 → r5                    │
│                                                                                            │
│   WHAT CHANGES — identical in every template                                              │
│   ──────────────────────────────────────────────────────────────────────────────────────  │
│    background-color    #f5f5f5 → #111111                                                   │
│    color               #333333 → #ffffff                                                   │
│  + mj-text             “Unsubscribe · Manage preferences”                                  │
│                                                                                            │
│   23 templates · 28 instances        ⊘ 3 cannot be reached                                │
│   ✎ In your files we change one attribute per instance: revision="4" → "5"   [ show ]     │
├──────────────────────────┬─────────────────────────────────────────────────────────────────┤
│ TEMPLATES                │  Welcome series                             2 instances        │
│ [✓] Select all (23/23)   │  ─────────────────────────────────────────────────────────────  │
│                          │  [ Visual ][ Code ]                                             │
│ ⊘ CANNOT BE REACHED (3)  │                                                                 │
│     Spring sale          │  ┌───────── BEFORE ─────────┐  ┌───────── AFTER ──────────┐   │
│       in <mj-hero>       │  │                          │  │                           │   │
│       [ open template ]  │  │   rendered iframe        │  │  ▒▒▒ changed region ▒▒▒   │   │
│     Welcome series ·1of2 │  │                          │  │                           │   │
│     Receipt              │  └──────────────────────────┘  └───────────────────────────┘   │
│                          │                                                                 │
│ ● OVERRIDDEN HERE (2)    │  INSTANCE 1 · 0/2/0                                             │
│ [✓] Win-back         ●1  │   gets all 3 changes                                            │
│ [✓] Receipt          ●1  │                                                                 │
│                          │  INSTANCE 2 · 0/5/0                                             │
│ ✓ WILL UPDATE (18)       │   gets 2 of 3 changes                                           │
│ [✓] Welcome series    2  │   ● background-color is set per-template here (#0a0a0a)         │
│ [✓] Abandoned cart    1  │     and will not change.                          [ release ]   │
│ [✓] …                    │                                                                 │
│                          │                                                                 │
│ · ALREADY ON r5 (0)      │                                                                 │
├──────────────────────────┴─────────────────────────────────────────────────────────────────┤
│  23 of 23 templates selected · 28 instances will change · 3 cannot be reached              │
│                                                [ Cancel ]  [ Roll out to 23 templates ]    │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 The left pane

Four groups. Three of the five copy-model statuses are gone: **no conflicts** (no merge),
**no drift** (nothing copied can diverge), **no blocked** — a revision either expands and compiles or
it does not, which is a property of the revision, so **validate it once at publish, not 23 times at
roll-out.** That deletes a whole per-template failure mode and its UI.

- **CANNOT BE REACHED** stays first-class exactly as the lead asked. Rows name the tag that caused it
  and offer `[ open template ]` — the only remedy, and I will not draw a fix the system cannot
  perform. A partly-unreachable template shows as "1 of 2" and also appears in its real group,
  because the reachable instance genuinely updates.
- **OVERRIDDEN HERE** is the reference-model replacement for "conflicts", and it is a much calmer
  thing: not a contested merge, just an instance whose `ov-*` shadows part of the change. Nothing is
  at risk. The group exists because *"will my customisation survive?"* is the question users bring,
  and answering it by silence is indistinguishable from not having checked.
- **ALREADY ON r5** — pins already current; no checkbox, collapsed.
- Selection is per template (`only?: string[]`). Clicking focuses; checking never changes focus.

### 4.3 Per-instance detail is now almost free

The biggest UI dividend of D-2, and it is a simplification rather than a feature: **the component's
r4→r5 change is identical for every instance.** Under copy each instance could differ — different
bases, different overrides, a three-way merge per site — so the screen owed the user 28 individual
diffs. Under reference there is **one change description, computed once, shown once in the header**,
and the per-template list becomes purely *where it lands*.

So per-instance detail reduces to one question: *does an `ov-*` on this instance shadow part of the
change?* That is a set intersection — changed attribute keys ∩ this instance's `ov-*` keys — and it
is **computable in the client from data the screen already has.** No backend field.

That resolves my own earlier request: I had asked `propagation-designer` to add `preserved[]` to
`InstancePlan` so the screen could say "your customisations will be kept". Under D-2 the model
computes it for free. **Withdrawing the ask** — a good example of the architecture deleting a
requirement rather than satisfying it.

`[ release ]` on a shadowed row removes the `ov-*` so the instance rejoins the component — offered
inline because this screen is exactly where someone realises the override is stale.

### 4.4 Visual and Code

**Visual.** Two iframes, before and after, for the focused template only, fetched on demand. Both
sides are `expand(template, pins)` results compiled through the existing cached `/api/render`.

The changed-region highlight reuses machinery already present: `stampMjmlPaths` stamps
`data-mjml-path`, `IframePreview` reports a rect per key, `OverlayTree` positions a div per rect. It
inherits §0.3 — a region the matchers missed will not highlight, silently — which is one more reason
to want `unstamped[]`.

At narrow widths the iframes stack rather than shrink; a 300px-wide email preview is useless.

**Code.** Unified MJML diff of the *expansion*, plus the one-line file diff from §4.1 shown
separately. Two diffs, clearly labelled, never merged into one pane — merging them would recreate
exactly the confusion D-2 eliminated.

> Needs `diff` (~10KB, MIT; `diffLines` suffices) rather than a hand-rolled LCS, which is the kind of
> thing that produces a subtly wrong screen. This repo has been disciplined about dependencies, so it
> deserves a deliberate yes/no.

### 4.5 What happened to the run-1 reformat problem

Mostly dissolved, and the reasoning is worth keeping because the lead adopted it and the underlying
behaviour still exists elsewhere.

Under copy, propagation rewrote every byte, so run 1 showed a wall of reformatting noise unrelated to
the change — and worse, `propagation.md` §D1 found the serializer double-escapes entities on every
cycle, so `&amp;` → `&amp;amp;` compounds. Under reference the write is one attribute, so **the
roll-out screen has no reformat to explain.**

Two things survive:

1. **Diff canonical-vs-canonical anyway** — `serialize(parse(before))` against `after` — because the
   *expansion* diff is generated, and generated MJML should be compared like-for-like.
2. **The reasoning about how to tell users, which now applies to ordinary editing**, since any
   canvas edit still re-serializes the whole template. My argument against a notice stands and the
   lead adopted it verbatim: a blocking interruption for a non-decision trains people to dismiss the
   dialogs that matter. And **do not frame it as "first propagation"** — it is first-write-by-us, and
   a template hand-edited afterwards gets reformatted again. *"First" is a lie that breaks the second
   time.* Frame it as a property of the template's state: *not yet normalized*.

The entity bug (Phase §0.2) still gates any "no visual change" claim anywhere in the product, so that
blocking caveat stands — it is now a template-editing concern rather than a roll-out one.

### 4.6 After rolling out

A result state at the same URL — not a toast, because `runId` must stay findable an hour later.

```
│  Rolled out Footer r5 — 22 applied, 1 needs a re-check, 3 never reached                   │
│                                                                                            │
│    ✓ 22 applied                                                            [ view list ]   │
│    ▲  1 failed-stale   Receipt — edited by someone else while you reviewed [ re-plan ]     │
│    ⊘  3 never reached  Spring sale, Welcome series, Receipt                 [ details ]    │
│                                                                                            │
│    run 4f2a9c · keep this if you may want to undo later                                    │
│                                       [ Undo this run ]            [ Done ]                │
```

**The three-bucket rule holds here.** `never reached` is never folded into anything: *applied* means
we wrote, *never reached* means we could not look. Presenting them together is the lie the lead
warned about, and the counts appear in the footer next to the confirm button too, so someone who
scrolled past the header still meets them at the moment of decision.

Per-template atomic, batch non-atomic, so partial success is normal rather than an error — the
headline always shows every count and must never say "success" when part of the batch did not land.
`aborted: true` replaces the headline with `abortReason`, because "12 applied" misleads when the run
stopped because its premise was wrong.

**`failed-plan-drift` — copy drawn, wiring held.** Under copy I argued this deserved its own sentence
rather than a generic "failed", because the one moment an integrity guarantee earns its keep is the
moment it visibly fires. `propagation-designer` agrees the reasoning holds but notes the risk has
*relocated*: under reference the write is a single attribute value, so write-time drift shrinks toward
nothing, and the real exposure moves to **render time** — the expander runs on every render and every
export, and a missed expansion was measured to silently drop the component with HTTP 200 and no
warning. So the row stays drawn and unwired until the expander contract is defined.

That relocation is worth stating on its own, because it is the same shape as §0.3 and §0.4: a
silent-success path that returns 200 while dropping content. Whatever replaces `failed-plan-drift`,
the UI requirement is unchanged — **a dropped component must be visible somewhere**, and an export
that silently omits a footer is the worst version of this product's failure mode.

`failed-stale` gets `[ re-plan ]`, which mints a **new `planId`** rather than mutating this screen —
honest, because versions moved and what you would approve is genuinely a different plan.

Undo is a pin bump back, which under D-2 is exact and cannot half-succeed per template. `runId` is
durable text, not a toast.

---

## 5. The properties panel

### 5.1 Three states, not five

D-2 collapses the panel substantially. A template never contains component-owned attributes — it
contains a reference plus some `ov-*` — so there is no per-attribute ownership decoration, no
locked/default/slot, and **no "locally overridden, will conflict" state, because there is no merge
to conflict with.**

| State | Detected by | Surface |
|---|---|---|
| ordinary node | anything else | today's panel, unchanged, undecorated |
| component instance | `node.type === "mj-component"` | dedicated panel (§5.2) |
| inside a passthrough | nearest ancestor is `CustomPassthroughNode` | alarming banner (§5.4) |

My earlier four-state design and the `data-cmp-own` pushback are both deleted by the verdict. Noted
in §8.3 rather than quietly dropped, because the reasoning ("`locked` and `default` have opposite
consequences when a user edits them") was sound *for the model it addressed* and would be sound
again if anyone reopens D-2.

### 5.2 The instance panel

**My first sketch here was incoherent, and I inherited the error rather than inventing it.** I drew a
`Footer` with "Button label" and "Button link" fields — copied from `schema.md`'s worked example,
which put `ov-href` and `ov-text` on a component rooted at `mj-section`, an element that has neither
an `href` nor text content. `schema-designer` caught it in their own document and corrected the rule:

> **`ov-<attribute>` sets that attribute on the single root element, and nothing else.** `ov-text` is
> the one reserved name, valid only when `BLOCK_REGISTRY[rootTag].contentField === "text"` — so
> `mj-text`, `mj-button`, `mj-social-element`. On any other root it is a **422 at save**, not a
> silent no-op.

Two examples, because one example is how the incoherent version survived several exchanges:

```
 ── section-rooted (Footer) ─────────────────     ── button-rooted (CTA) ───────────────────
┌─ Properties ──────────────────────────────┐    ┌─ Properties ──────────────────────────────┐
│  Footer                      mj-component │    │  Sale CTA                    mj-component │
│  ╭───────────────────────────────────────╮│    │  ╭───────────────────────────────────────╮│
│  │ 🔗 shoe-brand/footer   · mj-section   ││    │  │ 🔗 shoe-brand/sale-cta  · mj-button   ││
│  │    pinned to r4 · r5 available  [ ↑ ] ││    │  │    pinned to r7                       ││
│  │    [ Edit in library ]  [ Detach ]    ││    │  │    [ Edit in library ]  [ Detach ]    ││
│  ╰───────────────────────────────────────╯│    │  ╰───────────────────────────────────────╯│
│                                            │    │                                            │
│  SET FOR THIS TEMPLATE                     │    │  SET FOR THIS TEMPLATE                     │
│   Background colour                      ↺ │    │   Label                                  ↺ │
│   [■] [ #111111              ]             │    │   [ Shop the sale          ]               │
│   Footer r4 uses #f5f5f5                   │    │   Sale CTA r7 uses “Shop now”              │
│                                            │    │                                            │
│   Padding             from component       │    │   Link                from component       │
│   [ 20px 0                   ]             │    │   [ https://acme.com/sale  ]               │
│                                            │    │                                            │
│   Everything else is controlled by Footer   │    │   Everything else is controlled by Sale    │
│   and updates when Footer does.             │    │   CTA and updates when it does.            │
└────────────────────────────────────────────┘    └────────────────────────────────────────────┘
   4 possible fields, no text field                  7 possible fields, text field valid
```

**Two reasons a field is absent, and they need different treatment.** `schema-designer` found the
second while tracing the bad example: `verdict-model.md:159` specifies two policies, so an author can
mark attributes **owned** (`mj-own` on the root, §3.4). The panel therefore has three states, not
two:

| Case | Cause | Panel | Route out |
|---|---|---|---|
| overridable | in `allowedAttrs`, not owned | editable field | — |
| **owned by the component** | author marked it | **shown, locked** | *edit the component* |
| **not addressable** | below the root | **not shown at all** | *detach, or slots* |

**Owned attributes are shown locked rather than omitted**, for the same reason the disabled conflict
toggle is drawn rather than hidden (§4.4): an invisible policy reads as no policy. A greyed
"Background colour — owned by Footer · [edit the component]" tells the user the attribute exists,
that someone decided this deliberately, and where to go. Omitting it makes a deliberate decision
look like a missing feature.

**And the emptiness that remains is still the signal — but only the third row.** A section-rooted
Footer cannot override its unsubscribe link because that link is *below the root*, not because
anyone locked it. That absence is precisely what experiment 0.1(b) measures and what slots would
answer, so it must stay visibly empty. Locked rows do not count as filling it: a panel full of grey
locked fields and no editable ones is a different diagnosis entirely, and conflating the two would
hide the mechanism gap behind the author's choices.

**One consequence that simplifies the panel: the field list is derivable client-side.**
`allowedAttrs[rootTag] − ownedAttrs` gives the editable set, `ownedAttrs` gives the locked set, and
`contentField` says whether `ov-text` is legal — all from the palette payload, which now carries
`ownedAttrs` alongside `rootTag` for exactly this reason. So the fields render **immediately**, with
no fetch; only the comparison values (*"Footer r4 uses #f5f5f5"*) need `…/versions/:v`. Same
synchronous/async split as override detection, now covering the whole panel: **structure is local,
history is remote.**

> **But the client's derivation must not be the only enforcement**, and there is a live hazard in
> reusing `allowedAttrs` this way. `registry.ts:20-25` documents it as *"the set of attributes the
> canvas surfaces in its property panel"* — **explicitly a UI view filter and explicitly not a
> validation gate.** This design makes it one.
>
> The consequence lands squarely on this lane: **adding an attribute to `allowedAttrs` to get a form
> field is now a permission change**, silently widening what every instance of every component may
> override. The person most likely to do that is a UI developer adding a field, and the comment
> currently sitting there will actively reassure them it is safe.
>
> So: **update that comment in the same change**, and have the server compute the set from the same
> source. It can — `registry.ts` is already imported by both sides, which makes it the counterexample
> to the `ALLOWED_MODELS` duplication (§0.5) and the reason that one is a bug: it did not do this.
>
> I think the trade is right — *"what you can change on a block"* and *"what you can override on an
> instance"* being the same set is a good user-facing invariant, and a second list would drift from
> the first exactly like the model allow-list did. But it is load-bearing reuse of something whose
> own comment says it is not load-bearing, and that is worth fixing at the source rather than
> remembering.

Two field states, not four: **set for this template** (has `ov-*`, shows `↺ revert`) or **from
component** (inherited; typing in it creates the `ov-*`).

Detection is **synchronous and cannot be stale**: an override is a literal `ov-` attribute on the
node, so "is this overridden, and which attributes?" reads straight off `node.attrs`. Only the
comparison value — *"Footer r4 uses 'Learn more'"* — needs `…/versions/:v`, so it loads
progressively. This is the two-phase split I argued for under the copy model, satisfied more
directly: `propagation-designer` pointed out the hash I wanted is unnecessary here because the
override is not derived from anything, it *is* the stored value. Same first-paint guarantee, one
fewer mechanism.

`component-id` is a readable slug pair (`shoe-brand/footer`), not a UUID, so **the panel renders a
meaningful label with no lookup at all** — the identity block paints instantly even offline, and the
network is only ever needed for field values and the "r5 available" state.

The closing sentence is a promise the copy model could not make: under copy, "will my edit survive
the next propagation?" had a three-way answer depending on policy. Under reference an `ov-*` applies
*after* expansion, so propagation never reads it.

**But the unconditional version of that promise is now wrong, and I had decided to hold it one round
too long.** I chose to keep *"a re-pin carries every override forward untouched"* unqualified on the
grounds that the only exception was conditional on 0.1(b) sending us to slots — a branch that might
never happen, and a hedge against it would have been a permanent tax on the panel's clearest
sentence. That reasoning was sound and is now obsolete, because `ownedAttrs` **landed**, and it
brings a second exception that is real today rather than conditional:

| Exception | When | Surfaces as |
|---|---|---|
| r5 marks **owned** an attribute this instance overrides | **now** — locking exists | blocking row at dry-run |
| r5 removes a **slot** this instance overrides | only if slots land | blocking row at dry-run |

Both are static, both are caught at dry-run, and neither is a silent merge — so the propagation model
is intact and this is still far stronger than anything copy could offer. But the copy has to say it:

> **"Overrides carry forward unless the component's policy changed."**

`schema-designer` has now qualified that guarantee twice, which is the signal to write the qualified
form rather than patch it a third time. The distinction that makes the sentence still worth having:
the exceptions are *policy* changes, which are deliberate acts by a named person, not merge accidents
— so "unless the component's policy changed" points at something a user can go and look at.

> **The constraint that worries me most in this design.** `schema-designer` has scoped `ov-*` to
> **flat, root-level** targets: attributes of the component's root element plus one designated text
> node. Anything reaching below the root — the `href` of a button nested inside a footer, the CTA
> label in a product card — is explicitly out of scope and would need a target syntax.
>
> Those below-root cases are the overrides email components actually need. A footer whose root is
> `mj-section` can have its background overridden but not its unsubscribe link; a product card can
> have its padding overridden but not its CTA. If that holds, `[ Detach ]` stops being the escape
> hatch and becomes the routine path — which is the copy model arrived at by attrition, with worse
> ergonomics and a one-way door.
>
> §5.5's overlay makes this land harder than it reads here: users will click the inner button
> constantly, and the panel's honest answer will be "that part is controlled by Footer". That is a
> good answer once; it is a product problem on the twentieth click. Concrete ask in §8.1.

`[ ↑ ]` next to "r5 available" bumps this one instance. It does not write directly — it opens the
roll-out screen scoped to this template, so the review-before-write principle holds at every entry
point rather than having a quiet back door for single instances.

**Double-click a component instance on the canvas opens it in the library.** The interior is not in
the template, so the natural "I want to change this" gesture needs somewhere to go, and the component
editor is where it goes. Without this the interior reads as broken rather than as elsewhere. The full
gesture ladder, and what a click inside an expansion resolves to, is §5.5.

### 5.3 What detach actually costs

`[ Detach ]` is a **one-way expand-in-place**: the `<mj-component/>` tag is replaced by the expanded
MJML of its currently pinned revision, and the link is gone.

Under copy, detach merely removed markers and the bytes stayed. Under reference it **materialises
bytes that were previously virtual** — the template file grows, sometimes a lot, and the operation
cannot be undone by re-linking. So the confirm has to say all three things:

```
┌──────────────────────────────────────────────────┐
│  Detach this footer from the component?          │
│                                                   │
│  The footer will look exactly the same, but its  │
│  content is copied into this template and will   │
│  no longer update when Footer changes.           │
│                                                   │
│  This cannot be undone — re-linking is not       │
│  supported.                                       │
│                                                   │
│              [ Cancel ]  [ Detach ]              │
└──────────────────────────────────────────────────┘
```

"Looks exactly the same" is the part people need first, because the visual no-op is what makes the
action feel safe; "cannot be undone" is the part they need second. Leading with the warning would
make a routine, legitimate operation feel dangerous, and an agency that is scared of detach will
avoid components altogether — which is the failure mode this whole feature exists to prevent.

**Settled: detach is SHALLOW.** The lead adjudicated it. Recording both options because the
post-detach panel differs and the reasoning should not have to be rediscovered:

- **Shallow** — inline the Footer's body, leave any nested `<mj-component/>` as real references. The
  Button now *has* a tag in this template, so it becomes independently selectable and overridable.
  The tree under the instance changes; §5.5's rule does not.
- **Deep** — recursively expand everything. No references remain, nothing is overridable, everything
  is plain MJML and directly editable.

**Shallow — and `schema-designer`'s argument settles it rather than merely favouring it: shallow
composes, deep doesn't.** Shallow-detaching twice equals a deep detach; nothing gets you back from
deep. Since detach is explicitly one-way, the only defensible default is the primitive that can be
*repeated into* the other one. Same shape as pin-over-float: ship the recoverable direction. That
makes shallow correct on structure, not just conservative by temperament — which is a better reason
than the one I had.

The supporting reasons still hold. Deep quietly converts a component tree into plain MJML — the copy
model by attrition, arriving through the detach button rather than through `ov-*` scope, which
`schema.md` already warns about by the other route. And if what the user actually needed to change
lives in the nested Button, shallow makes them detach again: **two severances costing two decisions
is better than one click severing an unknown number.**

**The post-detach panel is a normal instance panel for the nested Button** — `schema-designer`
confirms the tag survives verbatim, *carrying whatever `ov-*` the Footer revision had applied to it*,
so the Button is still pinned, still propagating, still overridable. The one difference worth showing
is ownership: **the pin now belongs to this template directly** rather than being inherited through
the Footer. Same panel, one changed sentence.

**The confirm must say what stays linked, not only what is severed.** This is the scope-disclosure
invariant (§2.1) **inverted** — here the effect is *narrower* than the user assumes, and silence
produces the worst possible lesson about a one-way action: *"I detached it and it still changed on
me."* So:

```
│  This Footer becomes a normal block.                   │
│  The Button inside it stays linked to the library      │
│  and will keep updating.                               │
```

It is case 6 of the invariant, and the only one where the disclosure protects against *under*-
estimating what survives rather than over-estimating what changed.

**And detach can fail, so the dialog needs a failure path.** `schema-designer` is adding validation
that every nested reference resolves *before* writing — otherwise a dangling nested reference lands
in the template and the hard-fail turns it into a 500 at render. That means the confirm button is
not a guaranteed-success action: it needs an error state ("couldn't detach — a component inside this
one is missing"), which is easy to forget on a dialog whose whole design assumes the operation is
local and certain.

**And `schema-designer` put a caution on this that I want to keep visible, because it is the kind
that gets lost:** careful ordering here is good copy on a *rare* action and a **smell** on a frequent
one. If 0.1(b) comes back below-root-dominant and detach becomes the routine escape from an override
mechanism that cannot express what people need, this dialog's wording would be doing load-bearing
work to soften a mechanism failure — and doing it well enough that nobody notices the mechanism is
wrong.

So: **how often this dialog appears is the signal to watch**, and it is the one piece of
instrumentation I would ask for in this plan. A detach rate that climbs is not a UX finding about
the dialog; it is evidence that `ov-*` is under-powered, and the response is to fix the mechanism,
not the wording. Worth stating before the copy gets praised for reducing friction on an action that
should have been rare.

**Record which component each detach was on, at the same time** — `schema-designer`'s addition, and
it costs one column. Concentrated on one component → that component needs slots, a cheap fix.
Spread evenly → the mechanism is under-powered, a redesign. Same datum either way, and without the
second field the number tells you something is wrong but not which of two very differently-priced
things it is. It is the same shape as the third measurement in 0.1(b), which is a good sign the
distinction is real rather than an artefact of how we are counting.

### 5.4 Inside a passthrough container

The loudest affordance in the panel, and a whole-panel banner rather than a per-field decoration,
because it invalidates everything below it:

```
│  ╭───────────────────────────────────────────╮│
│  │ ⊘ Not under component control             ││
│  │                                            ││
│  │   This sits inside an <mj-hero>, which     ││
│  │   the editor cannot see into. It still     ││
│  │   renders, but Footer updates will never   ││
│  │   reach it — it stays as it is until       ││
│  │   someone edits it by hand.                ││
│  ╰───────────────────────────────────────────╯│
```

Alarming because the brand's design system **silently does not apply here**, and this is the only
screen where the user is looking at the specific block while able to act. Everywhere else they see a
count. The wording avoids blame and avoids implying a fix we can perform.

**It names the tag** (`<mj-hero>`, not "a container") for the reason in §0.4: once `mj-wrapper` is in
the registry, the next gap should report itself through this string rather than through a support
ticket.

**Class B needs different words, and probably a different remedy** (§0.6). The banner above blames a
container the user chose, and invites a fix — remove the `mj-hero`, or ask for it to be supported.
Neither applies when the cause is that they put a link in a sentence:

```
│  ╭───────────────────────────────────────────╮│
│  │ ⊘ This text block can only be edited as   ││
│  │   code                                     ││
│  │                                            ││
│  │   It contains formatting (a link, bold     ││
│  │   text), which the visual editor doesn't   ││
│  │   handle yet. The text and its styling     ││
│  │   are safe — they just aren't editable     ││
│  │   as fields here.                          ││
│  ╰───────────────────────────────────────────╯│
```

Not "not under component control", because for a plain rich-text block that framing is both alarming
and beside the point — nothing is at risk, a capability is simply missing. It reads as a tool
limitation, which is what it is, rather than as damage. The raw-MJML textarea below it is then the
editor rather than the consolation.

**The axis is not volume, and `schema-designer` corrected me here.** I had said that if rich
`mj-text` turns out to be routine the banner should get *quieter*. That is the wrong response, and
quieter would just be a fallback with better manners. The real distinction:

> **A code affordance hit daily is an editor. One hit rarely is an escape hatch.**
> The §0.6 count decides which one we are building — not how loud it should be.

If rich text is routine, the raw-MJML textarea stops being a consolation prize and becomes **the
primary text-editing path for a large share of blocks**, and it should be designed as a first-class
editor: syntax highlighting, sane sizing, validation feedback, probably a formatting toolbar that
writes the markup for people who do not want to type `<a href>`. That is a real piece of work and a
completely different plan item from a banner.

So §5.4's copy above is provisional on the count coming back "rare". I would not invest in polishing
that message before knowing, because if the answer is "routine" the message largely disappears in
favour of the editor.

> **`schema-designer` flagged the way this decays, and they are right to.** "Provisional on a count"
> becomes permanent when the count never gets run — and since the fallback-with-manners is much the
> cheaper build, that is the direction it drifts under schedule pressure. The banner ships, the
> editor never does, and nobody revisits it because the banner *works*.
>
> The guard is that the count needs no fixtures and no setup: **parse ten real templates, count
> `mj-text` nodes whose parse yields `mj-custom-passthrough`.** Ten minutes. They also note their own
> "a meaningful share of real templates" is inference from how email is written rather than a
> measurement — which is the right thing to admit and the reason neither of us should design around
> it. Treat this as a blocker on §5.4's copy rather than a note attached to it: if the count has not
> been run, the honest state of that design is *unknown*, not *rare*.

**The same fork applies to the component editor, and harder.** A component whose body is formatted
copy — a footer with an unsubscribe link, which is most footers — is authored through that textarea
*inside its own editor*. If rich text is rare, "the library's authoring experience is weakest for the
content type email uses most" is a caveat to note. If it is routine, that textarea **is** the
component authoring experience for footers, and it stops being a caveat and becomes the thing to fix
before §3.3 ships. One ten-minute count decides between a footnote and a workstream, which is the
best ratio in this document.

### 5.5 Two trees: what the canvas actually selects under reference

`propagation-designer` handed this over explicitly as a design question rather than plumbing, and
they are right that it is one. It is the largest genuinely new work item D-2 creates.

**The problem.** The stored template contains `<mj-component/>` leaf tags; the rendered HTML contains
the *expanded* content. Two measurements bound the solution:

- Stamping **stored** source against **expanded** HTML silently mis-stamps (§0.3) — perfect counts,
  wrong boxes.
- The `css-class="mjcmp-<pathKey>"` anchor `schema.md` proposed **fails for `mj-section`**: mjml puts
  `css-class` on an outer `<div>` while `stampPaths` stamps a bare `<table>` with no class attribute.
  It works for `mj-column` only, so it cannot be the general anchor.

> **Two documents currently specify incompatible overlay mechanisms.** `schema.md:958` still has
> `stampPaths.ts` treating `mj-component` as a stampable leaf via `matchesComponentInstance`,
> anchored on `css-class` injection — i.e. stamping the *stored* source, which both measurements
> refute. `propagation-designer` has said this version should win. If it does, **`css-class`
> injection is deleted rather than fixed**: stamping the expanded source needs no HTML-side anchor
> at all, so that whole mechanism and its `matchesComponentInstance` matcher come out. Worth
> resolving before either is built, since they are mutually exclusive and one is already written
> down in two places.

**So stamp the expanded source.** Which means overlay paths address the *expanded* tree, while
editing addresses the *stored* tree, and something has to map between them.

**This needs a contract that does not exist yet, on a module that has not been written.**
`propagation-designer` caught that `schema.md:951` specs `componentExpander.ts` as returning a
string, and the provenance §5.5 needs exists *only inside the expander at the moment of
substitution*. You cannot reconstruct "this `<mj-text>` came from the footer's headline slot" from
the expanded string afterwards. They invited me to name the shape, so:

**There are two contracts at two boundaries, and conflating them is the trap.** The expander's
natural output is byte-ranged, because substitution happens at offsets. The overlay's natural input
is path-keyed, because that is what stamping produces. The join belongs on the server, in between.

**First correction: the join cannot be offset-based, and I had that wrong.** I claimed the offsets
were "available rather than needing inventing". That holds for the *expander*, which scans strings —
and is false for everything downstream. `propagation-designer` checked, and I verified:

- `BlockNode` is `{id, type, attrs, children?, text?}` — no offsets (`types.ts` has no `start`).
- `PlanEntry` is `{pathKey, type, isContainer, childrenStart?, childrenEnd?}` — and those two are
  **indices into the plan array**, not source offsets. Easy to misread as the opposite.
- `StampResult` is `{html, stamped, expected, missing}` — no per-path source information.

`parser.ts` does compute `el.start`/`el.end`, but they are locals inside `readElement`, used to slice
`rawXml` and then dropped. **The stamper walks a tree that has forgotten where it came from.** So
"find the region containing its source offset" has nothing to join on.

Adding offsets to `BlockNode` is the wrong fix twice over: they go stale on the first mutation, and
they would land in the core type the round-trip property gate is about to start asserting on.

*Boundary 1 — expander → render endpoint:*

```ts
interface ExpansionRegion {
  start: number; end: number;              // offsets into the expanded mjml — expander-internal
  expandedPathRange: [number, number];     // top-level expanded indices this region occupies
  componentId: string;                     // "shoe-brand/footer"
  revision: number;
  instancePath: string;                    // stored path of the <mj-component/> it replaced
  overridable: Map<string, string>;        // inner path within the region → ov-* key
}
expandTemplate(mjml): { mjml: string; regions: ExpansionRegion[] }
```

`expandedPathRange` makes the join **path-to-path**, needing no offsets anywhere in it. It is
bookkeeping the expander already does: `usageExtractor` gives it `instancePath`, it knows which
stored node it replaced, and it knows how many top-level nodes it emitted — `stored path 1 →
expanded paths 1..3` falls out of the substitution itself. Boundary 2 does not change at all, and
the "no byte offsets in the browser" constraint gets *stronger*, because now they have no route
there even in principle.

*Boundary 2 — render endpoint → browser (path-keyed):*

```ts
interface StampedPathInfo {
  storedPath: string | null;     // null ⇒ exists only inside an expansion
  instancePath: string[];        // nesting chain, OUTERMOST FIRST; [] when not in a component
  overridable: string | null;    // the ov-* key settable from THIS template, if any
}
// GET /api/render → { html,
//                     unstamped: string[],                      // §5.6 — not stamped
//                     mjmlErrors: Array<{ message; tagName? }>,   // §5.6 — tiers 1 and 2
//                     paths: Record<string, StampedPathInfo> }
```

**Second correction: `instancePath` is a chain, not a string.** `schema.md` allows a component body
to contain `<mj-component/>` to a depth of 5, so regions nest and one expanded path can sit inside
several. A singular field can only name one of them.

The transport carries the chain so the UI owns the choice — same reasoning as keeping byte offsets
out of the browser: **do not let the transport make a decision the UI should own.**

The cost of getting this wrong is asymmetric: a return-type change on an unwritten module is free
today and expensive the moment `componentExpander.ts` has callers.

**The single-root invariant is what makes the mapping arithmetic instead of a search — and this
overlay is the first thing that breaks if it is ever traded away.** With exactly one root element
per component revision, one stored `<mj-component/>` node expands to exactly one top-level node, so
sibling indices never shift. Two consequences worth writing down:

- **Any stored path is literally the same path in the expanded tree.** Resolving `storedPath` is
  therefore: walk up the expanded path until you hit an instance root; at or above it the path is
  unchanged, below it there is no stored counterpart. No search, no fuzzy matching, and the result
  is auditable by inspection.
- **`expandedPathRange` is `[n, n]` today, by that invariant.** Keep it a range anyway. It is the
  one place where relaxing the invariant would otherwise become a breaking change to a boundary
  that already has two implementations; as a range, it degrades to bookkeeping. Somebody will
  eventually notice the two numbers are always equal and want to simplify it to a scalar — this
  paragraph is why not.

If multi-root components are ever proposed as a convenience elsewhere, the cost lands here, and it
is not a small one.

**And `missing[]` will not warn you if any of this is wrong.** §0.3's measurement — `stamped=3/3,
missing=[]` with top-level path `"1"` landing on the footer instead of the section — means the
existing signal stays silent for mapping errors by construction. `unstamped[]` (§5.6) does not cover
it either. The mapping is guarded by `web.Canvas.pathMapping.spec.tsx` and by nothing else at
runtime.

**Selection rule: clicking inside a component expansion selects the whole instance.** Not the inner
node — it has no stored identity, and pretending otherwise gives the user a selection they cannot act
on. This is what every design tool does with component instances, it is what the breadcrumb already
does for ancestors, and it makes the gesture ladder coherent:

| Gesture | On ordinary content | Inside a component expansion |
|---|---|---|
| click | select that node | select the **instance** |
| double-click | inline text edit | **open the component in the library** |
| drag | reorder | reorder the **instance**; drops *into* an expansion rejected |
| Backspace | delete node | delete the **instance** |

**A gap I had not covered: placing a component from the palette.** The rail needs a Components group
alongside Layout and Content (§1.5), and dropping one has a problem the existing palette does not:
`resolveInsertion` in `Canvas.tsx` keys every decision on `BlockType`, and **every instance is
`mj-component` regardless of what it expands to.** A footer rooted at `mj-section` and a badge rooted
at `mj-image` need opposite insertion behaviour and are indistinguishable to that function.

`schema-designer` has added **`root_tag` to `component_revisions`** (derived at publish, guaranteed
single by the one-root invariant) precisely so the client can resolve this locally with no fetch.
Concretely: the palette item carries `{ kind: "palette-component", componentId, rootTag }`, and
`resolveInsertion` reads `rootTag` wherever it currently reads `type`. Everything downstream —
column-finding, section synthesis, the drop indicator — then works unchanged, which is the point.

They suspected I would want this for drag feedback, and I do: without it a component drop either has
no live indicator or has a lying one, and the drop indicator lying about where a block will land is
the one thing `resolveInsertion`'s design comment says it exists to prevent.

**And one refinement that earns its keep:** when the clicked inner node maps to an `overridable` key,
the instance panel scrolls to and highlights that field.

My earlier example of this was the same incoherent one corrected in §5.2, so state it against the
real rule. `overridable` can only ever name an attribute of the **root** element, so:

- **Click the root itself** — the button of a button-rooted CTA — and the matching field highlights.
  Signpost.
- **Click a node inside a section-rooted Footer** — the unsubscribe link, say — and **nothing
  highlights, because nothing can.** The panel's honest answer is "controlled by Footer", with the
  two routes out (§5.2): edit the component, or detach.

The second case is not a degraded version of the first; it is the common one today, and it is where
the limitation becomes *visible* rather than merely true. That visibility is the point — a user who
clicks the unsubscribe link and is told plainly that it belongs to the Footer has learned the system,
whereas one who finds a field that silently does nothing has learned to distrust it.

**Nested components: select the outermost, and resolve `overridable` from the outermost too.**
`propagation-designer` handed me this decision and guessed outermost for selection, which I agree
with — and suggested innermost-wins for `overridable`, which I think is wrong, for the same reason
the selection rule is right.

Selection is outermost because the base rule already decides it: *a node with no stored identity in
this document cannot be selected, because any selection of it is a promise the system cannot keep.*
A Button instance nested inside a Footer's revision has **no `<mj-component/>` tag in this
template** — it lives in the Footer's revision, in the library. You cannot detach it here, re-pin it
here, or override it here. Selecting it would offer all three and honour none.

That same fact settles `overridable`, in the other direction from the suggestion: **in this template
exactly one `<mj-component/>` tag exists per top-level region, so only its `ov-*` keys are settable
here.** The nested Button's own slots are set by editing the Footer component, not from this
template. Innermost-wins would highlight a field that does not exist in the panel — precisely the
promise-we-can't-keep failure, reintroduced one level down.

`propagation-designer` agreed and sharpened it into something simpler than either of us first
framed: **it is not a resolution rule at all.** Nested regions contribute no keys, so there is
nothing to resolve *between* regions — `overridable` is just the outermost region's map. Not
"outermost wins", merely "outermost".

> **One implementation note that decides whether this survives the open scope question.** `schema.md`
> leaves open whether `ov-*` can address below the component root (§8.1 item 0). If it resolves to
> declared below-root slots, a Footer could declare a slot reaching a node that physically sits
> *inside its nested Button region*. That is still outermost in terms of which tag you write to — but
> it means `overridable` must map an innerPath lying inside a nested region to an **outer** key.
>
> The shape above handles that for free **provided `overridable` is keyed by innerPath-within-the-
> outermost-region and is not partitioned per region.** The natural implementation builds one map
> per region and merges, and that version breaks the moment below-root slots land. Cheap to get
> right now, silently wrong later.

So the chain is carried **not for choosing but for explaining.** The panel renders it as context —
*"Button, inside your Footer"* — which answers "why can't I edit this button?" far better than
silence, and it comes with the two routes out that `schema.md` already frames as the
design-system-correct answer: **edit the Footer component** (affects all 23) or **detach this
instance**. That turns the restriction into a fork rather than a wall, and it only works because the
chain is carried for explanation rather than discarded after the decision.

**Overlay styling must distinguish the two trees**, or the rule above reads as a bug: nodes inside an
expansion get a distinct non-editable treatment (tinted fill, no drag handle, no resize), so "why
can't I grab this" is answered before it is asked.

**Concrete changes this forces in existing canvas code**, none of which are large individually:

- `OverlayTree` — a second box style, and hit-testing that resolves to `instancePath` when present.
- `Canvas.selectByPathKey` — map expanded → stored before setting `selectedPath`.
- `Canvas.handleOverlayDoubleClick` — currently begins inline edit for `mj-text`/`mj-button`; must
  instead route to the library when the target is inside an expansion, or to the `ov-text` field.
- `Canvas.handleDragEnd` — `reorderInDoc` operates on stored paths; reject drops whose resolved
  target is inside an expansion.
- `InlineTextEditor` — its ordinal+`expectedText` matching runs against rendered text, which now
  includes component interiors. Text inside an expansion must not become editable in place.

This is the one area where "the canvas is unchanged" (§0.1) stops being true. It is still a provider
swap for the *component editor*; it is not a no-op for the *template editor* once instances exist.
Worth saying plainly because my earlier drafts implied the canvas got off free.

### 5.6 When the canvas cannot select a block at all

Given `/api/render` returning `unstamped: string[]` (§0.3), `Canvas` renders a non-blocking chip
beside the save-status chip:

```
│  ⊘ 3 blocks can't be selected here          [ why? ]  │
```

Informational, does not block editing, does not nag — but it converts a permanent silent failure into
a visible, explicable one. It also gives the deferred mjml 4→5 bump a smoke alarm: if that upgrade
changes render output and the matchers stop covering a block type, today's symptom is "selection
mysteriously stopped working" reported weeks later; with the chip it is visible on the first render.

**There are three ways the canvas can lie, and the chip only covers one.** They look identical to a
user and have nothing else in common:

| Failure | Symptom | Detected by |
|---|---|---|
| block not stamped | can't be selected | `unstamped[]` → the chip |
| path mis-mapped | selecting picks the wrong block | **nothing at runtime** — §5.5, test only |
| component not expanded | **the block is not there at all** | 422, or `mjmlErrors` w/ `tagName: "mj-component"` |

`schema-designer` measured the third: an unexpanded `mj-component` reaching the compiler yields
`errors: ["Element mj-component doesn't exist or is not registered"]`, **drops the tag, renders
everything else, and returns 200.** The canvas shows a footerless email and says nothing. So does the
preview. So, presumably, does an export.

> **The table stays at three rows, and that is a tested result rather than an omission.**
> `schema-designer` hypothesised a fourth — a component that expands fine but lands somewhere MJML
> rejects, e.g. an `mj-section` root dropped inside an `mj-column` — and probed it three ways. MJML
> **renders the content anyway** and reports the error. So misplacement is a *quality* failure
> (probably-broken table nesting in real clients), not a missing-content one, and it does not belong
> in this table. Recorded because the hypothesis was reasonable and someone will have it again.

### The contract, which turns out to be bigger than components

Chasing that probe, `schema-designer` found something that predates all of this work.
`render.ts:66-69` casts the compile result as `{ html: string; errors?: unknown[] }` — **someone knew
the field was there** — and then reads only `.html`. Every MJML validation error this product has
ever produced has been discarded, on every render, component-related or not.

```ts
200 -> { html, unstamped: string[], mjmlErrors: Array<{ message; tagName? }> }
422 -> { error, instancePath?, reason }
```

**Pick those two fields explicitly; do not pass `result.errors` through.** `schema-designer` probed
the real error object rather than assuming, and it carries two things that must not travel:

```json
{ "line": 1,
  "message": "Element mj-component doesn't exist or is not registered",
  "tagName": "mj-component",
  "formattedMessage": "Line 1 of /Users/keunbae/code/email-design-system (mj-component) — …" }
```

- **`formattedMessage` interpolates the server's absolute filesystem path** when mjml is given no
  `filePath`. Low severity for a localhost deployer, but `OPERATIONS.md:126-134` anticipates
  reverse-proxied and private-network deployments, and it is gratuitous in every case because the UI
  needs none of it.
- **`line` is a line number in the *expanded* document**, so it has no correspondence to the stored
  template the user is looking at. Handing it to a UI that displays stored source would point
  confidently at the wrong place — **worse than omitting it, because a plausible line number gets
  trusted.** Include it only if someone translates it through the expander's region map first.

`tagName` is confirmed exact on both paths (body level and nested in a column), so the tier-1
classifier needs no string matching — which is the whole reason the field is load-bearing.

> **The rule underneath all three of these, worth stating once.** Byte offsets (§5.5), overlay paths
> (§5.5) and now line numbers are the same hazard: **a value computed against the expanded document
> is in a coordinate space the browser does not have.** Expansion is a coordinate-space boundary, and
> *nothing computed against the expanded document crosses it untranslated* — it is translated, or it
> stays server-side. Three instances found separately, by three different routes; a fourth will
> appear, and this is the sentence that should catch it.
>
> And the clause that makes it operational, from `schema-designer`: **never pass a value through
> because it looks useful. A wrong coordinate is worse than an absent one — an absent one is
> ignored, a wrong one is trusted.** That is the exact pressure that would otherwise reintroduce
> `line`, since a line number on an error object looks obviously helpful right up until you ask what
> document it indexes.

**`expansionErrors` on the 200 is deleted, and that is right — but the tier-1 *screen* is not.**
`schema-designer` caught that they had specced a field that can never fill: `expand()` is
all-or-nothing, so a 200 can never carry an expansion error and the array would have been
permanently empty — the kind of field someone eventually deletes or repurposes into something it was
not.

The correction is easy to over-apply, so state the residue explicitly, because it is
`propagation-designer`'s backstop and it would be lost by a careless reading:

| Path | Reaches | Response | Screen |
|---|---|---|---|
| expander **recognises** a reference and cannot resolve it | throws | **422** | canvas error state |
| expander **never recognises** it (bug, unhandled form) | mjml | **200**, tag dropped | **tier-1 banner** |

The second row is exactly the class the guard cannot see, it lands on a 200, and it arrives through
`mjmlErrors` — cleanly, with **no string matching**, because those entries carry
`tagName: "mj-component"`. So tier 1 on a 200 is
`mjmlErrors.some(e => e.tagName === "mj-component")`.

Deleting the field is correct; deleting the banner with it would remove the only detector for the
one failure the guard is blind to.

`mjmlErrors` is free — already in the return value being thrown away. The 422 path covers what
never reaches the compiler: unresolvable reference, missing revision, depth cap.

> **Dropped content needs two independent detectors, not one** — `propagation-designer`'s last point
> and the one I would least want lost in implementation. The expander's throw-on-survivor guard
> (`schema.md:951`) is the primary check and it is right, but **it only fires if the expander knows
> it should have expanded something.** A bug in the guard, or a reference it never recognised as one,
> sails straight through.
>
> The second detector is mjml itself, reporting `"Element mj-component doesn't exist or is not
> registered"` — which we are now reading anyway for `mjmlErrors`, so it costs a filter on an array
> we already have.
>
> **The two fail independently, which is the only property that makes a backstop worth having** — a
> second check that fails whenever the first does is decoration. They also surface differently (422
> versus 200-with-`tagName`), which is what the table below is about: *the detectors are independent
> and so are the screens.*

**Correcting my own tier-1 design: the two feeds produce two different screens, not one banner.**
`render.ts` has landed since I wrote this, and the guard is already there — `expand()` throwing
`ExpansionError` returns **422 with no HTML at all**, with the comment *"Fail loudly. The alternative
is mjml silently dropping the reference and returning 200 with the content gone."* That is the right
call and it is stricter than what I designed. But it means:

| Feed | Outcome | What the user sees |
|---|---|---|
| expander guard | **422, nothing renders** | a full canvas error state |
| mjml error scan | 200, content silently dropped | the persistent banner (§5.6 tier 1) |

I had collapsed both into the banner. The banner is only reachable by the *second* feed — a
reference the expander never recognised as one, which is precisely the class its own guard cannot
catch. So the banner is not redundant with the 422; it is the UI for the case the 422 cannot see.

The canvas therefore needs an expansion-failure **error state** as well as the banner, and it should
say the same thing in the same register: which reference, and that nothing is being shown rather
than something partial. A 422 on the render path is currently indistinguishable from any other
render failure in `Canvas`, which would waste the loudness the server went to the trouble of
producing.

**Separate fields, because the weight distinction has to survive the merge.** So
`CanvasHealthChips` is **three tiers, not two**, ordered by consequence to the delivered email rather
than by proximity to the user's current click:

| Tier | Signal | Treatment | Because |
|---|---|---|---|
| 1 | 422, or `mjmlErrors` w/ `tagName: "mj-component"` | persistent banner, not dismissible | **what is on screen is not the email** |
| 2 | `mjmlErrors` | dismissible, collapsed by default | the email may render badly in real clients |
| 3 | `unstamped` | quiet chip | editor limitation only; the email is fine |

### Two cache traps, one of which would void tier 1's guarantee

**(i) The new fields must be returned on both cache paths, or tier 1 disappears on the second
render.** `schema-designer` caught this. `render.ts` returns `unstamped` on the miss path (where the
compile happens) and on the hit path (`{ html: cached.html, unstamped: cached.unstamped }`) — whoever
implemented it got that right. But `CacheEntry` is a fixed shape, and the natural way to add
`mjmlErrors` is to touch the miss path, where the compile result is in scope, and
forget the hit path, where there is nothing to read them from.

It fails in the way that hurts most here: **tier 1 is specified as persistent and non-dismissible
precisely because what is on screen is not the email — and it would vanish the moment the same
source renders twice.** A guarantee that evaporates on a cache hit is worse than no guarantee,
because the first render taught the user to trust it.

The test is theirs and is better than the one I would have written: **assert both paths return all
three 200-path fields — `html`, `unstamped`, `mjmlErrors`.** Cheaper and more direct than asserting "the banner persists", and it fails at the
right place.

**(ii) The cache key is content-derived, which is already most of the fix for brand tokens.**
`getCached` keys on the **expanded** MJML (it moved from `source` when expand-before-stamp landed).
`schema-designer` flagged that a brand-head merge would break a source-keyed cache — editing a brand
token changes no template's source, so every entry stays stale and the designer watches their token
edit do nothing.

Their proposed fix is to key on `source + brandId + brands.version`. I think the cheaper and more
robust version is available: **the key is already content-derived, so it is correct by construction
as long as the brand head is merged into the string that becomes the key.** Content keys
self-invalidate; composite keys rely on remembering to bump every contributing column. So the rule to
hold is narrower than the fix: *whatever the brand head touches must be inside the cache key's
input.* If the merge happens on the MJML before `getCached`, nothing else is needed. If it happens
later — injected into compiled HTML, say — the content key silently stops covering it and the
composite key becomes necessary after all.

Flagging it here because **the symptom lands in this lane first**: *"my brand colour didn't apply,
but it works after a restart"* gets diagnosed as a browser cache for about a week before anyone looks
at the server. Worth a note in `TokensRoute` for whoever debugs it.

**Two things that follow, both worth carrying.**

*The ordering should be a type, not a rule.* `schema-designer`'s answer to "which placement do we
pick" is better than picking one: make the preparation step return a branded `PreparedMjml` that
`getCached`/`setCached` accept and nothing else does. Then `source → expand → merge head → key →
compile` cannot be violated by someone adding the merge in the wrong place later. That is now the
**third** instance of the same move in this plan — alongside dropping `slug` from the update DTO
(§1.2) and scoping the service per brand — which makes it a reflex worth naming: *when a rule must
hold forever, spend the type rather than the comment.* A comment relies on the next person reading
it; a type relies on nothing.

*Content keying is not free, and the cost lands on my hot path.* Expansion and head-merge now run on
**every** request including cache hits — the LRU protects the compile, not the preparation. The
canvas re-renders on every debounced source change, so this sits directly under the most frequent
call in the product. Fine at current scale and worth watching rather than pre-optimising; if it ever
bites, the fix is a memo on the preparation step, **not** a retreat to composite keys, which would
trade a provable property for a maintained list.

(Also stale: the comment at `render.ts:118` still says *"cache key remains source-only"* while the
module header says expanded-only. Two lines from the code it describes, which is the kind that gets
trusted.)

**And tier 2's first deploy is a migration event, not a feature launch.** Turning on a stream of
errors that has been discarded since the beginning means existing templates — ones that have "always
worked" — light up the moment it ships. If that arrives unframed it reads as *"the new version broke
my templates."* The copy has to carry the history: *"MJML reports N issues with this template. These
were always present; we can now show them."* Collapsed by default is right for the same reason, and
I would not ship tier 2 in the same release as anything else that changes rendering, so the two
cannot be confused for each other.

> **But size it before designing it** — `schema-designer`'s point, and it is the same move that
> worked on Class B, which is a good sign it is the right reflex rather than a one-off. Run the
> error stream over the existing corpus and count *before* building anything:
>
> - **~3 errors total** → ship it quietly. No framing needed, no migration event, and my copy above
>   is over-engineering for a non-problem.
> - **~400** → a dismissible chip with better copy is the **wrong design**. That needs aggregation,
>   grouping by error class, or opt-in — a workstream, not a chip.
>
> Both the compiler and the corpus are already to hand, so this is the same ten-minute shape as the
> `mj-text` count. I had written the migration-event framing assuming a moderate number, which was
> an assumption I did not notice I was making. **The number decides whether tier 2 is a chip or a
> project, and nobody should write the copy before knowing which.**

This is **the fourth silent-success-with-200 in this codebase**, after `missing[]`, the expansion
drop, and the render-time expander risk in §4.6. At four — one of which predates every decision we
have made — it is a property of the codebase rather than a run of bad luck, and the useful form of
that observation is forward-looking: *when a server path can partially fail, check whether the
failure has a route to the browser or stops at a log line.* Three of the four stopped at a log line.

---

## 6. Brand switching

Top of the rail, styled as a filter, not a tenancy boundary (§1.5). Switching navigates to
`/b/:newBrandSlug/templates`, unmounting the editor. Nothing is preserved across brands and nothing
should be. Last-used brand persists to `localStorage` so `/` lands sensibly.

**The part that matters** is the pending-save flush, fixing §0.2. `useUnsavedGuard()` runs before any
navigation that unmounts a document editor:

```
data.pendingPatch === null → navigate immediately
otherwise                  → await actions.forceSave()
     resolves → navigate
     rejects  → block:
        ┌────────────────────────────────────────────────┐
        │  Couldn't save “Welcome series”                │
        │  Your last change hasn't reached the server.   │
        │  [ Retry ]  [ Discard and switch ]  [ Cancel ] │
        └────────────────────────────────────────────────┘
```

`forceSave()` already exists and resolves on 200 / rejects on 404/409/412/413/429 — wiring, not new
machinery. It runs on **three** transitions: brand switch, template→template, template→component.
Building it once fixes the pre-existing silent-drop bug as a side effect. Required for v1.

---

## 7. Files

### Created (24)

```
web/src/api/brands.ts                      listBrands, createBrand, patchBrand
web/src/api/components.ts                  components, revisions, usage
web/src/api/rollout.ts                     dryRun, getTemplateDetail, apply, undoRun

web/src/hooks/useDocument.ts               reducer + save machinery lifted from useTemplate
web/src/hooks/useComponent.ts              useDocument wrapper for the draft
web/src/hooks/useBrand.ts                  current brand from :brandSlug + BrandContext
web/src/hooks/useComponentInstance.ts      mj-component node → identity, pin, and the ov-* field
                                           list derived locally from rootTag + BLOCK_REGISTRY
web/src/hooks/useRolloutPlan.ts            plan fetch + per-template selection + detail cache
web/src/hooks/useUnsavedGuard.ts           pending-save flush before navigation (§6)

web/src/sidebar/BrandSwitcher.tsx
web/src/sidebar/ComponentList.tsx

web/src/routes/BrandsRoute.tsx
web/src/routes/ComponentLibraryRoute.tsx
web/src/routes/ComponentRoute.tsx
web/src/routes/ComponentProviders.tsx
web/src/routes/ComponentUsageRoute.tsx
web/src/routes/TokensRoute.tsx
web/src/routes/RolloutRoute.tsx            layout + header + footer + result state

web/src/library/ComponentCard.tsx
web/src/library/ComponentThumbnail.tsx     IntersectionObserver-gated render iframe

web/src/rollout/RolloutTemplateList.tsx    grouped, unreachable first (§4.2)
web/src/rollout/RolloutInstanceDetail.tsx  shadowed-override rows + Visual/Code toggle
web/src/rollout/RolloutBeforeAfter.tsx     lazy per-template expansion diff + overlay

web/src/canvas/ComponentInstancePanel.tsx  §5.2 — replaces PropertiesForm for mj-component
web/src/canvas/CanvasHealthChips.tsx       §5.6 — unstamped chip + expansion-failure banner
web/src/claude/TurnResolution.tsx          §2.1 — the four post-turn outcomes A/B/C/D
```

Deleted from earlier drafts by D-2: `PublishConflictRows` (no conflicts), `PublishMjmlDiff` as a
separate component (folds into `RolloutInstanceDetail`), `OwnershipControl` (a checkbox in
`PropertiesForm` now), `ComponentBadge` (absorbed into `ComponentInstancePanel`).

Deliberately not created: a shared `ResourceList` (§1.5); a `ComponentEmpty` route (the grid *is* the
screen); any client store of `instancePath` (§3.5).

### Modified (17)

```
web/src/App.tsx                        new route table (§1.1)
web/src/sidebar/SidebarShell.tsx       brand-scoped; picks Template vs Component providers
web/src/sidebar/TemplateList.tsx       brandSlug prop; prefixed links
web/src/routes/TemplateRoute.tsx       brand-prefixed 404 redirect
web/src/routes/TemplateProviders.tsx   renamed contexts
web/src/canvas/Canvas.tsx              brand-prefixed <Navigate>; Document contexts;
                                       <CanvasHealthChips/>; **expanded→stored path mapping in
                                       selectByPathKey, handleOverlayDoubleClick and
                                       handleDragEnd** (§5.5) — the largest single change here;
                                       plus a distinct 422 expansion-failure state, so the server's
                                       deliberate loudness is not flattened into the generic
                                       render error (§5.6)
web/src/canvas/IconRail.tsx            third group: brand components, dragging
                                       { kind: "palette-component", componentId, rootTag } (§5.5)
web/src/canvas/OverlayTree.tsx         second box style for component interiors; hit-test
                                       resolves to instancePath (§5.5)
web/src/canvas/InlineTextEditor.tsx    must not make text inside an expansion editable (§5.5)
web/src/canvas/IframePreview.tsx       consume `unstamped[]` and the path map from /api/render
web/src/canvas/RightPanel.tsx          route mj-component to ComponentInstancePanel;
                                       passthrough banner (§5.4);
                                       **drop the `<mj-wrapper>` recommendation at line 578** (§0.4)
web/src/canvas/PropertiesForm.tsx      "Templates can override this" checkbox in component mode,
                                       writing mj-own on the root; its confirmation discloses that
                                       locking applies from the next revision only (§3.4, case 7)
web/src/hooks/useTemplate.ts           becomes a useDocument wrapper
web/src/api/templates.ts               brandSlug on every function; runQuery too
web/src/settings/Settings.tsx          import ALLOWED_MODELS from @shared instead of declaring
                                       its own copy (§0.5) — otherwise unchanged
web/src/claude/SidebarQueryInput.tsx   gains a reply surface hosting <TurnResolution/> (§2.1) —
                                       previously "no change", now unavoidable
web/src/styles.css                     new classes
```

`web/vite.config.ts` needs **no change**.

### Adjacent work this lane surfaces but does not own

- **`/api/render` returns `unstamped: string[]`** (§0.3) — adopted into Phase 0; §5.6 needs it.
- **`/api/render` returns `mjmlErrors[]`** (§5.6) — free, since `render.ts:66-69` already types
  `errors?: unknown[]` and never reads it, so every validation error this product has produced has
  been discarded since the beginning. Expansion failure needs no field: it is already a 422. Two
  constraints on it: the **`tagName` is load-bearing** (`"mj-component"` is how the client separates
  tier 1 from tier 2 with no string matching, and it is the only detector for the class the
  expander's guard is blind to), and the response must **pick `{ message, tagName }` explicitly
  rather than forwarding `result.errors`** — the raw objects carry the server's absolute filesystem
  path in `formattedMessage` and a `line` that indexes the *expanded* document, which would point a
  stored-source UI confidently at the wrong place.
- **Fix the stale comment at `render.ts:118`** — it still says "cache key remains source-only" while
  the module header says expanded-only. Two lines from the code it describes, which is exactly the
  kind that gets trusted.
- **Fix the comment at `registry.ts:20-25`** (§5.2) — it says `allowedAttrs` is a UI view filter and
  "not a parse-time gate", which stops being true the moment override legality derives from it.
  Adding a field to that list becomes a permission change, and the stale comment will reassure
  exactly the person making it. Same change should add the server-side derivation from the same
  constant.
- **`mj-wrapper` into `BLOCK_REGISTRY`** (§0.4) — owned by whoever owns `registry.ts`; deletes
  Class A. My half (the help-text fix) is listed above.
- **Rich `mj-text` (Class B, §0.6)** — `parser.ts:433-445` demotes any leaf with an element child.
  No registry entry fixes it; modelling inline content is a real piece of work nobody has scoped. I
  am not asking for it, only for it to be sized (§8.1 item 6) before §5.4's tone is settled.
- **`componentExpander.ts` must return provenance, not a string** (§5.5). `schema.md:951` specs it
  as returning MJML; the substitution-time knowledge §5.5 needs cannot be reconstructed afterwards.
  Free to change today, expensive once it has callers. Both boundary shapes are specified in §5.5,
  including `expandedPathRange` — without which the join has nothing to join on, since no offsets
  survive into the stamper.
- **Delete `css-class` injection and `matchesComponentInstance`** (§5.5) rather than fixing them —
  `schema.md:958` and this document currently specify mutually exclusive overlay mechanisms, and
  stamping the expanded source needs no HTML-side anchor at all.
- **No `slug` / `key` field on the update DTOs** (§1.2) — type-level enforcement of immutability,
  rather than a convention someone has to remember.
- **The expansion guard must fire on export, not only on render** (§5.6). A render that 500s is a
  visible, recoverable annoyance; **an export that silently omits a footer leaves the building**, and
  that is the actual worst outcome in this product. `schema.md:954` has bulk export in week one, so
  the guard needs to be on that path before the path exists. Not my surface, but the severity my
  tier-1 banner uses — *"this isn't your email"* — is the right severity there too, and `.export-btn`
  / `.export-error` already sit unused in `styles.css` waiting for whoever builds it.
- **One model allow-list in `src/shared/`** (§0.5) — currently duplicated between
  `settingsService.ts:5` and `Settings.tsx:5`, failing asymmetrically so that a UI-only addition
  offers a control the server rejects. The `@shared` alias already exists. Half this one is mine
  (`Settings.tsx` imports instead of declaring) and half belongs to whoever owns the service.
- **Detach is SHALLOW** (§5.3) — settled by the lead. Nested `<mj-component/>` survive as live
  references, so a Button inside a detached Footer stays independently overridable and re-pinnable.
  Deep was rejected as the copy model by attrition, arriving through the detach button.
- **The expand / re-collapse LLM path** (§2.1, schema.md §1.0) — not mine, but the post-turn
  resolution UI is, and it cannot be built until the re-collapse reports *which* regions changed and
  *whether the changes were override-shaped*. That classification is the contract between the two.
- **The attribute-level "is this edit override-shaped?" diff** — shared between §2.1's runtime
  resolution and §8.1's viability experiment. One implementation, two consumers, and
  `schema-designer` pinned down the contract that keeps them from drifting: **return the structured
  per-attribute diff — `{ attribute, old, new, pathRelativeToRoot, overridable }` — and let each
  consumer reduce it.** Runtime asks "is this override-shaped?"; the experiment asks "how many and
  where". If either gets its own tailored return shape there will be two implementations inside a
  month, and they will disagree about the case that matters.

### Tests under `tests/unit/web.*`

**Break — need updating:**

| File | Why |
|---|---|
| `web.SidebarShell.spec.tsx` | Hard break. Mounts at `/templates/a`; routes become brand-scoped, as does `useMatch("/templates/:id")` (`SidebarShell.tsx:24`). "listTemplates called once total" restates as "once *for templates*". The no-remount property is still right to test. |
| `web.TemplateRoute.spec.tsx` | Route params and the 404 target become brand-prefixed; plus the context rename. Assertions survive. |
| `web.TemplateList.spec.tsx` | List/create/delete gain brand scope. All five assertions survive as written. |
| `web.useQueryRunner.spec.tsx` | `runQuery` gains brand scope (`api.md` §6.2). Mechanical; 205 lines of state-machine coverage survive. |

**Survive only if the new props are optional — a design constraint, not a hope:**

| File | Constraint |
|---|---|
| `web.PropertiesPanel.test.tsx` | `PropertiesForm` must render correctly with no component context. The override checkbox appears only in component mode, so all 7 assertions pass untouched. |
| `web.RightPanel.test.tsx` | `RightPanel` must still render the Settings and Block tabs unchanged for ordinary nodes. All 5 assertions pass untouched — the `mj-component` branch is additive. |
| `web.useTemplate.spec.tsx` | Survives only if `useDocument` calls the module-level exports so `vi.spyOn` still intercepts. Brand argument is a mock update; the reducer/backoff/conflict coverage must not be rewritten. |

> `api.md` §6.2 lists `PropertiesPanel`/`RightPanel` as **Keep** — correct from the API lane's view,
> but this lane modifies both. Flagged so nobody reads "keep" as "untouched".

**Correction — `web.IconRail.test.tsx` breaks.** I had it as unaffected. It asserts
`groups.length === 2` and exactly 7 `data-block-type` items; the Components group (§5.5) makes it
three groups. The two existing assertions stay valid as written once scoped to the Layout and
Content groups, and the third group wants its own: **a component palette item carries `rootTag`, not
a `BlockType`** — which is the property the drop indicator depends on and the one most likely to be
dropped when someone wires the rail quickly.

**Unaffected (5):** `web.api-client.spec.ts`, `web.DeviceToggle.test.tsx`,
`web.SelectionToolbar.test.tsx`, `web.Settings.spec.tsx`, `web.useSettings.spec.tsx` — the §0.5
allow-list change is an import swap with identical values, so `web.Settings.spec.tsx` passes
untouched. It would be worth **one new test asserting the two former copies now agree**, since the
whole point is that nothing has ever caught them diverging.

**New tests:** `web.TurnResolution.spec.tsx` — **B, C and D render three distinct treatments, and D
renders no choices at all**; D preserves the prompt for retry; C blocks before B when a turn produces
both. D is the likeliest branch in production and the one where a wrong affordance does the most
damage, so it deserves a test rather than a code review.
Also `web.ComponentList.spec.tsx`; `web.BrandSwitcher.spec.tsx`;
`web.RolloutTemplateList.spec.tsx` (grouping; **unreachable rendered and counted separately from
already-current**; select-all excludes unreachable);
`web.RolloutInstanceDetail.spec.tsx` (shadowed-override rows derived from the `ov-*` ∩ changed-keys
intersection; first expand skeletons, second hits cache not the network);
`web.ComponentInstancePanel.spec.tsx` (**a section-rooted component offers no text field and a
button-rooted one does** — the assertion that would have caught the incoherent example both
`schema.md` and this document carried for several exchanges; **an owned attribute renders as a
locked row with an "edit the component" route, while a below-root attribute renders not at all** —
the two absences must not collapse into one, or the 0.1(b) signal is hidden behind author choices;
the field list renders before any fetch resolves; two field states read synchronously from `ov-*` presence; revert clears `ov-*`;
**detach confirm names what stays
linked when the component contains nested instances, and renders a failure state when validation
rejects the detach** — both are easy to omit on a dialog whose design assumes success);
`web.CanvasHealthChips.spec.tsx` (three tiers render distinctly; tier 2 is collapsed by default; a 422 expansion failure renders the error state, not the banner;
tier 1 cannot be dismissed); `web.useUnsavedGuard.spec.tsx`.

**And the one that would have caught a shipped bug** — `web.Canvas.pathMapping.spec.tsx`: a click on
an expanded path inside a component resolves to the **instance's** stored path, not the inner node;
a drop targeting inside an expansion is rejected; double-click inside an expansion does not open the
inline text editor; and **with nested components, a click resolves to the outermost instance and
`overridable` comes from the outermost region** (§5.5). §0.3 shows mis-mapping presents as perfect
counts and wrong boxes, so this is the one behaviour in the plan with no runtime signal at all — it
has to be caught by a test or not at all. The nesting case especially: it is correct by construction
in a one-level fixture and only wrong once someone puts a button component inside a footer, which is
exactly the kind of thing that ships.

Per `CLAUDE.md`, browser-level verification of the roll-out screen is the developer's job.

---

## 8. Open items

### 8.1 Still open

0. **Below-root `ov-*` targets — the one that could unmake D-2, and the cheapest thing to measure.**
   `schema-designer` proposes experiment 0.1(b): count, on ten real templates, how many attributes
   differ per instance; above ~3 average, `ov-*` has degenerated into the copy model with worse
   ergonomics and D-2 re-opens. Two hours, and the cheapest falsifier we have.

   **Absorbed:** it now also measures *what fraction of differing attributes target something below
   the component root*, which is the half that can fail while the average passes — 1.8 reads
   comfortable right up until every one of those 1.8 is a nested CTA `href` that flat root-level
   `ov-*` expresses none of. `schema-designer` added a third at near-zero cost: **how many distinct
   components account for the overrides.** If they concentrate on the footer, the answer is "the
   footer needs slots", not a general mechanism — a much cheaper build.

   **If it comes back below-root-dominant, the answer is declared slots, not a targeting syntax**,
   and the distinction matters because the two look nearly identical in a properties panel:

   - Ad-hoc targeting (`ov-<nth-button>-href`) addresses structure the component never declared. When
     r5 rearranges the interior, the override silently lands on a different node — **reintroducing
     the exact silent post-re-pin drift that D-2 was chosen to eliminate**, through the override
     mechanism rather than the propagation one.
   - A declared slot is a contract: the component marks its overridable points with
     `data-slot="cta"` in the component body (the adjudicated spelling, and the better one — MJML
     drops `data-*` from HTML output, so the marker cannot leak into a delivered email), instances
     fill them by name, and an override naming a slot the pinned revision no longer declares
     **throws at expansion** instead of no-opping.

   **One part of the slot design is not specified, and it is the part my panel would need.**
   `verdict-model.md:164` shows `ov-slot-headline="…"` setting a slot's *text*. The attribute form —
   `ov-slot-headline-href`? — is unspecified and gets ugly quickly, and a panel rendering a named set
   needs both. Not worth solving before the measurement says slots are needed, but worth knowing it
   is a half-specified branch rather than a ready one, so nobody sketches that panel assuming the
   naming scheme exists.

   For this lane the schema does not move either way — slot declarations live in the component's
   MJML, overrides in the instance's — so the panel's data contract is stable. What changes is
   whether the override fields render as a flat list or a named set. §5.2's re-pin promise is
   already qualified (locking supplied the first real exception), so slots would add a second row to
   a table that exists rather than forcing a rewrite of the sentence.

   The third outcome is accepting detach as the routine path, which is the copy model reached by
   attrition through a one-way door, and is worth naming as such before anyone drifts into it. §5.3
   now treats detach frequency as the instrument that would tell us we had.

   > **This measurement expires, and the failure is that it keeps returning a number.**
   > `schema-designer`'s point, and the subtlest thing in the exchange. Run *before* components
   > exist, 0.1(b) is clean: there are no `ownedAttrs` declarations, so the count measures the
   > mechanism. Re-run it *after* components ship and the same query measures something else — if
   > authors lock aggressively, the observed override rate falls for policy reasons while user
   > frustration rises, so **a healthy-looking average would mean the opposite of what it meant
   > pre-launch.**
   >
   > A re-run must therefore exclude owned attributes, or it measures the authors rather than the
   > mechanism. Worth writing on the query itself rather than here, because the dangerous version of
   > this is not someone forgetting the measurement — it is someone re-running it, getting a number,
   > and trusting it.

1. ~~**Overridable-attribute declaration**~~ — *resolved.* `verdict-model.md:159` specifies two
   policies; the checkbox writes `mj-own` and the derivation is
   `allowedAttrs[rootTag] − ownedAttrs` (§3.4, §5.2). I had argued for the declaration on UI grounds
   and it turns out to exist on stronger ones: without it an author cannot lock the brand colour,
   which is the one thing a design system has to be able to do.
2. **Token roll-out reusing `RolloutRoute`.** Under D-2 a token change is also a revision-ish bump;
   I assume one screen serves both and a token plan yields the same per-template rows. Unverified.
3. **One call or two** for per-template detail — instance rows and the expansion pair together, or
   split. Affects only how many skeletons the detail pane shows.
4. **The `diff` dependency** (§4.4).
5. **Does `[ Publish rN ]` warn when templates are behind?** If someone publishes r5, r6, r7 without
   rolling out, templates sit on r4 and the roll-out diff spans three revisions. The header says
   "r4 → r7" honestly, but the *"what changes"* list is then a union across three revisions and may
   contain attributes set and re-set. I have not designed for that and it will happen in week two.
6. **How often rich `mj-text` occurs in real templates** (§0.6). A ten-minute count — `mj-text`
   blocks containing `<` across a handful of real agency templates — that decides whether the
   Class B message in §5.4 is an exception or a daily companion, and therefore how loud it should
   be. The repo's own fixture cannot answer it: both its `mj-text` blocks are plain prose. This is
   the cheapest open question in the plan and the one most likely to change a design rather than
   confirm it.

   **There are now three of these, and they are the same move.** Count the corpus before designing
   the surface: (a) the 0.1(b) override distribution, (b) rich-`mj-text` frequency, (c) the
   `mjmlErrors` volume over existing templates (§5.6). Each is roughly ten minutes, each decides
   between a chip and a workstream, and in each case I had written a design that quietly assumed a
   moderate number. That assumption is the thing worth distrusting — it is invisible, it is always
   convenient, and all three of these were caught by someone asking "how many?" rather than by
   anyone reasoning harder about the design.

   **And it has a sibling on a different axis.** `schema-designer` noticed the same failure in
   themselves this session: the `ov-text` *"designated text node"* phrase assumed a mechanism existed
   because the sentence needed one, and it survived several exchanges because it read as settled
   (§5.2). Mine assumed a quantity; theirs assumed a mechanism. Both are convenient, both are
   invisible, and **neither was caught by being careful** — one was caught by counting, the other by
   re-reading prose against its own worked example. Those are the two checks worth budgeting for,
   because more care is not a third one.
7. **The expanded→stored path map** (§5.5). I have specced it as part of the `/api/render` response
   because that endpoint already does the expansion and already stamps. If expansion lands elsewhere,
   the map should follow it rather than being recomputed in a second place — two implementations of
   this mapping would disagree, and the disagreement would present as "clicking selects the wrong
   block", which §0.3 shows we cannot currently detect.
8. **Whether `ov-*` values should appear in the roll-out diff's "what changes" header.** They do not
   change on a re-pin, so strictly they are not part of the change — but an instance whose override
   shadows a changed attribute shows a smaller visual diff than the header promises. §4.3 handles it
   per-instance; I have not decided whether the header should carry a global "2 instances override
   part of this change" line. Leaning yes, since the header is the sentence people screenshot.

### 8.2 Withdrawn or resolved

- **`preserved[]` on `InstancePlan`** — *accepted, then moot.* `propagation-designer` agreed the
  argument beat theirs ("derivable-by-the-engine isn't the same as legible-to-the-user") and added
  the field; D-2 then removed the merge it reported on. Under reference it is a client-side set
  intersection instead (§4.3). Recorded with the outcome rather than just the conclusion, because
  the reasoning — *an absence is indistinguishable from "we didn't check"* — is the one part that
  transfers to any future payload decision.
- **Apply mechanics** — settled by measurement, not argument: determinism holds, apply re-derives,
  and under reference the re-derivation is a pin bump. I was wrong on the mechanism and right on the
  requirement; the requirement survives more cheaply than I proposed.
- **Diff payload shape** — `{ beforeMjml, afterMjml }`, per-template call, canonical on both sides.
  `schema-designer` withdrew the inline `htmlBefore`/`htmlAfter` shape.
- **Override storage shape** — `ov-*` on the reference tag. My "don't store the value" answer was
  right for copy and wrong for reference, where `ov-*` is the only place the value can live.
  `schema-designer` and I agreed the question was malformed as asked.

### 8.3 What D-2 deleted from earlier drafts

Recorded so nobody re-derives reasoning that no longer applies — and so it is recoverable if D-2 is
ever reopened.

| Deleted | Was |
|---|---|
| three-way merge, base revisions, `locked`/`default`/`slot` | §2 of `propagation.md`; my §3.4 and §5.2 |
| three-value conflict rows (base / component / instance) | my §4.4 — no merge, no conflict |
| `locked-reset` and its alert treatment | the copy model's silent-destruction case |
| per-template `blocked` status | a revision validates once at publish, not 23 times |
| drift detection, orphan adoption, `data-cmp-h` | nothing copied can diverge |
| the run-1 reformat notice | the write is one attribute (§4.5) |
| `preserved[]` as a payload ask | now a client-side intersection |

The one piece of copy-model reasoning I would keep on file: *`locked` and `default` had opposite
consequences when a user edited them, so collapsing them into "component-owned" would have left the
panel unable to say whether an edit would survive.* Sound for the model it addressed, and the shape
of the argument would recur in any future merge-based design.

---

## 9. If this has to be cut down further

0. **The expanded→stored path map and the selection rule** (§5.5). Promoted above everything else,
   and it is the one item on this list that is *not optional at any scope*: the moment a template
   contains one instance, a canvas without the mapping does not merely lack a feature — it selects
   the wrong block, with no runtime signal (§0.3). Every other line below assumes the canvas tells
   the truth about what you clicked.
1. **Provider restructuring** (§2) — nothing else is possible without it.
2. **Brands in the URL + rail** (§1) — cheap, everything is scoped by it.
3. **Component library + the two-step publish flow** (§3.1–3.3) — the thing being sold.
4. **The roll-out dry run** (§4) — the demo. **The unreachable bucket (§4.2) and the two-diff header
   (§4.1) are not cuttable**: the first stops the screen reporting a number that is not true, and
   the second is the reference model's whole competitive argument in two lines.
5. **The instance panel** (§5.2) including detach (§5.3). Detach is small and is what stops people
   being afraid of components.
6. **`useUnsavedGuard`** (§6) — small, fixes a real existing bug.
7. **`mj-wrapper` in the registry + `CanvasHealthChips`** (§0.3, §0.4) — together the cheapest
   trust-per-line in the plan: one registry entry, three lines of API, one chip, and a whole category
   of silent failure shrinks and becomes visible.
8. **Component usage view** (§3.5) — after §4 exists most of its data is already on hand.
9. **Brand tokens** (`TokensRoute`) — **the first thing I would cut.**
10. **"Extract component from template"** (§3.2) — not v1, but the best on-ramp once v1 exists.
