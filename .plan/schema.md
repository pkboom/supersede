# Multi-brand email design system — data model & migration

Design only. No source files were modified.

Read before writing: `src/db/schema.ts`, `src/db/migrate.ts`, `src/db/index.ts`,
`drizzle.config.ts`, `drizzle/migrations/0000_initial.sql`,
`src/server/services/{templateService,settingsService}.ts`,
`src/server/routes/{templates,query,render}.ts`,
`src/shared/blocks/{types,parser,serializer,registry,validate,stampPaths,mjAttributes,headEdit}.ts`,
`tests/integration/{services,templates-routes}.test.ts`, `tests/helpers/makeTestDb.ts`,
`web/src/api/templates.ts`, `OPERATIONS.md`, `package.json`.

---

## 0. Corrections to the brief, up front

Three things in the task framing don't match what's on disk. They change the design, so
they go first.

**(a) `src/db/schema.ts` is 32 lines, not 96 — and the line count is the wrong measure.**
The DDL in §2 is maybe two hours of work. The cost of this project is not the DDL. The file
says, in its own header, *"one global namespace. No User entity, no per-user scoping, no
auth"* — and it means it: **every service method and every route signature in the codebase
assumes the scoping dimension away.** `TemplateService.list()` is an unscoped `SELECT …
ORDER BY updated_at DESC` (`templateService.ts:37-48`); `get`/`update`/`delete` take a bare
id with no namespace to check it against; `routes/templates.ts` has no notion of a
container for the thing it is CRUDing; `web/src/api/templates.ts` calls `/api/templates`
flat. Adding brands means every one of those grows a dimension, and the dangerous ones are
`get`/`update`/`delete`, where "forgot to scope" is not a compile error — it's a 200 that
returns another brand's template.

Read §4 as the real estimate and §2 as the easy part. Concretely, the split:

| | Where | Shape of the work |
|---|---|---|
| **Schema DDL** | `schema.ts`, `drizzle/migrations/` | Additive tables + one table rebuild. Mechanical, reviewable, done once. |
| **Scoping refactor** | `templateService.ts`, all of `src/server/routes/`, `web/src/api/`, both integration test files | Every read and write grows a `brandId`. No type error if you miss one — the column is nullable nowhere but the *predicate* is optional everywhere. |
| **Design-system machinery** | expander, extractor, `registry.ts`, `stampPaths.ts`, `render.ts`, `query.ts` | The genuinely new code (§1, §4). |

Mitigation worth building into the refactor rather than bolting on: make the scope
non-optional in the *type*, not the convention — `TemplateService` methods take a
`BrandScope` branded param, or the service is constructed per-brand
(`new TemplateService(db, brandId)`) so there is no unscoped method to call by accident.
The second is cheaper and makes the omission a constructor error instead of a silent
cross-brand read.

Also: `package.json:5` still advertises *"Hosted multi-tenant MJML email designer"* while
the code is explicitly single-namespace. Brands are **not** multi-tenancy — there is still
no auth and no user, and the deployer still owns every brand in the file. Worth correcting
the description in the same commit so nobody reads brand isolation as a security boundary.
It isn't one, and §2's `restrict` FKs are integrity constraints, not access control.

**(b) `settings.default_mode` has drifted three ways and the deployed DBs disagree with
the schema file.**

| Location | Value |
|---|---|
| `drizzle/migrations/0000_initial.sql:4` | `DEFAULT 'api'` |
| `src/db/schema.ts:29` | `.default("cli")` |
| `src/db/schema.ts:24-25` (comment) | "pinned to `anthropic`/`api` today" |
| `src/server/services/settingsService.ts:10` | `DEFAULT_MODE = "cli"` |
| `OPERATIONS.md:18` | "`api` mode (default)" |

The SQL is what is actually in the existing database file — every row created by
`0000_initial.sql` defaults to `api`, while every row created by `SettingsService.get()`
lazily seeds `cli`. This matters now because the next `drizzle-kit generate` will notice
the schema/SQL divergence and may emit a `settings` table rebuild you did not ask for,
bundled into the brands migration. **Resolve this drift in its own commit before
generating any brand migration**, so the brand migration's diff is reviewable.

**(c) The sketch's `components (id, brand_id, name, mjml, version)` cannot support
pinning.** One row holds one `mjml`, i.e. only the head revision. A template pinned to
revision 4 has nothing to render once revision 7 is published. Since I argue for pinning
in Q2, content history is not optional — it's a second table. This is the single biggest
structural change from the sketch.

### 0.1 Two experiments that gate this document (~2 hrs, before any DDL)

Everything below is reading, not running (§5.1). Two claims are load-bearing enough that
they should be tested before the schema is written, not after. Both are cheap. Both can
invalidate work if they fail, and one can re-open D-2.

**(a) ~~Does `css-class` survive compilation onto the element `stampPaths` matches?~~ — RUN.
ANSWER: NO. The approach is dead; §1.1 now specifies the replacement.**

I ran `.plan/scratch/probe6.test.ts` and `probe7.test.ts` (9 tests, all pass;
`node_modules` is now installed). Measured, per root type — "does the element carrying
`css-class` also carry `data-mjml-path`?":

| root | `css-class` lands on | `stampPaths` stamps | same element? |
|---|---|---|---|
| `mj-section` | `<div class="mjcmp-test">` (+ `<table class="mjcmp-test-outlook">`) | `<table>` (no class) | **no** |
| `mj-column` | `<div class="mj-column-per-100 … mjcmp-test">` | same `<div>` | yes |
| `mj-wrapper` | `<div class="mjcmp-test">` | nothing — `stamped=0/0` | n/a |
| `mj-hero` | `<div class="mjcmp-test">` | nothing — `stamped=0/0` | n/a |

It fails for `mj-section`, which is the root type a component will almost always have. Two
details worth keeping even though the approach is dead: MJML emits a **second, `-outlook`-suffixed**
copy of the class onto the MSO table (`mjcmp-test-outlook`), and that copy sits inside an
`<!--[if mso…]>` block that `stampPaths` treats as opaque by design — so any future
class-based matcher has two classes and a comment-visibility rule to contend with.

**Two things the same probe settled, both of which stand:**

- **The silent off-by-one is real.** Stamping unexpanded source against expanded HTML gave
  `stamped=3/3, missing=[]` — so `render.ts:70`'s warn never fires — while top-level path
  `"1"` landed on the **footer** (`#111111`) instead of the real section (`#abcabc`). §1.1's
  hazard analysis was right; only its fix was wrong.
- **The throw-on-survivor guard is necessary, and can be cheaper than a string scan.** An
  unexpanded `mj-component` reaching the compiler yields
  `errors: ["Element mj-component doesn't exist or is not registered"]`, `component-id` never
  reaches the HTML, and the rest of the email renders — a silently footerless email at
  HTTP 200, exactly as predicted. Since mjml *does* report it in `result.errors`, the guard
  can check that array as well as scanning the string. Do both; the string scan is the one
  that survives a future mjml that stops reporting.

**Net effect on the plan:** §1.1's single-root-element invariant *survives and gets
stronger*. With exactly one root per component, stored-tree and expanded-tree indices stay
1:1 at every level, which is what makes the replacement path-translation trivial rather than
a search problem.

**(b) On ten real templates: how many attributes differ per instance, and *where do they
sit*?** Two measurements, one pass. The second is ui-designer's addition and it matters more
than the first.

- **Count.** Per would-be instance, the attributes diverging from the shared definition.
  **Above ~3 on average, `ov-*` degenerates into the copy model with worse ergonomics** and
  D-2 re-opens rather than being worked around.
- **Distribution.** What fraction of those attributes target a node **below the component
  root**. This is the measurement that can fail while the count passes: 1.8 average reads
  comfortable, but if all 1.8 are a nested CTA `href`, flat root-level `ov-*` expresses
  *none* of them, detach becomes the routine path, and you have reached the copy model by
  attrition — through a one-way door. The below-root cases are the ones email components
  actually need: a footer rooted at `mj-section` can have its background overridden but not
  its unsubscribe link; a product card its padding but not its CTA.
- Worth recording in the same pass, near-free: **how many distinct components account for
  the overrides.** If most land on one component, the answer may be "that component needs
  slots" rather than a general mechanism.

**This measurement expires, and the dangerous failure is re-running it, not forgetting it.**
0.1(b) is valid *before* components exist, because nothing is locked yet and every divergence
is a mechanism fact. Once `ownedAttrs` is live the same query measures something else: an
author locking attributes drives the override rate **down** for policy reasons while user
frustration goes **up**, so a post-launch average that looks healthy means the opposite of
what the identical number meant pre-launch. Someone who re-runs this and trusts the result is
worse off than someone who never ran it, because they now have a number.

If it is ever re-run, it must exclude owned attributes — and that instruction belongs written
on the query itself, not only here. A plan document is not where someone stands when they
decide a measurement still means what it used to.

**If the distribution comes back below-root-dominant, the answer is declared slots — not a
targeting syntax.** The difference is safety, not taste. Ad-hoc addressing into the
interior (`ov-<nth-button>-href`) points at a structure the component never declared, so
when r5 rearranges the interior the override silently lands on a different node — exactly
the silent post-re-pin drift this model was chosen to eliminate. A declared slot is a
contract: the component revision marks its overridable points (`<mj-button data-slot="cta" …>` — the
verdict's spelling at `verdict-model.md:164`, which I should adopt over the `mj-slot` I first
wrote, and which is also technically better: MJML drops `data-*` from HTML output, so the
marker cannot leak into the rendered email), instances fill them by name,
and an override naming a slot the pinned revision doesn't declare **throws at expansion**
rather than no-opping.

Two consequences worth stating before anyone runs the experiment:

- **The schema is stable across either outcome.** Slot declarations live in the component's
  MJML and slot overrides in the instance's; neither needs a table. So 0.1(b) can invalidate
  §1 but not §2 — which is why it's cheap to run late as well as early.
- **Slots reintroduce one conflict category, and I shouldn't claim otherwise.** My Q2 claim
  that overrides are fully orthogonal to propagation holds for flat `ov-*`; with slots,
  "r5 removed the slot this instance overrides" is a real conflict. But it is a *declared*
  one, detected statically before anything is applied — a blocking row in the dry-run, not a
  three-way content merge. Much weaker than copy's, and still loud.

---

## 1. The decision the schema hangs off: how a template *references* a component

Everything else follows from this, so it goes before the tables.

**Templates store a reference, not an expansion.** The reference is a first-class modeled
block type — `mj-component` added to `BLOCK_REGISTRY` — not a comment marker and not a
`CustomPassthroughNode`. Stored MJML looks like:

```xml
<mj-body>
  <mj-component component-id="shoe-brand/footer" revision="4" />
  <mj-component component-id="shoe-brand/cta-button" revision="2"
                ov-href="https://example.com/sale" ov-text="Shop the sale" />
  <mj-section>…template-local content…</mj-section>
</mj-body>
```

Expansion to real MJML happens **server-side, at render and export time only**. Nothing
expanded is ever persisted.

Three properties of that tag, each decided rather than defaulted:

**`component-id` is a human-readable slug pair `<brand-slug>/<component-key>`, not a UUID.**
The MJML stays legible, diffs say what changed, and a human or the LLM can read a template
and understand it. The cost is that it's a natural key: re-slugging a brand or re-keying a
component orphans every reference, which is a corpus rewrite — precisely the cost the
reference model was chosen to avoid, sneaking back in through renames. So the rule is
**slug is identity, name is label**: `brands.slug` and `components.key` are immutable after
creation; `brands.name` and `components.name` are freely editable and are what the UI
shows. A genuine re-slug is a deliberate, rare, dedicated command that rewrites references
and is not reachable from the normal edit UI.

`components.id` stays a UUID primary key even so, and the slug is a unique natural key
resolved at extraction time. Keeping the surrogate means the internal FKs
(`component_revisions`, `component_usages`, `component_deps`) stay single-column, and it
keeps the re-slug escape hatch cheap: rewrite the references plus one `UPDATE`, rather than
cascading a primary-key change through four tables.

The brand prefix is redundant with §2's "a template may only reference components of its own
brand" — deliberately. It is **validated, not authoritative**: the extractor resolves the
pair and returns 422 if the brand segment doesn't match the template's brand. That turns a
template moved between brands from a silent mis-resolution into a rejection.

**`ov-*` attributes are per-instance overrides, applied at expansion.** No merge, no base,
no three-way conflict — the override is applied *after* the revision is expanded, so it is
orthogonal to propagation. Re-pinning r4 → r5 reapplies the same overrides to the new
revision and nothing about them needs reconciling. This is the piece my earlier draft left
unthought-through (old §5 item 6); it is now resolved, and experiment 0.1(b) is its
falsifier.

The rule, stated exactly — an earlier draft of this paragraph said `ov-text` "replaces its
designated text node", **which was a sentence that read like a decision and wasn't one**:
nothing in this document designates a text node, and the example above it applied `ov-href`
and `ov-text` to a footer rooted at `mj-section`, which has neither an `href` nor text
content. The worked example was incoherent under its own rule. Corrected:

- `ov-<attribute>` sets `<attribute>` on the component's **single root element**, and
  nothing else. `ov-background-color` on the `mj-section`-rooted footer; `ov-href` on the
  `mj-button`-rooted CTA. Legality is checkable without expanding, because `rootTag`
  (§1.2) plus `BLOCK_REGISTRY[rootTag].allowedAttrs` says what the root accepts.
- `ov-text` is the one reserved name: it replaces the root's inner text, and is **valid only
  when `BLOCK_REGISTRY[rootTag].contentField === "text"`** — i.e. an `mj-text`, `mj-button`
  or `mj-social-element` root. On any other root it is a 422 at save, not a silent no-op.
- There is deliberately no way to reach below the root. A footer rooted at `mj-section`
  therefore **cannot** override its unsubscribe link — which is not an oversight but the
  precise gap experiment 0.1(b) measures, and the case declared slots would answer.
- **An attribute can be declared component-owned, and then no `ov-` is accepted for it.**
  This reconciles with `verdict-model.md:159` ("two policies, not three"), which my earlier
  draft did not — I had a single policy, *everything on the root is overridable*, which gives
  a component author no way to say "the brand blue is not yours to change". Declared in the
  component's own body on the root (`mj-own="background-color color"`), parsed at publish,
  and stored on the revision for the same reason `rootTag` is: the panel needs it per palette
  entry without fetching a body.

  So the overridable set is `BLOCK_REGISTRY[rootTag].allowedAttrs − ownedAttrs`, still fully
  derivable client-side. Note the reuse it depends on: `allowedAttrs` is documented in
  `registry.ts:20-25` as a *UI form view filter*, not a validation gate, and this makes it
  one. That is a coupling worth stating — widening `allowedAttrs` for form reasons silently
  widens what instances may override. Acceptable because it keeps "what you can change on a
  block" and "what you can override on an instance" the same set, which is the right
  user-facing invariant, but the server must enforce it from the same shared registry rather
  than trusting the client's derivation (`src/shared/blocks/registry.ts` is already imported
  by both sides — unlike `ALLOWED_MODELS`, §Q6).

```ts
// in componentRevisions, alongside rootTag:
/** Space-separated attributes the component author marked component-owned, which
 *  instances may not override (verdict-model.md:159). Parsed from the revision's
 *  root `mj-own` attribute at publish; stored so the panel can compute the
 *  overridable set without fetching the body. One writer, one trigger. */
ownedAttrs: text("owned_attrs").notNull().default(""),
```


Two implementation constraints on overrides, both real:

- Values are **entity-encoded on write** (`&` → `&amp;`, `"` → `&quot;`, `<` → `&lt;`) —
  reuse `escapeAttr` from `mjAttributes.ts:57`, which already does exactly this.
- The expander must read them with **the parser's quote-aware scan, not a regex**. A naive
  `/(\w+)="([^"]*)"/` misses a raw `>` inside an attribute value, which is legal and which
  `locateTag` in `mjAttributes.ts:89-161` already handles correctly by tracking quote state.
  Reuse that walker; do not write a second one.

**Detach is a per-instance, one-way, SHALLOW expand-in-place.** Replace the
`<mj-component …/>` node with its expanded markup (overrides applied) and drop that one
link. It is the escape hatch for "we need this one different in a way `ov-*` can't express"
— the honest answer to the product question in §4.5, rather than pretending overrides cover
every case. Not reversible: re-attaching would mean guessing which of the user's edits were
meant to be overrides.

**Shallow, not deep — decided, and it was genuinely ambiguous before** (this paragraph used
to say "the template becomes ordinary blocks", which reads as deep; ui-designer and
propagation-designer both needed the answer to finish the panel). Nested references survive
detach as live references: detaching a Footer that contains a Button leaves
`<mj-component component-id="…/button" revision="7" …/>` sitting in the template, still
pinned, still propagating, still overridable — and carrying whatever `ov-*` the Footer
revision had applied to it, since the tag is preserved verbatim.

Three reasons, the first of which I think settles it:

1. **Shallow composes; deep doesn't.** Shallow-detaching twice equals a deep detach, but
   nothing gets you back from deep. Given detach is explicitly one-way, the only defensible
   default is the primitive that can be repeated into the other one. Same shape as the
   pin-over-float argument in Q2: pin → float is a one-line change, float → pin is
   unrecoverable, so ship the recoverable direction.
2. **Deep severs links the user never mentioned.** They asked to detach the Footer. Deep
   also drops the Button, and any component nested under that, out of propagation — so a
   brand-wide button change silently stops reaching this template for a reason nobody
   recorded. That is the copy model arriving through the detach button rather than through
   `ov-*` scope (§0.1(b) warns about the same drift by the other route).
3. **Two severances should cost two decisions.** If the thing the user actually needed to
   change lives inside the nested Button, shallow makes them detach again — an explicit,
   scoped second choice. Better than one click severing an unknown number of links.

Two obligations that come with choosing shallow:

- **The confirm must say what stays linked, not only what is severed** — "this Footer becomes
  a normal block; the Button inside it stays linked to the library." This is ui-designer's
  scope-disclosure invariant again, inverted: here the scope is *narrower* than the user
  assumes. Silent, it produces "I detached it and it still changed on me."
- **Detach must validate every nested reference before writing.** `onDelete: restrict` should
  make a dangling nested reference impossible, but a direct SQL delete could produce one, and
  shallow detach would then write a template carrying a reference that cannot resolve — which
  the §1 hard-fail guard turns into a 500 at render. Resolve-check all nested references
  first; fail the detach with a clear message rather than writing an unrenderable template.

Why a registry entry rather than a comment or a passthrough:

- `parser.ts:304` routes unmodeled tags to `CustomPassthroughNode`, which round-trips
  verbatim but is opaque — the canvas can't read `revision` off it, and
  `stampPaths.ts:79-101` refuses to stamp passthroughs without the
  `data-mjml-passthrough="true"` sentinel. A registry entry gives you a `BlockNode` whose
  `attrs: Map` carries `component-id`/`revision` through every canvas edit, because the
  A-prime contract (`types.ts:6-20`) says the parser admits **every** attr it sees.
- Comment markers (`<!-- cmp:start … -->`) do round-trip (`parser.ts:255-266` → `UnknownNode`),
  but they carry no structure, the LLM in `/query` rewrites the whole document and has no
  structural reason to keep them, and a half-deleted marker pair is unrecoverable.

Required edits to make this work (none are schema, all are cheap, all are load-bearing):

1. `registry.ts` — add `mj-component`: leaf, `isContainer: false`, `allowedChildren: null`,
   `allowedAttrs: ["component-id", "revision"]`. Note `ov-*` is deliberately **not** in that
   list: `allowedAttrs` is a static UI view filter (`registry.ts:20-25`) and the available
   overrides depend on the resolved component, not on the block type. The properties panel
   must render override fields from the component definition it fetched, and the parser
   admits `ov-*` regardless — the A-prime contract means every attr round-trips whether the
   registry lists it or not.
2. `registry.ts` — add `"mj-component"` to `mj-column.allowedChildren` **and**
   `mj-section.allowedChildren`. Without this, `parser.ts:409-418` demotes it to a
   passthrough inside a column and you lose the attrs. Body-level needs nothing:
   `parseBodyChildren` (`parser.ts:240-289`) applies no allow-list.
3. `promptBuilder.ts:85-87` — the catalog enumerates every registry key except
   `mj-custom-passthrough`. Add `mj-component` to that exclusion **and** add a
   `SYSTEM_GUIDANCE` line: *"`<mj-component …/>` tags are opaque shared-component
   references. Preserve them byte-for-byte. Never author, edit, or delete one."*
   That edit changes `tests/unit/__snapshots__/promptBuilder.snapshot.test.ts.snap`
   (the frozen stub isolates the *catalog*, not `systemGuidance`) — regenerate deliberately.
4. `query.ts` — after the LLM returns, extract the reference multiset from the returned
   MJML and compare with the input's. If it changed, reject **502** and leave the DB
   untouched; that path already exists for malformed MJML (`OPERATIONS.md:118`). A model
   that silently drops a footer reference otherwise ships 40 footerless emails.
5. `render.ts` — expand before `mjml2html`, and **throw if any `mj-component` survives
   into the string handed to the compiler**. `validationLevel: "soft"` drops unknown tags
   silently; that is a missing footer with a 200 response. Make it a 500.

   This guard is load-bearing well beyond one route, and it is what answers the "loud beats
   clever" objection in §4.5: it converts the reference model's entire silent-failure class
   — an unexpanded reference reaching the compiler by any path — into one loud check in one
   place. It belongs in the expander's exit, not in `render.ts`, so that every future caller
   inherits it rather than having to remember it.
6. New `GET /api/brands/:brandId/templates/export` (and a per-template equivalent) —
   expanded MJML for every template, so `templates.mjml` not being a standalone artifact is
   a property of the *storage*, not of the deliverable. This is the answer to §4.5
   criterion 4 and it should ship in week one, not later: until it exists, the data has no
   exit and the reference model is a lock-in argument waiting to be made. Preferred over a
   derived `templates.expanded_mjml` column — an endpoint computes on demand and cannot go
   stale, a column is a third cache to keep in sync.

### 1.0 `/query` under reference: expand-and-recollapse, not "holes"

ui-designer (ui.md §2) inverted my criterion-1 finding and is right to: under reference the
risk isn't the model editing bytes inside a component region, it's that **the model can't
see those bytes at all**. Claude receives `<mj-component component-id="shoe-brand/footer"
revision="4" />` and nothing about what it renders as. "Make the footer links bigger" is
unanswerable.

They frame two exits, both lossy: send expanded and take back a full document (every
reference silently becomes copy on one turn), or send the reference form (Claude works on a
document with holes). **There's a third, and it's better than both: send expanded, take back
expanded, and re-collapse mechanically.**

1. Expand the document for the prompt, with each *template-level* instance wrapped in
   delimiters the model is told to reproduce verbatim:
   `<!-- cmp shoe-brand/footer r4 BEGIN … END -->`. Nested instances aren't delimited — the
   interior is verified as a whole, so inner markers would only add failure surface.
2. On return, walk the regions **we know we sent** and canonically compare each interior
   against our own expansion — `serialize(parse(x))` on both sides, each wrapped in a
   synthetic `<mjml><mj-body>` first, the same trick §2 uses to store components as full
   documents.
3. Identical → replace the region with the original `<mj-component/>` tag. The reference is
   restored mechanically, not hopefully.

Four outcomes, not three — the fourth is the one most likely to be folded into the third by
accident, and it can't support the same UI:

| | Condition | Action |
|---|---|---|
| **A** | interior canonically identical | restore the reference; no UI |
| **B** | differs; every change root-level and overridable | auto-convert to `ov-*`; informational |
| **C** | differs; changes reach below the root | blocking choice: edit the component, or detach |
| **D** | **region structurally broken** — delimiter dropped, region missing, region invented | **reject the turn (502), apply nothing** |

D is not a deeper version of C. In C we know what the model meant and can offer a choice; in
D we don't know what happened, so any choice we offer is a guess presented as a decision.
Reject and say the turn couldn't be verified. Expect D to be the common failure with a
weaker model or a long document, which is exactly why it needs its own path rather than
inheriting C's dialog.

The property that makes this safe is that **we know exactly what we sent**, so every
deviation is detectable: a dropped BEGIN/END pair, a mangled interior, an invented region.
There is no silent path. That is strictly stronger than a post-hoc multiset comparison of
`<mj-component>` tags — which remains the right final assertion on the re-collapsed
document, but is now a backstop rather than the only line.

Two things fall out of it, and they're why I'd build this rather than accept holes:

- **A changed interior is diagnosable, not just detectable.** Diff the returned region
  against the expansion attribute-by-attribute. If every changed attribute sits on the root
  element and is in the overridable set, **convert the model's edit into `ov-*` overrides
  automatically** — the model edits naturally and we translate. If the changes go deeper,
  fall back to a choice the user can act on: edit the component (affects all 23 templates),
  or detach this instance. That is the design-system-correct answer to "make this one
  different", and it's only reachable because Claude could see the content.
- **It's the same computation as experiment 0.1(b).** The attribute-level diff that decides
  whether an edit is override-shaped is the count that tells you whether `ov-*` is viable at
  all. Build it once.

Cost, stated honestly: this is the most machinery of the three options, it enlarges the
prompt by the expanded component bodies, and it puts a string-level re-collapse in the LLM
path. I think it's worth it because the alternative degrades the tool's headline feature on
exactly the templates a design system is meant to make better — and because "Claude can't
see these regions" is a sentence no UI should have to write.

### 1.1 The overlay problem, and why a component gets exactly one root element

This is the non-obvious constraint and it is worth stating precisely, because getting it
wrong breaks the canvas for every template that uses a component.

`render.ts:69` calls `stampMjmlPaths(source, result.html)`. If expansion happens inside the
render route, `source` is the *unexpanded* MJML but `html` is the *expanded* render.
`stampMjmlPaths` builds a plan from the parsed source (`stampPaths.ts:567-570`) and matches
it against HTML tokens with a **forward search**, not a positional consume
(`findMatch`, in `stampMjmlPaths`'s inner scope). So extra markup does not immediately
desynchronise — but it does something worse, silently:

A component that expands to an `mj-section` renders a `<div>` that `matchesSection`
(`stampPaths.ts:357`) accepts. If the component's plan entry is skipped (unstampable), the
*next* plan entry — the template's own `mj-section` — scans forward and matches the
**component's** div. Every subsequent section is then stamped one element early. The
overlay points at the wrong blocks, and `stamped === expected`, so the existing
`console.warn` at `render.ts:70` never fires.

Fix, in three parts:

- Make `mj-component` a **stampable leaf** in `buildStampPlan`. The leaf branch calls
  `findClosingOffset` + `advancePastOffset`, which consumes the component's whole rendered
  range, so the next sibling matches correctly.
- ~~Give the matcher a hook via `css-class`~~ — **refuted by probe, deleted.** See the
  measurements in §0.1(a): for an `mj-section` root, `css-class` lands on
  `<div class="mjcmp-test">` while `stampPaths` stamps a *different* element (the outer
  `<table>`). It coincides only for `mj-column`. Don't patch this; the approach is wrong.

  **Replacement: stamp against the expanded source, and have the expander return provenance.**
  The probe also showed `stampMjmlPaths(expanded, expandedHtml)` = 6/6 correct — stamping is
  only broken when the source and the HTML disagree. So:
  `componentExpander` returns `{ mjml, regions }` rather than a bare string, where each
  region carries the byte range it occupies in the expanded MJML plus the stored-tree
  instance path it came from. `/api/render` stamps the expanded source (correct by
  construction), then uses the region map to mark stamped paths that fall inside a component
  as belonging to instance X, and to translate the rest back to stored-tree paths. Byte
  offsets are a server-side join key and deliberately never reach the browser.

  This provenance exists **only inside the expander at substitution time** and cannot be
  reconstructed from the expanded MJML afterwards — which is why the return type has to
  change now, while the module has no callers, rather than later. (Shape credit:
  propagation-designer via ui-designer §5.5.)

  **The general rule, which is worth more than the three instances that produced it:
  expansion is a coordinate-space boundary, and nothing crosses it untranslated.** Values
  computed against the expanded document are in a space the browser does not have. Three
  have turned up so far, by three unrelated routes — byte ranges (the region map, caught by
  propagation-designer checking the join), overlay path keys (caught by ui-designer writing
  the panel), and mjml's `line` numbers on error objects (caught by me probing the error
  shape in §1.2). Each was individually easy to miss and individually easy to fix; a fourth
  will arrive by a fourth route. Either translate through the region map, or keep the value
  server-side. Never pass it through because it looks useful — a wrong coordinate is worse
  than an absent one, because an absent one is ignored and a wrong one is trusted.
- **Invariant: a component revision's `mj-body` must contain exactly one root element.**
  Two roots means two rendered ranges and a leaf entry that consumes only the first —
  reintroducing the cascade. Enforce at component-save time, 422 on violation. Wrap
  multi-part components in a single `mj-wrapper` or `mj-section`.

Result: the component instance is one selectable, draggable unit on the template canvas,
and its interior is not individually editable there. That is exactly the semantics a
design system wants.

---

### 1.2 The render contract: mjml already reports these errors and we throw them away

Prompted by ui-designer's ask for `expansionErrors[]` on `/api/render` (§5.6). Agreed — and
the diagnosis behind it, "the answer stops at a log line, exactly where `missing[]` stops
today", is right and generalises further than either of us said.

**I had a hypothesis here and it was wrong; the correction narrows the design.** I expected a
*second* silent-drop class: a component that expands fine but lands somewhere MJML rejects
(an `mj-section` root dropped inside an `mj-column`), which the throw-on-survivor guard would
miss because nothing survives unexpanded. I probed it — `mj-section` in `mj-column`,
`mj-column` at body level, `mj-button` at body level — and **MJML renders the content anyway**
in all three, reporting e.g. `"mj-section cannot be used inside mj-column, only inside:
mj-attributes, mj-body, mj-wrapper"`.

| | Registered? | Placement | Result |
|---|---|---|---|
| unexpanded `mj-component` | no | n/a | **dropped**, error reported, 200 |
| misplaced `mj-section` etc. | yes | illegal | **rendered anyway**, error reported, 200 |

Only the first vanishes. The second renders, probably with broken table nesting in real
clients — a quality failure, not data loss. Don't build a missing-content banner for it.

**What the probe did find is bigger than the component question.** `render.ts:60-62` types the
compile result as `{ html: string; errors?: unknown[] }` — someone knew the field existed —
and then reads only `.html`. **Every MJML validation error this product has ever produced has
been discarded**, on every render, component-related or not. That is the third
silent-success-with-200 in this codebase and it predates all of this work.

So the contract should be broader than `expansionErrors[]`:

```ts
POST /api/render -> {
  html: string,
  unstamped: string[],        // today's missing[], currently log-only
  mjmlErrors: Array<{ message: string; tagName?: string; line?: number }>,
  expansionErrors: Array<{ instancePath: string; reason: string }>,
}
```

`mjmlErrors` is free — already in the return value being thrown away. `expansionErrors` covers
what never reaches the compiler (unresolvable reference, missing revision, depth cap), where
the hard-fail guard fires. Keep them separate: they warrant different UI weight, which is
ui-designer's point — `mjmlErrors` is advisory, `expansionErrors` means what is on screen is
not the email.

**Two cache consequences. The second was a bug I thought I was introducing; it turns out the
shipped code already prevents it, by a better mechanism than the one I proposed.**

*(i) Every new field must be returned on the cache-hit path too, or the persistent banner
disappears on the second render.* `render.ts` caches and returns `unstamped` on **both**
paths (`getCached` at :106-109, `setCached` at :52). That is the precedent to copy. Add a
field to the miss path only and the tier-1 state — non-dismissible precisely because what is
on screen is not the email — evaporates the moment the same input renders twice. A guarantee
that dies on a cache hit is worse than no guarantee: the first render taught the user to
trust it. Test the cheap way — assert both paths return every field — rather than asserting
the banner persists.

*(ii) I proposed keying on `source + brandId + brands.version`. Don't; the shipped content
key is better.* `getCached` now matches on the **expanded** MJML (`render.ts:43-44`), not
the stored source, and expansion happens before the lookup (:95 before :106). ui-designer's
argument for keeping it that way is correct and beats mine: **content keys self-invalidate;
composite keys are a list of contributing inputs that someone has to remember to extend,
forever, including inputs added years later.**

There is a stronger form of that argument available: the expanded, head-merged MJML **is**
the complete input to `mjml2html` + `stampMjmlPaths`. Nothing else varies within a process
lifetime — an mjml version bump or a stamper change arrives with a deploy, which empties an
in-memory cache anyway. So a content key is *provably* complete, where a composite key can
only ever be *currently* complete.

The condition, which is the whole of it: **the brand head must be merged into the string
before that string is used as the key.** Ordering must be
`source → expand refs → merge brand head → getCached → compile`. Merge it later — into the
compiled HTML, say — and the content key silently stops covering it, which is exactly the
stale-brand-token bug, just reached by a different route.

Make that enforceable rather than remembered: have the preparation step return a branded
`PreparedMjml` and let `getCached`/`setCached` accept nothing else. Then "merged before
keyed" is a type error rather than a convention — the same move as dropping `slug` from the
update DTO (§Q6) and constructing `TemplateService` per brand (§0a).

Honest cost of content keying: expansion and merge run on **every** request, including cache
hits, so the LRU protects the compile but no longer the preparation. Fine at this scale —
expansion is memoised on `(componentId, revision)` and the merge is one brand row plus a
concat — but it is a real property, and if expansion ever gets expensive it needs its own
memo rather than a return to composite keys.

*Also: the comment at `render.ts:118` still says "cache key remains source-only". It is
expanded-only, and the module header at :8-13 says so correctly. A stale comment two lines
from the code it describes is the kind someone trusts.*

**And a correction to my own proposed contract, from reading the shipped code.** I specced
`expansionErrors` on the 200 response. But `expand()` throwing `ExpansionError` already
returns **422 with no HTML at all** (`render.ts:97-102`) — expansion is all-or-nothing, so a
200 can never carry an expansion error and the field would always be empty. A permanently
empty field is one someone eventually deletes or, worse, repurposes. Corrected:

```ts
200 -> { html, unstamped, mjmlErrors }
422 -> { error, instancePath?, reason }     // expansion failed; nothing rendered
```

**Deleting the field does not delete the banner** — ui-designer's catch, and the distinction
has to be written down or someone applies the correction one step too far. Two detectors, two
paths: a reference the expander *recognises* but cannot resolve throws → 422; a reference it
*never recognises* (a bug, an unhandled form) reaches mjml → 200 with the tag dropped. Row two
is the class the guard is blind to, and it lands on a 200. So tier 1 is reachable on a 200 via
`mjmlErrors`, and the banner outlives the field that used to feed it.

**Probed the error object shape, because that classifier is now load-bearing.** It holds:

```json
{ "line": 1,
  "message": "Element mj-component doesn't exist or is not registered",
  "tagName": "mj-component",
  "formattedMessage": "Line 1 of /Users/keunbae/code/email-designer-claude-code (mj-component) — …" }
```

`tagName` is present and exact, at body level and nested inside a column, so
`mjmlErrors.some(e => e.tagName === "mj-component")` works with no string matching. That makes
`tagName` the classifier between "content is missing" and "advisory" — do not flatten
`mjmlErrors` to strings.

Two things the probe shows about the payload, both arguing against passing the error objects
through unchanged:

- **`formattedMessage` leaks the server's absolute filesystem path** — mjml interpolates its
  working directory when no `filePath` is given. Low severity for a localhost deployer, not
  nothing for the reverse-proxied shared hosts `OPERATIONS.md` describes, and gratuitous
  either way since the UI needs none of it. Pick fields explicitly; `errors: result.errors` is
  the natural implementation and the wrong one.
- **`line` is a line number in the EXPANDED document**, which has no correspondence to the
  stored template the user is looking at. Handing it to a UI that displays stored source
  points confidently at the wrong place — worse than omitting it. Either drop it, or translate
  it through the expander's region map first, the same reasoning that keeps byte offsets
  server-side in §1.1.

These are two different screens, not one banner with two feeds — ui-designer's catch, and my
four-field contract is what encouraged the collapse. The 422 is a full canvas error state;
the banner is for the case the 422 cannot see, where compilation succeeded and quietly
dropped something.

**One schema consequence survives the wrong hypothesis.** Placement legality still needs
checking at drop time — not to prevent a silent drop, but to stop broken table nesting
shipping. The canvas cannot know whether an instance is legal in a slot, because
`allowedChildren` keys on block *type* and every instance is the same type (`mj-component`)
whatever it expands to. Fix: store the revision's root tag so the check is local.

```ts
// in componentRevisions, alongside mjml:
/** Root element tag of this revision's single body root ("mj-section", "mj-column", ...).
 *  Derived from `mjml` at publish time, guaranteed single by the §1.1 invariant.
 *  Stored, not derived, because the canvas needs it for every palette entry on every
 *  drag; resolving N revision bodies to answer "can this go here?" is absurd.
 *  One writer (publishRevision), one trigger (a publish). */
rootTag: text("root_tag").notNull(),
```

## 2. Proposed `src/db/schema.ts`

Style matches the current file: object-return index callbacks, `text` UUID ids via
`randomUUID()` as in `templateService.ts:59`, `timestamp_ms` integers.

```ts
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Multi-brand design-system shape. Still single-deployer: no User entity, no auth.
// A brand is a namespace for templates + components + head defaults; the deployer
// owns the SQLite file and every brand inside it.

export const brands = sqliteTable(
  "brands",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /**
     * URL-safe IDENTITY, not a label. Used in routes (/b/:slug/…) and as the
     * first half of every `component-id="<brand-slug>/<component-key>"` in
     * template MJML. IMMUTABLE after creation — editing it orphans every
     * reference in the corpus. `name` is the editable label. A genuine
     * re-slug is a dedicated command that rewrites references, not a PATCH.
     */
    slug: text("slug").notNull(),
    /**
     * Per-brand <mj-head> partial. Authored through the EXISTING
     * mjAttributes.ts / headEdit.ts slice editors. Merged ahead of the
     * template's own head at render time; never stored merged. See Q3.
     */
    headMjml: text("head_mjml").notNull().default("<mj-head></mj-head>"),
    /** Optimistic-concurrency token, same contract as templates.version. */
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    slugUnq: uniqueIndex("brands_slug_unq").on(t.slug),
  }),
);

// Named brand values. NOT interpolated into MJML (see Q3) — they are the input
// from which brands.head_mjml's <mj-attributes> is generated, and the palette
// the canvas colour pickers offer.
export const brandTokens = sqliteTable(
  "brand_tokens",
  {
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** e.g. "primary", "text-muted", "font-body". */
    key: text("key").notNull(),
    value: text("value").notNull(),
    /** Drives the editor widget; not inferable from `value` ("16px" vs raw). */
    kind: text("kind").notNull().default("color"), // color | length | font | raw
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.brandId, t.key] }),
  }),
);

// Stable component IDENTITY. Content lives in component_revisions.
export const components = sqliteTable(
  "components",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    /**
     * IDENTITY, not a label: the second half of every
     * `component-id="<brand-slug>/<component-key>"` in template MJML.
     * Unique per brand, e.g. "primary-button". IMMUTABLE after creation for
     * the same reason brands.slug is — a re-key orphans every reference.
     * `name` is the editable label the UI shows.
     */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /**
     * Allocation counter for the next revision, and the "is an update
     * available?" join target. Authoritative over MAX(revision) — if the two
     * ever disagree, this one decides what number the next publish gets.
     * One writer (publishRevision), one trigger (a publish).
     */
    headRevision: integer("head_revision").notNull().default(1),
    /** Optimistic-concurrency token for THIS row (name/key/description edits). */
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    brandKeyUnq: uniqueIndex("components_brand_key_unq").on(t.brandId, t.key),
    brandUpdatedIdx: index("components_brand_updated_idx").on(t.brandId, t.updatedAt),
  }),
);

// Append-only content history. A row here is IMMUTABLE once written — that is
// what makes a pin meaningful and what makes the dependency graph acyclic (Q4).
// No updatedAt, no version: nothing about a revision can change.
export const componentRevisions = sqliteTable(
  "component_revisions",
  {
    componentId: text("component_id")
      .notNull()
      .references(() => components.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    /**
     * A COMPLETE <mjml> document, not a fragment — so parseMjml,
     * serializeMjml, isParsableMjml, /api/render and the whole canvas work on
     * a component with zero changes. The expander takes doc.body only, and
     * REJECTS a revision whose mj-body holds anything but exactly one root
     * element (see §1.1) or whose mj-head holds anything but mj-title /
     * mj-preview (a component head is preview-only; silently dropping an
     * mj-style at expansion time is the failure mode we refuse).
     */
    mjml: text("mjml").notNull(),
    /**
     * Root element tag of this revision's single body root ("mj-section",
     * "mj-column", ...). Derived from `mjml` at publish time; guaranteed
     * single by the §1.1 invariant. Stored rather than derived because the
     * canvas needs it for every palette entry on every drag, and to check
     * drop legality without resolving the body (§1.2). One writer
     * (publishRevision), one trigger (a publish).
     */
    rootTag: text("root_tag").notNull(),
    /**
     * Space-separated attributes the author marked component-owned, which
     * instances may NOT override (verdict-model.md:159 — "two policies, not
     * three"). Parsed from the root's `mj-own` attribute at publish. Stored
     * for the same reason as rootTag: the panel computes the overridable set
     * (`allowedAttrs(rootTag) − ownedAttrs`) without fetching a body.
     */
    ownedAttrs: text("owned_attrs").notNull().default(""),
    /** Optional changelog line shown in the update-available diff. */
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.componentId, t.revision] }),
  }),
);

export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    mjml: text("mjml").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    // Replaces templates_updated_idx: every list query is brand-scoped now.
    brandUpdatedIdx: index("templates_brand_updated_idx").on(t.brandId, t.updatedAt),
  }),
);

// CACHE. Every row is a pure function of templates.mjml. Rebuilt wholesale in
// the same transaction as every mjml write; verifiable and repairable offline.
// One row per INSTANCE (not per template/component pair) — a template may use
// the same component three times, at three different pins.
//
// `component_id` holds the RESOLVED uuid; the MJML carries the slug pair
// ("<brand-slug>/<component-key>") and the extractor resolves it, 422-ing if
// the brand segment doesn't match the template's brand.
//
// `ov-*` overrides are deliberately NOT mirrored here. Nothing queries them in
// aggregate, they don't affect blast radius or the update-available join, and
// mirroring them would be a third cache to keep in sync for no query. They
// live in the MJML and only the expander reads them.
//
// Detach needs no handling: a detached instance is no longer an mj-component
// node, so the next rebuild simply doesn't regenerate its row. Nothing to
// delete, nothing to mark.
export const componentUsages = sqliteTable(
  "component_usages",
  {
    templateId: text("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    /** Block-tree path of the instance, "0/1/2" — same form as stampPaths' pathKey. */
    instancePath: text("instance_path").notNull(),
    componentId: text("component_id")
      .notNull()
      .references(() => components.id, { onDelete: "restrict" }),
    pinnedRevision: integer("pinned_revision").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.templateId, t.instancePath] }),
    // THE blast-radius index: "what breaks if I change this button?" and
    // "who is behind head?" are both prefix scans on this.
    componentIdx: index("component_usages_component_idx").on(t.componentId, t.pinnedRevision),
  }),
);

// Same cache, for component-inside-component (Q4). Keyed on the PARENT REVISION
// because a revision's dependencies are frozen with it.
export const componentDeps = sqliteTable(
  "component_deps",
  {
    parentComponentId: text("parent_component_id").notNull(),
    parentRevision: integer("parent_revision").notNull(),
    instancePath: text("instance_path").notNull(),
    childComponentId: text("child_component_id")
      .notNull()
      .references(() => components.id, { onDelete: "restrict" }),
    childRevision: integer("child_revision").notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.parentComponentId, t.parentRevision, t.instancePath],
    }),
    parentFk: foreignKey({
      columns: [t.parentComponentId, t.parentRevision],
      foreignColumns: [componentRevisions.componentId, componentRevisions.revision],
      name: "component_deps_parent_fk",
    }).onDelete("cascade"),
    childIdx: index("component_deps_child_idx").on(t.childComponentId, t.childRevision),
  }),
);

// Unchanged. Deployment-level, not brand-level — see Q6.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  defaultProvider: text("default_provider").notNull().default("anthropic"),
  defaultMode: text("default_mode").notNull().default("cli"),
  defaultModel: text("default_model").notNull().default("claude-opus-4-7"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
```

Two constraints SQLite can't express, which the service layer must:

- **A template may only reference components of its own brand.** Not an FK (it's a
  three-table condition). Checked in the extractor; 422 on violation. Cross-brand sharing,
  if it's ever wanted, is a "shared" brand plus a visibility flag — deferred.
- **`component_revisions` immutability.** Service-enforced. If you want a backstop now, it
  is four lines, and it protects every pin in the system:
  ```sql
  CREATE TRIGGER component_revisions_immutable
  BEFORE UPDATE ON component_revisions
  BEGIN SELECT RAISE(ABORT, 'component_revisions is append-only'); END;
  ```
  I'd hold it until you've seen a revision mutated once — but it's cheap enough that I
  won't argue if you add it in migration 0001.

---

## 3. Answers

### Q1 — Is `usages` the right shape? Who writes it, and how do you detect drift?

**Not as sketched.** `(template_id, component_id, component_version)` has no instance
identity, so a template using the same button twice collapses to one row — you lose the
count, and if two instances pin different revisions you get two rows with no way to tell
which instance is which. Key it `(template_id, instance_path)` instead, one row per
instance. `instance_path` also gives the "which templates break?" UI a deep-link target
rather than just a template name.

**Treat MJML as the source of truth and `component_usages` as a pure cache, rebuilt
wholesale on every write, plus an offline verify/repair.** Concretely:

- **Who writes it:** only `TemplateService.create/update`. That is already the sole write
  path for `templates.mjml` — `routes/templates.ts` POST/PATCH and `routes/query.ts` all
  funnel through it (`query.ts` calls `ts.update`). One chokepoint, which is the property
  that makes the cache trustworthy in normal operation.
- **When:** inside the same transaction as the row write. better-sqlite3 is synchronous, so
  `db.transaction(tx => { …update…; tx.delete(usages).where(eq(templateId)); tx.insert(rows) })`
  is a real atomic unit. The cache cannot be committed apart from the MJML it describes.
  Note the existing `update()` is a single statement with `returning()` — wrapping it in a
  transaction is a small refactor and should be done in the same commit, not later.
- **How the rows are derived:** `parseMjml(mjml)` → DFS the body → collect `mj-component`
  BlockNodes with their pathKeys → resolve each `component-id` slug pair to a component
  uuid. O(document), and documents are capped at 256KB by `createWebApp.ts:15`. Single-digit
  milliseconds. The extractor is also the validation point, and it rejects rather than
  degrades: **422** on an unresolvable slug, on a brand segment that doesn't match the
  template's brand, or on a `revision` that doesn't exist. A reference that can't be
  resolved must never reach storage — the alternative is a template that saves fine and
  500s at render.
- **Rebuild-on-save, not incremental.** Incremental buys nothing at this size and doubles
  the code paths. Full rebuild-per-template is idempotent by construction.
- **Drift detection and repair are the same code path as the save path.** Add
  `npm run components:verify [--repair]` → `tsx src/db/verifyUsages.ts`: re-extract every
  template, diff against `component_usages`, print the delta; with `--repair`, write the
  recomputed set. Because repair *is* rebuild, there is exactly one implementation of
  "what should the rows be", so verify can never disagree with save. Also check
  `components.head_revision === MAX(component_revisions.revision)` while you're in there.
- **Remaining drift sources** are all out-of-band: direct SQL, a restored backup, a
  migration that touches `mjml`. All are operator actions, and all are covered by running
  verify. Make `verify` a documented post-migration and post-restore step in
  `OPERATIONS.md`, next to the backup command.

Deliberately **not** added: a `usages_rebuilt_at` freshness stamp. A stamp you can trust is
a stamp you stop re-deriving, and the invariant is cheap to recompute from scratch.

`onDelete: "restrict"` on `component_id` is the backstop: a direct SQL `DELETE` of an
in-use component fails rather than silently orphaning 40 templates. The service should
check first and return **409** with the usage list (and offer detach-then-delete, which
inlines the component's expansion into each template before deleting), so the user gets an
actionable rejection and never sees the raw FK error.

### Q2 — Pin or float?

**Pin, per instance, with an "update available" indicator.** Five reasons, in order of
weight:

1. **Pinning does not weaken the propagation promise.** "Edit a shared component and every
   template updates" still holds — it becomes one explicit action over 40 templates
   instead of an implicit consequence of a save. The user experience is a button, not a
   migration.
2. **Email is publish-once with a manual QA gate.** Templates get approved via rendering
   tests. Float silently invalidates the approval on every template that used the
   component, and there is no recall after send. That is the most expensive failure this
   system can produce.
3. **The dry-run diff you want requires a stable "before".** With float, by the time you
   could show a diff, the change has already landed everywhere. The pin *is* the "before".
4. **Float is not cheaper to build.** You still need revision history for rollback and
   audit, so `component_revisions` exists either way; float just means the expander joins
   `head_revision` instead of `pinned_revision`. Pin → float later is a one-line change in
   the expander plus a nullable column. Float → pin later means inventing a pin for every
   existing instance out of nothing.
5. **Pinning buys acyclicity for free** — see Q4.

Mechanics:

- The pin is authoritative **in the MJML** (`revision="4"`); `component_usages.pinned_revision`
  mirrors it, like everything else in that table.
- **Pinning creates one obligation, and it lands on the component editor.** The cost of
  choosing pin over float (and I did choose it) is that *saving a component changes
  nothing*. A user edits the footer, saves, and 23 templates carry on rendering r4 — which
  is correct, intended, and completely silent unless the editor says so. That is the exact
  three-weeks-later surprise ui-designer caught on the `/query` side, mirrored: there, the
  risk is not knowing a change was scoped to one template; here, it's not knowing a change
  reached no templates at all.

  So the component editor's save confirmation has to carry the scope the way the query pane
  does: *"saved as r5 · 23 templates still on r4 · [review propagation]"*. This is not a UI
  nicety bolted onto a schema decision — it is the schema decision's user-visible half, and
  a pinned system without it reads as broken rather than as safe.

- "Update available" is an indexed join, no scan:
  ```sql
  SELECT u.template_id, u.instance_path, u.component_id, u.pinned_revision, c.head_revision
  FROM component_usages u
  JOIN components c ON c.id = u.component_id
  WHERE u.pinned_revision < c.head_revision;
  ```
  served by `component_usages_component_idx`.
- "Update all" = for each affected template, rewrite the `revision` attr on the matching
  BlockNodes, re-serialize, and push it through the normal `TemplateService.update` path so
  the usual version bump, validation and cache rebuild all apply.

  **The blast radius of a propagation run is one attribute value per instance.** Not one
  document per template — one attribute. Everything else in the file is byte-identical,
  which means no serializer fidelity defect, present or future, can turn an unattended
  propagation into a corpus-wide data-loss event. This is the property that makes
  "propagate to 480 templates" a safe unattended operation rather than a supervised one,
  and it's worth protecting: if a future change makes propagation rewrite more than the
  pin, that change has quietly removed the reason this model was chosen.

- **Overrides survive a re-pin untouched.** `ov-*` is applied *after* expansion, so moving
  r4 → r5 reapplies the same overrides to the new revision. There is no base to reconcile
  and no three-value conflict — propagation and per-instance customisation are orthogonal
  by construction rather than by careful merge logic.

  This holds completely for **flat root-level `ov-*` against a revision that has not changed
  its policy.** There are now two exceptions, both static and both mine to own:

  1. If experiment 0.1(b) forces declared slots — "r5 no longer declares the slot this
     instance overrides."
  2. **"r5 marked an attribute component-owned that this instance overrides."** This falls
     out of adding `ownedAttrs` (§1): ownership is declared per *revision*, and revisions are
     immutable, so locking an attribute is itself a new revision.

  Both are detected statically at dry-run rather than merged — blocking rows in the
  propagation UI, not three-way conflicts. Weaker than copy's, but no longer zero, and I have
  now had to qualify this guarantee twice. Anyone writing it into user-facing copy should say
  "overrides carry forward unless the component's policy changed", not "overrides always carry
  forward".

  **The pinning consequence of revision-scoped ownership is the surprising part.** An author
  who locks `background-color` in r5 has not locked anything for the 14 templates pinned to
  r4 — they keep overriding it until they re-pin, which is correct (that is what pinning
  means) and reads as broken ("I locked it and they're still changing it"). This is another
  instance of the disclosure invariant: the lock UI has to say *"applies to templates on r5+ ·
  14 still on r4 · [review propagation]"*, exactly as the component save does. Same root cause
  — pin-over-float — and the same one-line fix.

- Dry-run = the same rewrite, not committed, diffed as **canonicalised MJML source**:
  `serialize(parse(before))` vs `serialize(parse(after))`, fetched per template rather than
  inline. Canonicalising both sides is what stops run 1 from reading as a mass rewrite;
  per-template fetch is what stops a 480-template plan from being a ~9MB payload for a
  screen that shows one pair at a time. (Converged with ui-designer and
  propagation-designer; an earlier draft of this document proposed inline compiled HTML and
  was wrong — HTML can't be canonicalised the way source can.)
- Float, when someone asks for it twice: encode it as `revision="latest"` in the MJML and
  `NULL` in `pinned_revision`. Making that column nullable later needs a SQLite table
  rebuild — which for a *derived* table is `DROP` + `CREATE` + `verify --repair`, i.e. free
  and risk-free. That is the point of keeping it a cache.

### Q3 — Tokens: table, or `<mj-attributes>` in a per-brand head partial?

The question assumes the two mechanisms overlap. Having read `mjAttributes.ts` and
`headEdit.ts`: **they don't.**

`<mj-attributes>` is *defaults keyed by element type* — `<mj-text color="#333" />` means
"every mj-text defaults to this colour". It is not a named-value mechanism, and **MJML has
no variable interpolation at all**. There is no MJML-native way to say `primary = #ff6b00`
and then use `{{primary}}` as an `mj-divider`'s `border-color`. So "table vs mj-attributes"
is not an either/or; they answer different questions.

**Recommendation: both, with a strict division of labour, and no interpolation.**

1. **`brands.head_mjml` is the propagation mechanism.** A per-brand `<mj-head>` partial
   holding `<mj-attributes>`, `<mj-style>`, `<mj-font>`. This carries the great majority of
   what brand styling actually is — fonts, default text/link colour, default button
   styling — and it is MJML's own mechanism, so the compiler does the work. It costs
   almost no new code: `mjAttributes.ts` (`get`/`set`/`deleteMjAttribute`) and
   `headEdit.ts` already edit exactly this string, and the RightPanel "Settings" tab
   already drives them. You are pointing the existing editor at a different string.
2. **`brand_tokens` is the input and the palette, not a runtime substitution.** Editing a
   token regenerates the relevant `<mj-attributes>` entries in `brands.head_mjml` via
   `setMjAttribute` — the token is the source, the head is the derived artifact. The table
   also backs the colour-picker swatches in the canvas, which is the other thing a table
   gives you that a head string doesn't (you can't enumerate "the brand's colours" out of
   an mj-attributes blob).
3. **Tokens are never interpolated into template MJML.** This is the load-bearing "no".
   Substitution would mean stored MJML is not renderable standalone; it would break
   `isParsableMjml` as a gate (`validate.ts:14`); and it would sit a templating language
   underneath a parser whose entire design (`parser.ts:1-22`, "lossless or fail-closed",
   byte-exact slices) is that the stored bytes are the truth. The escape hatch for "brand
   orange on a divider" is `<mj-attributes><mj-divider border-color="#ff6b00" /></mj-attributes>` —
   still mj-attributes, still MJML's mechanism, generated from the token.

Merge mechanics (render/export only, never stored):

- Compose one `<mj-head>` whose inner XML is `brand.head_mjml`'s inner XML followed by the
  template head's inner XML. Brand first so the template's own declarations win on
  conflict — templates override the brand, not the reverse.
- Because the merge is strictly render-time, the editor never sees a merged head. That
  matters: `setMjAttribute` only edits the **first** `<mj-attributes>` block
  (`mjAttributes.ts:242`), so a merged head with two of them would be edited wrongly. Keep
  the merge downstream of everything that writes.
- A template with no `<mj-head>` at all parses to `doc.head === undefined`
  (`parser.ts:522`), so the merge must synthesize one — the `__synthetic` path in
  `types.ts:103` and `headEdit.ts:21-51` already describes exactly this shape; reuse it
  rather than inventing a second convention.

Minor found-in-passing: `getMjAttribute` returns the **raw escaped slice**
(`mjAttributes.ts:218`), so a token value containing `&` reads back as `&amp;`. Decode at
the token layer or you'll get `&amp;amp;` after two round-trips.

### Q4 — Nested components?

**Yes.** The case is concrete and universal in email: a "product card" contains a "button".
Forbidding nesting means the button's markup is duplicated inside the card, and the moment
the brand changes the button, the card is silently stale and nothing in the system knows —
which is the exact failure the project exists to remove. Refusing nesting doesn't remove
the dependency, it just makes it invisible.

**The cycle risk is largely dissolved by the pin decision, not managed.** A reference names
`(component_id, revision)`, and revisions are immutable. A new revision of A can only
reference revisions of B that already exist; no existing revision of B can be edited to
point at A's new revision. So the dependency graph over `(component, revision)` pairs is a
DAG **by construction** — a cycle would require mutating an immutable row. This is a real
consequence of pinning and is worth more than any check.

Keep the check anyway, as a backstop:

- On publish, DFS from the new revision over `component_deps` (memoised on
  `(componentId, revision)`) and reject on a repeat — this is what catches the day someone
  ships the float feature and reintroduces the hazard.
- **Cap depth at 5** and reject beyond it. Expansion is recursive and unbounded recursion
  over user data in a render path is a stack overflow waiting for a bad row.
- Memoise expansion on `(componentId, revision)`. Because revisions are immutable, that
  cache never needs invalidation — it fits alongside the existing 32-entry LRU in
  `render.ts:20-35`.

Blast radius with nesting is a transitive closure, not a single lookup: changing the button
affects templates that use the card. `component_deps` + `component_usages` give you that in
a bounded number of indexed hops (depth ≤ 5).

### Q5 — Migration

Ordering constraints that come from this codebase specifically:

- `openDb` sets `PRAGMA foreign_keys = ON` at connect (`src/db/index.ts:22`), so FK
  enforcement is live during migration.
- Drizzle's better-sqlite3 migrator runs migration statements inside a transaction. **`PRAGMA
  foreign_keys = OFF` is a no-op inside a transaction in SQLite** — and drizzle-kit's
  generated SQLite table rebuilds emit exactly that pragma. Hand-edit it to
  `PRAGMA defer_foreign_keys = ON;`, which *does* work inside a transaction (it defers
  enforcement to COMMIT). See the verification note in §5.
- SQLite cannot `ALTER TABLE … ADD COLUMN` a `NOT NULL` column with a `REFERENCES` clause:
  NOT NULL requires a non-NULL default, and an added column carrying REFERENCES must
  default to NULL. So `templates.brand_id` **requires a full table rebuild**, not an ADD
  COLUMN.
- `DROP TABLE` drops the table's indexes. Every index must be recreated after the rename or
  it vanishes silently — the app still works, just slower, so nothing tells you.

**Step 0 — the migration toolchain does not currently work from a clean clone. Fix this
before designing anything on top of it.** Verified directly:

```
$ cat .gitignore | grep -A1 Drizzle
# Drizzle migration metadata (kept out of VCS; SQL files in drizzle/migrations/ ARE committed).
drizzle/migrations/meta/

$ git ls-files drizzle
drizzle/migrations/0000_initial.sql          # ← meta/ is NOT tracked

$ ls drizzle/migrations/meta/
_journal.json                                # ← untracked, mtime today, and ALONE
```

Drizzle's migrator reads `meta/_journal.json` to know which migrations have run, so on a
clean clone `makeTestDb` (`tests/helpers/makeTestDb.ts:23`) and `npm run db:migrate` both
die before touching SQL. That gates every DB-touching test. The `.gitignore` comment
asserting meta belongs out of VCS is wrong — drizzle's own guidance is to commit the whole
`drizzle/` folder, journal and snapshots included, because the snapshots are the diff base.

**The part that bites this specific migration:** `meta/` contains `_journal.json` and
*nothing else*. A real `drizzle-kit generate` also writes `meta/0000_snapshot.json`, and
that snapshot is what `generate` diffs the next schema against. With it missing,
**`drizzle-kit generate` will not emit a brands diff — it will emit the entire schema as
`0001`, re-`CREATE TABLE templates` and all.** So the journal that exists locally is not
just untracked, it's incomplete, and the first thing you'd do in this plan would silently
produce the wrong migration.

Step 0, in order:

1. Delete the `drizzle/migrations/meta/` rule from `.gitignore` and fix the comment.
2. Regenerate the meta directory with `drizzle-kit` rather than hand-writing it — the local
   `_journal.json` has `"when": 1700000000000`, a placeholder, which is a tell that it was
   reconstructed by hand. Generate against the current schema in a scratch output dir and
   **diff the emitted SQL against the committed `drizzle/migrations/0000_initial.sql`.**
3. That diff is the verification step for correction (b) at the top of this document: the
   `settings.default_mode` `'api'`-vs-`"cli"` drift is exactly what will show up in it. If
   the regenerated SQL is byte-identical, there was no drift and (b) is a false alarm.
   If it differs, the difference **is** the drift — resolve it, in its own commit, before
   generating anything for brands.
4. Commit `drizzle/migrations/meta/` (journal + snapshot).
5. Only then run the test suite and record what actually passes.

Until step 0 lands, every migration below is unrunnable and untestable, and any claim about
the suite's current state is unverified — including mine. See §5.1.

#### Step 0 has since been executed, and it blocks migrations on any existing database

Verified in the working tree: `.gitignore` rule removed, `meta/` now carries both
`_journal.json` **and** `0000_snapshot.json` (a proper regeneration, not a hand-write).
Good. Two consequences, one of them serious.

**It answered correction (b): the `default_mode` drift was real.** The regenerated SQL says
`` `default_mode` text DEFAULT 'cli' ``; the deleted `0000_initial.sql` said `'api'`. The
divergence I flagged existed, and regeneration silently resolved it in favour of the schema
file. Fine as an outcome — but it resolved inside a commit that was about the journal, which
is how a behaviour change gets shipped under an infrastructure heading.

**The serious one: `0000_initial.sql` was deleted and replaced by
`0000_public_madelyne_pryor.sql`, and the journal's `when` moved `1700000000000` →
`1789327228942`. Any database that already ran `0000_initial` will now try to run 0000
again and fail.** This is not a hash question — I read the gate in
`node_modules/drizzle-orm/sqlite-core/dialect.cjs:681`:

```js
if (!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis) { …run… }
```

It compares the last applied migration's `created_at` against each journal entry's `when`.
The stored hash is written but **never compared**. An existing DB holds
`created_at = 1700000000000`; the new entry's `when` is larger; so the migrator re-runs it,
hits `CREATE TABLE settings` on a table that exists, throws, and `ROLLBACK`s (dialect.cjs:690).
The database is not corrupted — but **it is stuck, and so is every brands migration behind it**.

A fresh database is unaffected, which is exactly the problem: this passes CI, passes
`makeTestDb`, passes a clean clone, and fails only on the one database that has the real
templates in it.

Fix, before any brands migration is authored:
- If no deployed DB has run `0000_initial` yet, do nothing — confirm that first, in writing.
- Otherwise the deployed DB needs its `__drizzle_migrations` row reconciled to the new
  journal (`UPDATE __drizzle_migrations SET hash = <new>, created_at = 1789327228942` for the
  0000 row) as a one-off, backed up first, before `db:migrate` is run again.
- Cheaper alternative if it's still possible: restore the `0000_initial` tag and `when` in
  the journal so the identity of the already-applied migration is preserved, and let the
  regenerated SQL keep its content under the old name.

Two further consequences of that same gate, both worth knowing before writing 0001–0003:

- **All migration files run inside ONE transaction**, not one each — `BEGIN` is outside the
  loop (dialect.cjs:676), `COMMIT` after it (689). This *settles* §5.2 item 3: `PRAGMA
  foreign_keys = OFF` inside a migration is a no-op, `defer_foreign_keys` is correct. It also
  means 0001 does **not** commit before 0002 runs — they share a transaction. The 0001-then-0002
  ordering still works, but via deferred FK checks at the single COMMIT (by which time the
  Default brand row exists), not via 0001 having committed. If you were relying on the
  intuition that each file is its own unit, don't: nothing in 0001 is durable until every
  later file has also succeeded, which is on balance what you want here — a partial brands
  migration is not a state anyone should have to recover from.
- **A migration whose `when` is lower than an already-applied one is skipped silently,
  forever.** Only `MAX(created_at)` is consulted. Never hand-edit a journal `when` downward.

**Steps.** Generate with `drizzle-kit generate`, then hand-edit; commit both the schema and
the SQL as `OPERATIONS.md:65` requires.

**0001_brands.sql** — additive only, no existing table touched.
```sql
CREATE TABLE `brands` (…);
CREATE UNIQUE INDEX `brands_slug_unq` ON `brands` (`slug`);
CREATE TABLE `brand_tokens` (…);
CREATE TABLE `components` (…);
CREATE UNIQUE INDEX `components_brand_key_unq` ON `components` (`brand_id`,`key`);
CREATE INDEX `components_brand_updated_idx` ON `components` (`brand_id`,`updated_at`);
CREATE TABLE `component_revisions` (…);
CREATE TABLE `component_usages` (…);
CREATE INDEX `component_usages_component_idx` ON `component_usages` (`component_id`,`pinned_revision`);
CREATE TABLE `component_deps` (…);
CREATE INDEX `component_deps_child_idx` ON `component_deps` (`child_component_id`,`child_revision`);

-- Literal id, not randomUUID(): the constant is referenced by 0002 and must be
-- identical in every environment and on every re-run.
INSERT INTO `brands` (`id`,`name`,`slug`,`head_mjml`,`version`,`created_at`,`updated_at`)
VALUES ('default','Default','default','<mj-head></mj-head>',1,
        CAST(strftime('%s','now') AS INTEGER)*1000,
        CAST(strftime('%s','now') AS INTEGER)*1000);
```
`component_usages` and `component_deps` are created here but stay empty; both reference
`templates`/`components`, and `templates` is about to be rebuilt in 0002 — SQLite handles
this because a rebuild that ends in `ALTER TABLE … RENAME TO templates` re-points child FK
references by name under `legacy_alter_table = OFF` (the default since 3.25). If you would
rather not depend on that, create `component_usages` in 0003 instead; it's empty either
way, and that ordering removes the question entirely. **I'd take the 0003 option** —
nothing is gained by creating it early.

**0002_templates_brand_id.sql** — the 12-step rebuild.
```sql
PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `__new_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `brand_id` text NOT NULL REFERENCES `brands`(`id`) ON DELETE RESTRICT,
  `name` text NOT NULL,
  `description` text,
  `mjml` text NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_templates`
  (`id`,`brand_id`,`name`,`description`,`mjml`,`version`,`created_at`,`updated_at`)
SELECT `id`,'default',`name`,`description`,`mjml`,`version`,`created_at`,`updated_at`
FROM `templates`;
--> statement-breakpoint
DROP TABLE `templates`;
--> statement-breakpoint
ALTER TABLE `__new_templates` RENAME TO `templates`;
--> statement-breakpoint
CREATE INDEX `templates_brand_updated_idx` ON `templates` (`brand_id`,`updated_at`);
```
Note `templates_updated_idx` is deliberately **not** recreated: the only query it served
(`TemplateService.list()`, an unscoped `ORDER BY updated_at DESC`) becomes brand-scoped and
is served by the new composite index. A dead index is a write cost plus a false impression
of coverage. If you keep a cross-brand "all recent templates" view, recreate it and say so.

**0003_component_usages.sql** — the two cache tables, if you took the reordering above.

Then, as part of the deploy, not as a migration: `npm run components:verify --repair`, so
the cache is correct immediately rather than filling in as templates happen to be saved.
(It will be a no-op on this first run — no template contains a reference yet — but making
it a standing post-migration step is what keeps it correct after the *next* one.)

**Deploy order** (step 0 above is a prerequisite, landed and committed, not part of the
deploy):
1. Stop the server. The rebuild is a `DROP TABLE`; with WAL and a live writer you are
   inviting `SQLITE_BUSY` mid-rebuild.
2. `sqlite3 data.db ".backup 'pre-brands.db'"` (`OPERATIONS.md:74`).
3. `EMAIL_DESIGNER_DB_PATH=… npm run db:migrate`.
4. `npm run components:verify --repair`.
5. Start.

**Is it reversible? Not in place, and I would not pretend otherwise.** drizzle-kit emits no
down migrations, and a hand-written down for a table rebuild is code that runs exactly once,
untested, during an incident. **The rollback is the file-level restore from step 2** — for a
single-file SQLite deployment that is the honest, actually-tested answer, and it is why
step 2 is not optional. I can supply a symmetric `drizzle/rollback/0002_down.sql` (rebuild
`templates` without `brand_id`, drop the new tables) clearly marked *manual only, restore a
copy and test against it first* — but the backup is the real mechanism and the down-script
is a convenience.

One genuine irreversibility to note: rolling back after templates have acquired
`<mj-component>` references leaves those references in `templates.mjml` with no components
table to expand them against. Every such template renders as a 500 under the guard in §1.
Rollback past the point where components are in use therefore means restoring the backup,
not running a down migration — reinforcing the same conclusion.

### Q6 — Does `settings` stay a singleton?

**Yes, unchanged, and I'd add nothing to it.**

`defaultProvider` / `defaultMode` / `defaultModel` are **deployment** facts, not brand facts:

- `defaultMode` picks `api` vs `cli`, which depends on whether `ANTHROPIC_API_KEY` is in the
  server's env and whether the `claude` binary is on `PATH` (`OPERATIONS.md:18-25`). Both
  are process-level. Per-brand values would let a brand select a mode that cannot work on
  this host — a rejection the user has no way to act on, on a per-brand basis, from the UI.
- `scripts/setup.mjs` writes the mode into the singleton at bootstrap, before any brand
  could exist (`OPERATIONS.md:51`). Per-brand settings force bootstrap to invent a brand.
- The brand-scoped settings that *do* exist are design settings, and they already have a
  home: `brands.head_mjml` and `brand_tokens`.

**Do not add `active_brand_id` to `settings`.** The current brand is view state, and it
belongs in the URL — `/b/:brandSlug/t/:templateId` with react-router (already a dependency),
falling back to `localStorage` for "last brand". Putting it in a singleton row means two
open browser tabs fight over one value, which is a bug with no good fix. The URL is also
the industry-standard shape for this and makes brand context linkable.

Separately, while you are in `settings`: `ALLOWED_MODELS` is
`["claude-opus-4-7", "claude-sonnet-4-6"]` (`settingsService.ts:5`), which is stale against
current model ids. Out of scope here, worth its own ticket.

**And it is duplicated, which is the sharper problem.** The identical literal appears at
`settingsService.ts:5` *and* `web/src/settings/Settings.tsx:5`, with no shared import and no
test asserting they agree — the same defect class as the `default_mode` drift in correction
(b), which had already bitten. The asymmetry is what makes it bite: the web list is the only
thing the user can pick from, the server list is the only thing that validates. Add a model
to the server and it never appears in the UI (silent, harmless). Add it to the UI and
`SettingsService.update` throws `UnknownModelError` — **the UI offers a radio button the
server rejects**, which is a rejection the user cannot act on.

The fix is cheap and the wiring already exists: `web/vite.config.ts` and `web/tsconfig.json`
already alias `@shared` → `src/shared`, which is how `web/src/blocks/index.ts` imports the
block registry today. Move `ALLOWED_MODELS` / `ALLOWED_MODES` to `src/shared/` and import
both sides from it. Worth doing *before* the brands work touches settings scoping, so the
list has one home when someone starts adding per-brand anything.

---

## 4. Non-schema work this design implies

Roughly ordered by risk, since the schema is the easy part.

| Area | Change |
|---|---|
| **`.gitignore` + `drizzle/migrations/meta/`** | **Step 0 in §Q5. Gates everything else — do first.** |
| **scoping refactor** | **`templateService.ts` + all of `src/server/routes/` + `web/src/api/`. Per-brand service construction so an unscoped call can't be written. See §0(a) — this is the bulk of the work.** |
| `registry.ts` | `mj-component` entry; add to `mj-column` + `mj-section` `allowedChildren`. |
| new `componentExpander.ts` | returns **`{ mjml, regions }`**, not a string (§1.1 — provenance exists only at substitution time). Recursive expand, memoised on `(componentId, revision)`, depth cap 5, `ov-*` via the quote-aware scan from `mjAttributes.ts` (**not** a regex), throw-on-survivor at its exit. |
| new `usageExtractor.ts` | `parseMjml` → DFS → resolve slug pair → `{componentId, revision, instancePath}[]`. One implementation, used by save, verify and repair. 422s on unresolvable slug / brand mismatch / missing revision. |
| detach | per-instance, one-way expand-in-place then drop the reference. Route + a canvas action. |
| export | `GET …/templates/export` — expanded MJML for the corpus. Week one, not later (§1 item 6). |
| `registry.ts` (follow-on) | model `mj-wrapper` as a container; deletes the unreachable-instance category. |
| `templateService.ts` | wrap `update`/`create` in a transaction; rebuild usages inside it; brand-scope `list`/`get`. |
| `render.ts` | merge brand head, expand, then compile; stamp against the plan with the new component matcher. |
| `stampPaths.ts` | ~~`matchesComponentInstance`~~ — refuted (§0.1a). Stamp the **expanded** source and translate paths via the expander's region map; no new matcher. |
| `query.ts` | reference-multiset guard, 502 on mutation. |
| `promptBuilder.ts` | exclude from catalog; preserve-verbatim guidance; regenerate snapshot. |
| `routes/templates.ts` | brand in the path or as a required field; `web/src/api/templates.ts` follows. |
| new `routes/components.ts`, `routes/brands.ts` | CRUD + publish-revision + usage lookup + update-all/dry-run. |
| `tests/helpers/makeTestDb.ts` | seed the Default brand, or every existing integration test fails on the `brand_id` NOT NULL. |
| `OPERATIONS.md` | migration order, `components:verify` as a post-migration and post-restore step. |
| stale comments | `render.ts:118` says "cache key remains source-only" (it is expanded-only; header at :8-13 is correct). `registry.ts:20-25` says `allowedAttrs` is "explicitly not a validation gate" — with `ownedAttrs` it governs override permission, so that comment now actively reassures the person most likely to trip it. Fix each in the commit that touches its function. |

`tests/integration/services.test.ts` and `templates-routes.test.ts` construct templates with
no brand; both need a brand fixture. That's mechanical but touches every test in those two
files.

---

## 4.5 D-2 (resolved): reference model, not copy

**Adjudicated — REFERENCE wins.** Verdict in `.plan/verdict-model.md`, summary in
`PLAN-design-system.md` §11 D-2. This document is written against the winner; the
comparison is kept because the reasons constrain what may change later without re-opening
the decision.

Raised by ui-designer, correctly: these were never two implementations of one feature but
two different products, and the choice decided whether most of `.plan/propagation.md` and
`.plan/ui.md` §4–§5 existed at all.

| | Copy model (lead's `data-cmp-*` stamps) | Reference model (§1 of this doc) |
|---|---|---|
| Template MJML holds | the component's expanded markup, stamped with id + content hash | `<mj-component component-id revision />` |
| Propagation is | a batch rewrite of N documents, each of which can fail | an attribute bump; atomic, can't partially fail |
| Dry-run diff shows | N before/after document pairs to review | "23 templates re-pin r9 → r10" |
| Local edits | free — edit the blocks; the hash reports divergence | need `ov-*` overrides, a variant, or detach |
| Stored MJML is | a complete, portable artifact | meaningless without this server |
| New failure modes | drift, three-value conflicts, reformat noise, locked-reset | render-time expansion errors, dangling references |

**True under either model** (so they're not evidence for the fork, and they need fixing
regardless):

- An instance inside `<mj-wrapper>` is unreachable. `parser.ts:304` makes any unmodeled tag
  a single `CustomPassthroughNode` holding a verbatim string, so a tree walk cannot see a
  stamp *or* a reference inside it — and `RightPanel.tsx:579` actively instructs users to
  paste `<mj-wrapper>`. **Fix it at the root instead of managing it: add `mj-wrapper` to
  `BLOCK_REGISTRY` as a container** (`allowedChildren: ["mj-section"]`, plus `mj-component`
  under the reference model). It's a standard MJML tag the UI already recommends; modeling
  it deletes the "unreachable instance" category rather than giving it a UI state. Roughly
  the same size as the special-casing it replaces. **Adopted as a scoped follow-on.** MJML
  forbids wrapper-in-wrapper, so the container nesting that would otherwise complicate
  `allowedChildren` and the stamp plan does not arise.

- **Rich `<mj-text>` is a separate, larger gap and does not have a registry fix.**
  `parser.ts:437-446` demotes *any* leaf with an element child to a passthrough, so
  `<mj-text>Buy <b>now</b></mj-text>` is a `CustomPassthroughNode` with unreadable attrs —
  not a registry omission but a modelling limit in the leaf branch. Inline HTML inside
  `mj-text` is the norm in real email, so a meaningful share of real templates' text blocks
  are *already* unreachable today, independent of components. `src/templates/starter.mjml`
  happens to dodge it (every `mj-text` is plain), which is probably why it hasn't surfaced.
  Two consequences: ui-designer is right to keep an unreachable bucket after the
  `mj-wrapper` fix, and the lead's rich-text argument for reference holds but narrows —
  rich text works as a *component body* (its own document, expanded whole), while inside the
  component's own editor that `mj-text` is still only editable as raw MJML in the RightPanel
  textarea. That's a real UX limit to name rather than discover.
- Diffs travel as **MJML source, behind a per-template call**, canonicalised
  `serialize(parse(x))` on both sides. ui-designer and propagation-designer converged on
  this independently and I agree — inline HTML for 480 templates is ~9MB, the screen shows
  one pair at a time, and HTML can't be canonicalised the way source can. My earlier
  `htmlBefore`/`htmlAfter` inline shape is withdrawn.

**What should actually decide it** — four questions, in the order I'd weight them:

1. **How does the copy model survive `/query`?** This is my strongest objection and I'd want
   it answered before committing. `query.ts:131` replaces the entire template with the
   LLM's output wholesale, and `SYSTEM_GUIDANCE` demands *"the COMPLETE updated MJML source…
   never a fragment"*. So every AI turn rewrites every byte of every component region in
   that template. Hashing the canonical form (`serialize(parse(x))`) kills the
   whitespace/formatting half of that problem — but not the half where the model edits a
   real attribute inside a component region, which it will, because nothing tells it the
   region is sacred. Under copy, detecting that means canonically diffing every instance
   region against its component revision on every turn. Under reference, the guard is a
   multiset comparison of self-closing tags. That asymmetry is large and it lands on the
   tool's headline feature, not an edge case.
2. **At 480 templates, who reads a 480-row review screen?** Nobody. They click "apply all",
   and at that point the copy model's safety advantage is gone while its costs — drift,
   three-value conflicts, reformat noise — remain. The reference model's "23 templates
   re-pin r9 → r10" is a claim a human can actually check. This argument gets *stronger*
   with corpus size, which is the wrong direction for a design system's core loop.
3. **When a campaign needs a shared component to look different just this once, is the
   right answer "make a variant" or "just edit it"?** Variant → reference. Edit → copy.
   This is the genuine product question and it's about who the user is: a brand owner
   enforcing consistency, or a marketer shipping campaigns. Design systems answer
   "variant"; email teams in practice answer "just edit it".
4. **Is `templates.mjml` a deliverable read by anything outside this app?** If MJML source
   gets handed to an ESP or checked into a marketing repo, copy wins outright. **Answered
   under reference by the export endpoint** (§1 item 6): expanded MJML on demand, so
   "complete artifact" becomes a property of the deliverable rather than of the storage.
   I originally proposed a derived `templates.expanded_mjml` column for this and it was the
   worse option — a column is a third cache that can go stale, an endpoint computes and
   cannot. Answers (4) fully; answers none of (3), which is what detach is for.

**Outcome, and the argument I got wrong.** I had conceded to copy on "its hard problems are
loud, and loud beats clever" — my §1 needed five guards purely to stop reference failing
*silently*, and I weighted that heavily. Two counters answered it, and both are better than
my original reasoning:

1. **The five guards collapse to roughly one.** The silent-failure class is real and
   verified — mjml's soft validation drops an unexpanded `mj-component`, renders 200,
   content simply gone — but it has a single choke point. A **throw-on-survivor guard at the
   expander's exit** converts the whole class from silent to loud in one check (§1, item 5).
   Loud is *achievable* under reference; it just has to be built deliberately instead of
   inherited. I was treating "inherited" as free and "deliberate" as expensive, and at one
   check that's wrong.
2. **Copy's problems are loud in theory and silent in practice here.** Its write path is
   "re-serialize the corpus", so every serializer fidelity defect — present *and future* —
   becomes a corpus-wide data-loss event under an unattended feature. Measured in
   adjudication: a copy propagation mutates `<mj-text>Buy &amp; save</mj-text>` into
   `&amp;amp;` — bytes with no relationship to the component being changed. Per-run blast
   radius is copy = every byte of 23 templates, reference = one attribute value in each. A
   review screen is only "loud" if someone reads it, and criterion 2 says at 480 templates
   nobody does.

**And criterion 1 — my own `/query` finding — points at reference, not away from it.** I had
the finding right and the direction backwards: I filed it as the thing that might make me
*re-open* the fork, when it is the strongest single argument for the model I had already
specified. Under copy, a template enters "locally modified" because someone asked Claude to
change the subject line. The detection asymmetry I named myself — canonically diffing every
instance region against its revision on every turn, versus a multiset comparison of
self-closing tags — is not a tie-break.

One more case settled it, which I had missed entirely: **rich text.** Under reference, a
rich-text instance is a component body that compiles cleanly with `<b>` intact. Under copy
it parses to `mj-custom-passthrough` with **attrs unreadable** (`parser.ts:304`), so merge
on it is impossible — and rich text is the main case for component blocks.

**What this constrains going forward.** The decision rests on propagation touching one
attribute per instance. Any future change that makes a propagation run rewrite more than
the pin has silently removed the reason for the model, and should re-open D-2 rather than
proceed. Likewise experiment 0.1(b): if instances need more than ~3 overrides on average,
`ov-*` has degenerated into copy with worse ergonomics and the decision is back open.

## 5. What I am not sure about

Flagged rather than buried, roughly by how much it would cost to be wrong.

### 5.1 Nothing here has been executed

**`node_modules` does not exist in this checkout**, so no command in this document was run
and no test was observed passing or failing. Everything about MJML's and drizzle's runtime
behaviour is from reading this repo's source plus prior knowledge.

Combined with step 0, the honest position is that **the suite has probably never been run
in this working copy at all** — and since the missing `meta/` gates every DB-touching test,
a reported pass rate from before step 0 tells you about the toolchain, not the code. Treat
any "N passing" figure, including one I might quote, as unverified until someone runs it
after step 0.

Two environment facts I did verify, both of which can move results on their own:
`.nvmrc` says **20**, the local runtime is **v26.0.0** — six majors, and `better-sqlite3` is
a native module whose prebuilds are per-ABI. Pin node 20 in CI and in whatever runs the
verification for step 0, or you will be debugging the toolchain and the schema at the same
time.

### 5.2 Open questions

1. Everything below inherits the "not executed" caveat in §5.1.
2. **MJML's `<mj-attributes>` conflict resolution.** I claim later declarations win, so
   brand-first/template-second gives templates the override. I did not verify it. If it's
   the reverse, swap the concatenation order — cheap to fix, but verify before building UI
   on top of it. Test: two `<mj-attributes>` blocks setting `mj-text color`, compile, look
   at the output.
3. ~~Whether drizzle's better-sqlite3 migrator wraps migrations in a transaction.~~
   **SETTLED — yes, and in one transaction for ALL files.** Read directly at
   `node_modules/drizzle-orm/sqlite-core/dialect.cjs:676-690`: `BEGIN` outside the loop,
   `COMMIT` after it, `ROLLBACK` on throw. So `PRAGMA foreign_keys = OFF` inside a migration
   is a no-op and `defer_foreign_keys` is the correct pragma. See the step-0 subsection in
   Q5 for the two further consequences.
4. **Whether `css-class` survives MJML compilation onto the element `stampPaths` matches.**
   Promoted out of this list into **experiment 0.1(a)** — it is the only load-bearing claim
   here not settled by reading code, and if it fails the canvas overlay breaks for every
   template using a component. It gates the DDL rather than trailing it.
5. **The `ALTER TABLE … RENAME` / child-FK repointing question in 0001 vs 0003.** I
   sidestepped it by recommending the reorder rather than resolving it. If you keep the
   0001 ordering, verify with `PRAGMA foreign_key_check` after migrating a copy.
6. **Overrides — resolved, one thread left open.** `ov-*` on the instance tag, applied
   after expansion, is now specified in §1. The interaction I worried about turned out not
   to exist: because overrides apply *after* the revision is expanded, they are orthogonal
   to propagation — no base, no merge, no three-value conflict, and a re-pin carries them
   forward untouched. What remains open is **scope**, not mechanism: whether `ov-*` can
   address anything below the component's root element (`ov-cta-href` reaching a nested
   button). Flat root-level overrides are what I've specified; anything deeper needs a
   target syntax and starts drifting toward slots. Experiment 0.1(b) tells you whether
   that pressure is real before anyone designs for it.
7. **`instance_path` stability.** It changes whenever blocks are reordered. Harmless for the
   cache (the whole row set is rebuilt), but if any UI ever *stores* an instance path —
   a saved "review this instance later" list, say — it will rot. Don't let one leak into a
   durable surface.
8. **I did not read** `web/src/canvas/*` in depth (Canvas, PropertiesForm, OverlayTree) or
   `roundTrip.ts`. The canvas-side cost of a new block type — icon rail entry, properties
   panel behaviour for a non-editable block, drag/drop rules — is real work I have not
   sized. `roundTrip.ts` is a property test over parse/serialize; a new modeled block type
   probably needs a generator entry there.
9. **Scale assumptions.** "Full rebuild is cheap", "MAX() is fine", "DFS at save time is
   fine" all assume hundreds of templates and components, which matches the single-deployer
   framing. At tens of thousands the verify command becomes a background job and the
   deps DFS wants a materialised closure. Nothing here becomes *wrong* at that size, but
   the "just recompute it" arguments do stop being free.
