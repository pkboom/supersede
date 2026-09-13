# Plan — pivot from email builder to agency email design system

Status: **D-2 (§11) is the governing verdict — the reference model.** Read §11 before §5–§8.
§5 and §6 are retained as history under supersession banners; the copy-model machinery they
describe is not being built. §7 and §8 are designed and current, but **deferred** per the build
order in §12. §1–§4, §9 and §10 are evidence-complete and independently fact-checked.

---

## 1. Why pivot — and why this is a contested bet, not a settled one

The builder category this repo competes in is saturated and price-capped: Topol $10/mo, Stripo
$20–125, Beefree $30, Parcel $29/seat, with free MJML / React Email / Maizzle owning the floor.
That part is not in dispute.

The pivot target is an agency email design system: **edit a component once, every template using
it updates.** The demand evidence is real — Mavlers sells the equivalent as a productized service
at "$4,999, flat, 6–7 week engagement", and Knak's own customers review it saying *"Difficult to
copy paste modules from one template to next."*

### The honest statement of the bet, which an earlier draft of this plan got wrong

An earlier draft cited "Knak, Dyspatch, Stensul, Chamaileon, Taxi are sales-led; four of five
publish no price at all" as **evidence the category is open**. That inverts the founder's own
research. `~/code/ideas/notes/thin-niche-fallacy.md` (confidence: high) records the *identical*
fact — same five vendors, same "four publish no price at all" — as **instance 1 of three ways the
empty-niche instinct failed**, concluding: *"Not empty — priced invisibly."*

The rest of the cited wiki says the same thing:
- `email-tooling-consolidation.md`: healthy self-serve email tooling is "$10–$30/mo… **crowded and
  below a $49/mo floor**", and the $99–199 tier was acquired and shut 2021–2025.
- `email-production-bottleneck.md` carries an **UNRESOLVED** contradiction turning on precisely
  this plan's bet — "leaving open whether a tool can capture labour spend".
- `open-questions.md` lists that question verbatim as open.
- `decision-log.md:31` scored agency-design-system at **demand 21 / edge 5**, inside a run whose
  terminal condition was "the constraint set has been shown unsatisfiable by desk research".

And the Mavlers anchor is **service revenue being repriced as SaaS at 1/100th** — which is exactly
the labour→tool conversion the wiki marks unproven.

**So: this is a bet on an open question, taken deliberately, not a conclusion the research
supports.** The plan proceeds — but §12 restructures it so the bet is *tested cheaply and early*
rather than assumed and built on for eight weeks.

### The honest cost
This scores 5/15 on the founder's domain edge. Deliverability/DMARC/MIME expertise buys almost
nothing here; the win would be on execution, not on knowing things competitors don't.

## 2. What already exists (measured)

| Area | LOC | Disposition |
|---|---|---|
| `src/shared/blocks` | 2,620 | Keep — the MJML engine, the expensive part |
| `web/src` | 4,707 | Keep, extend |
| `tests` | 3,454 | Keep; some invalidated by scoping (see §7) |
| `src/server` | 887 | **Main blast radius** — scoping refactor |
| `src/llm` | 529 | Keep; needs brand awareness |
| `src/db/schema.ts` | **32** | Rewrite (small file, large consequence) |

**Correction to an earlier estimate:** schema.ts is 32 lines, not 96. That makes the pivot look
cheaper than it is. The cost was never the DDL — it is that brands introduce a *scoping
dimension* that every route and service currently assumes away. `templateService.ts` states it
outright: "Single-user open-source shape: no per-user scoping. Every template lives in one
global pool owned by the deployer." Meanwhile `package.json` already advertises "Hosted
multi-tenant MJML email designer." The blast radius is `templateService.ts` + `src/server/routes/`.

---

## 3. The core technical assumption — VERIFIED

Component identity can be stamped onto nodes as custom attributes and survives the MJML
round-trip. Verified independently by two lanes, one running real `fast-xml-parser@4.5.6` +
`mjml@4.18.0` in a sandbox.

- `allowedAttrs` appears nowhere in `parser.ts` or `serializer.ts` — only `PropertiesForm.tsx`,
  `promptBuilder.ts:120`, and tests. It is a UI view filter, not a parse gate.
- `getAttrs()` (`parser.ts:212`) takes whatever the XML parser hands it, unfiltered.
- Parser config is favourable: `parseAttributeValue:false, parseTagValue:false,
  processEntities:false, trimValues:false`. `"0.50"` is not coerced to 0.5; `"007"` not to 7.
- Proven by execution: `data-cmp="brand/primary-button" data-cmp-v="3"` on `mj-button` lands in
  the attrs Map, the node stays a modeled `BlockNode`, source attribute order is preserved, and
  programmatic `attrs.set()` re-emits and survives a second parse byte-stable.
- Precedent: `stampPaths.ts:532` already ships an in-band `data-mjml-passthrough` sentinel.

**What this verifies, given D-2 (§11).** The reference model does not stamp instances, so this is
no longer the foundation of the propagation design. It remains load-bearing for two things the
reference model *does* rely on: **`ov-*` override attributes on the reference tag** (verified
byte-identical over 5 parse/serialize cycles with an entity-bearing URL), and the ability to carry
any custom attribute through the round trip at all.

Note the constraint in §5: values must stay within `[A-Za-z0-9._/-]`, or entity-encoded, because of
the §0.2 escaping defect.

---

## 3.5 GATE — measure parser opacity, scoped by D-2 and §12

The propagation engine's ceiling is the parser's coverage, and the parser's coverage may be
much lower than it looks. `parser.ts` demotes any leaf with element children to an opaque
`CustomPassthroughNode`, which means **the single most common real-world shape demotes**:

```
<mj-text data-cmp="brand/copy"><p>Hello <b>world</b></p></mj-text>   -> passthrough
```

That is not an edge case — it is the normal form of email copy. Two of the seven modeled block
types are `contentField:"text"` leaves whose realistic authored form contains inline HTML.
Whole-subtree collapse also applies to `mj-wrapper` (swallows the entire body — a template
wrapped in one parses to exactly **one** node), plus `mj-hero`, `mj-navbar`, `mj-group`,
`mj-table`, `mj-carousel`, `mj-accordion`, `mj-raw`.

The stamp survives inside `rawXml`, but it is **not addressable** — a tree-walking engine skips
it silently.

**What D-2 and §12 changed about this gate.** Under the reference model a component instance is a
*fixed-shape self-closing tag*, which substitutes correctly even inside an opaque wrapper — so
opacity no longer blocks propagation the way it blocked the copy model's tree walk. And §12 makes
propagation over *imported* templates a v1 non-goal, which removes the acute case entirely.

**So this is no longer a viability gate. It is an onboarding-cost measurement**, and that is still
worth an hour: take ten real agency templates, parse them, count modeled vs. opaque nodes. The
number tells you how much **componentization** work a migration costs (§11, "the cost the verdict
did not price") — which under §12 is the go-to-market motion, so its size is a business input, not
an engineering blocker.

**Run this as one afternoon with §11 experiment (b), not two.** They are the same ten real
templates and, per the verdict, the same computation: the attribute-variance count that decides
whether `ov-*` is viable *is* the measurement that sizes componentization. Carrying them as two
separate "ten real templates" exercises is duplicated work.

The old `~20% → fix parser.ts first` trigger is **withdrawn** — opacity does not gate the reference
engine. What survives is the `mj-wrapper` argument: a reference *inside* `mj-wrapper` is still
buried, so detect-and-report never empties (§10.1), and modelling `mj-wrapper` shrinks the residue
substantially for about the same code as special-casing it.

---

## 4. Phase 0 — make the foundation trustworthy (BLOCKING)

Nothing in §5–§8 may start before this lands. Propagation rewrites N live templates in one
unattended action; every defect below is multiplied by N and by every future run.

### 0.1 Make the test suite runnable, and make drizzle able to generate a correct migration
**Use only reproducible figures here.** In this tree today: the real suite (`tests/`) is
**193 tests, all passing** — 41 integration + 152 unit. `npx vitest run` reports **2 failed /
229 passed** because `.plan/scratch/` is inside vitest's include set and two lanes' probe files are
collected. Earlier drafts quoted "42 failed / 167 passed" and "222 passed / 2 failed"; **neither
reproduces from this tree** and both are withdrawn. What IS reproduced is the mechanism below, and
"41/41 integration passing" is corroborated.
`.gitignore:20` excludes `drizzle/migrations/meta/`, but drizzle's migrator requires
`meta/_journal.json`, so every DB-touching test dies in `makeTestDb`. `npm run db:migrate` fails
identically for any new deployer. Verified: `git ls-files drizzle/` returns only
`0000_initial.sql`.

**The part that would have silently broken the migration.** `meta/` currently contains
`_journal.json` and *nothing else*. A real `drizzle-kit generate` also writes
`meta/0000_snapshot.json`, and **the snapshot is the diff base**. Without it, `drizzle-kit
generate` does not emit a brands *diff* — it emits the entire schema as `0001`, re-`CREATE TABLE
templates` and all. The hand-reconstructed journal's `"when": 1700000000000` is the tell.
So step 1 of the migration plan would have produced the wrong migration, quietly.

- Drop the `.gitignore` rule and commit the drizzle meta dir (drizzle's own guidance; the
  `.gitignore` comment asserting otherwise is wrong).
- **Regenerate meta properly via drizzle-kit** — do not ship the hand-written journal.
- **Reproduced, not theorised.** Running `drizzle-kit generate` with SQL + journal but no snapshot
  emitted `0001_worthless_sabretooth.sql` — a **verbatim re-creation of both existing tables**,
  because with no snapshot drizzle diffs against an empty baseline. Applied to an existing DB it
  fails with *table already exists*. Controlled repro, only `meta/` varying:
  `0000_initial.sql` alone → "Can't find meta/_journal.json"; plus journal → migration OK.
- **Condition — the operator's call, not the planner's:** regenerating the baseline **discards
  migration history**, and the consequence is worse than "history lost". See the hazard below.

#### HAZARD — the regeneration stalls any database that already ran `0000`
Verified by reading drizzle's migrator, not from memory
(`node_modules/drizzle-orm/sqlite-core/dialect.cjs:681`):

```js
if (!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis) { …run… }
```

**Drizzle does not gate on the stored hash** — it writes the hash column and never reads it. It
compares the last applied migration's `created_at` against each journal entry's `when`. The
regeneration moved the tag and timestamp from `0000_initial` / `1700000000000` to
`0000_public_madelyne_pryor` / `1789327228942`. A deployed DB holds the old value, the new entry's
`when` is larger, so the migrator **re-runs 0000** → `CREATE TABLE settings` on an existing table →
throw → `ROLLBACK` (`:690`).

The database is not corrupted. It is **stuck** — and every brands migration behind it is stuck too.
**This passes CI, passes `makeTestDb`, and passes a clean clone. It fails only on the one database
with the real templates in it.**

**Options, cheapest first:**
1. **Confirm in writing that no deployed DB has ever run `0000_initial`** — then do nothing. As of
   this checkout there is no `data/` dir, no `*.db` outside `node_modules`, and no
   `/var/lib/email-designer/`, so nothing on this machine is at risk. A deployed instance elsewhere
   would be.
2. **Restore the `0000_initial` tag and `when` in the journal**, letting the regenerated SQL keep
   its content under the original name. Preserves the identity of the already-applied migration and
   touches no production data. **Recommended** — it is a journal edit, not a database edit, and it
   costs nothing even if option 1 turns out to be true.
3. Reconcile the deployed DB's `__drizzle_migrations` row to the new journal
   (`UPDATE … SET hash=<new>, created_at=1789327228942`), backed up first.

#### Two further facts from the same read, both load-bearing
- **All migration files run in ONE transaction**, not one each (`BEGIN` outside the loop at `:676`,
  `COMMIT` at `:689`). This settles the earlier open question: `PRAGMA foreign_keys = OFF` inside a
  migration is a no-op and **`defer_foreign_keys` is correct**. It also means `0001` does not commit
  before `0002` — ordering works via deferred checks at the single COMMIT. On balance good: a
  partially-applied brands migration is not a state anyone should have to recover from.
- **A migration whose `when` is lower than an applied one is skipped silently, forever** — only
  `MAX(created_at)` is consulted. **Never hand-edit a journal `when` downward.**

#### The drift fix shipped inside a metadata commit
The regeneration confirmed the `settings.default_mode` drift was real: the new SQL emits
`` `default_mode` text DEFAULT 'cli' `` where the deleted file said `'api'`. Correct outcome — but
it is a **behaviour change inside a commit whose heading is about journal metadata**. Say so in the
commit message, or it is invisible later.
- **`vitest.config.ts` has no `include` restriction**, so it collects `.plan/scratch/*.test.ts`.
  Delete or promote those probe files before any of this lands, or the suite's pass rate depends
  on scratch work.
- **Bonus: this doubles as the drift check.** Diff the freshly-generated SQL against the committed
  `0000_initial.sql`. Identical output means the `settings.default_mode` drift (§0.6) is a false
  alarm; any difference *is* the drift. One step settles both.
- `node_modules` did not exist: **nobody has ever run this suite here.** Every "currently passing"
  claim is unverified. Any pass-rate measured before this step describes the toolchain, not the code.
- `.nvmrc` says node 20; local is **v26** — six majors, and `better-sqlite3` is a native module
  with per-ABI prebuilds. Pin node in CI *and* in whatever runs this step, or you debug the
  toolchain and the schema simultaneously.

### 0.2 Fix entity double-escaping — this is live data corruption
`parser.ts:185` sets `processEntities:false`, so `&amp;` comes back as five literal characters.
`serializer.ts:17–29` then escapes `&` unconditionally, with no inverse. It compounds **once per save**, and the growth is **linear — +4 characters per generation**
(measured 9→13→17→21→25→29→33), never holding more than one literal `&`. Linear, not
exponential; the distinction matters because overstating it invites a skeptic to discount the
whole section:

```
gen 0: href="/x?a=1&amp;b=2"                    text: Tom &amp; Jerry
gen 1: href="/x?a=1&amp;amp;b=2"                text: Tom &amp;amp; Jerry
gen 4: href="/x?a=1&amp;amp;amp;amp;amp;b=2"
```

It hits attribute values (`escapeAttrValue`) and text content (`escapeText`, `serializer.ts:26`).
The trigger is not exotic: **every UTM tracking URL and every `&` in body copy.**

This is a bug today, independent of the pivot. It becomes far worse after it: one propagation
drives N templates a generation deeper at once, with no human touching them.

> ### CORRECTION — THE FIX PRESCRIBED HERE WAS WRONG, AND IT SHIPPED
> An earlier version said: *"keep only `"` → `&quot;` in attribute values, and **drop text escaping
> entirely** — proven stable across 5 cycles."* **That evidence was gathered on the SOURCE path
> only, and the prescription is a data-loss bug.**
>
> `node.text` is also written **programmatically**: `Canvas.tsx:1081` assigns raw browser
> `textContent` on every inline edit. With escaping removed:
>
> ```
> typed:      a < b
> serialized: <mj-text>a < b</mj-text>
> reparsed:   "a "          <- everything after `<` destroyed, then persisted
> ```
>
> and `</mj-text><script>` breaks the document structure outright, surviving into compiled HTML.
> **Strictly worse than the bug it replaced** — that one was linear (+4 chars/generation) and
> reversible; this is immediate and unrecoverable.

**The correct fix is IDEMPOTENT escaping, not absent escaping:**
- escape `&` **only when it does not already begin a character reference**:
  `/&(?!(?:[A-Za-z][A-Za-z0-9]{1,31}|#\d{1,7}|#[xX][0-9A-Fa-f]{1,6});)/g`
- escape `<` **always** — a raw `<` cannot occur in text parsed from source, so this fires only on
  the write path
- do **not** escape `>` — harmless, and escaping it rewrites every source document containing one
- attribute values: the same, plus `"`

Source values holding `&amp;` as five literal characters are untouched, so the fixpoint property
survives; programmatic values are escaped once and then stable. Verified over 6 generations in both
directions.

**Known limit, stated rather than hidden:** a user who *types* the literal characters `&amp;` reads
them back as that entity. Idempotent escaping cannot distinguish that from source. Resolve in favour
of source — documents carrying entities are universal, typing a literal entity into a WYSIWYG field
is vanishingly rare — and note the alternative (escape every `&`) is exactly the compounding bug
this section exists to fix.

> **Trap:** `headEdit.ts:59–61` double-escapes **deliberately**, asserted at
> `blocks.headEdit.test.ts:70`. Different contract, identical-looking code. A blanket
> "unify escaping" change will break it.

### 0.3 Restore a real round-trip gate — N-generation, not single
Current state: `assertRoundTrip` has **zero call sites**. The property tests its own header
references were never written. `fast-check` is in the repo but wired only to `headEdit` and
`attrsHelpers`, never the parser.

`blocks.passthrough.test.ts` is not a fidelity gate — it is a classification smoke test:
- 6 hand-picked literals, no generator, no shrinking
- every assertion is `normalizeWhitespace(out) === normalizeWhitespace(src)`, never byte equality
- **one generation only** — it never does parse→serialize→parse→serialize, which is precisely
  why the entity bug survived undetected
- no adversarial values: no entities, no URLs, no quotes, no CDATA, no unicode, no duplicate attrs
- `normalizeWhitespace` itself has **no test**, and its own comments document two off-by-one bugs
  already fixed in it — so every fidelity assertion routes through untested index math

The restored gate must assert **N-generation idempotency** (parse→serialize ×N is stable for
N≥4), include an adversarial value corpus, and cover `normalizeWhitespace` directly.

> **AND A SECOND REQUIRED CORPUS — this spec had the same blind spot the §0.2 fix did.**
> A gate written to the wording above **passed 400 property runs and could not see the data-loss
> bug**, because its corpus is *source-realistic by construction* — the generator contract even
> documented "a raw `<` cannot occur in well-formed source." True, and exactly why it was blind.
>
> **Add a corpus of values entering by ASSIGNMENT, not by parsing:** build the tree, set `node.text`
> and `attrs` directly with raw `<`, `&`, `"`, `>`, then assert lossless and idempotent.
> **Both escaping decisions in the serializer are justified entirely by the programmatic
> direction**, so a gate exercising only the source direction tests neither of them.

### 0.4 DEFER the dependency bumps — with a written trigger

An earlier draft of this plan said to take these first. **That was wrong for this deployment
shape**, and the reversal is deliberate:

> **CORRECTION to this section's reasoning.** It argued the CVEs need "attacker-controlled input
> that does not exist on a loopback single-user app." **For `mjml` that premise is false:
> LLM-authored MJML *is* attacker-influenced input**, and it flows straight into the compiler. The
> deferral is still correct — there is no fixed version to upgrade to — but the justification must
> be **"guarded at the input"**, not "not reachable".

**LIVE: arbitrary local file read through `/api/render`.** MJML resolves
`<mj-include path="..."/>` against the server filesystem, and its traversal fix
(CVE-2020-12827) is **incomplete through 4.18.0** — the pinned version, with no non-breaking
upgrade available. Confirmed reachable: relative traversal, absolute paths, and `type="css"` all
return file contents **in the HTTP 200 body**, rendered in the canvas and persisted on next save.
That reaches `.env` — which holds `ANTHROPIC_API_KEY` — and `~/.ssh/`.

The realistic chain is not a remote attacker (the origin guard blocks those). It is: **a user pastes
a third-party brief into the AI pane → Claude emits an `<mj-include/>` → the file comes back.**
This repo has **zero legitimate include usage**, so **refuse the tag at the input.** It costs
nothing and it is the guard the deferral now rests on.

- All three CVEs require attacker-controlled input that, **except for the case above**, does not
  exist on a loopback single-user app: `mjml` (html-minifier ReDoS, GHSA-pfq8-rq6v-vf5m), `fast-xml-parser`
  (GHSA-gh4j-gqv2-49f6), `ai` (GHSA-rwvc-j5jr-mgvh).
- `mjml 4→5` "may change render output", and the thing most likely to break is `stampPaths.ts` —
  738 LOC, untested, and it drives **canvas click selection**. That is an unbounded number of
  evenings repairing a tokenizer, bought with no security gain in the current shape.

**Trigger to take them: the week before the first external user**, i.e. before anything is exposed
beyond loopback. Written here so deferring is a decision with an expiry, not an omission.

**When the mjml bump is taken, it carries a mandatory paired task: re-verify canvas overlay
selection — and this is a HUMAN step, not an implementation task.** This project's own rules state
that browser testing is done by a developer, so **name an owner**. Written as an unowned task it
reads as automatable and gets skipped, which is precisely how a silent failure mode returns. `stampPaths.ts` is matched against mjml's exact rendered output, and its failure mode
is a graceful skip — so a v5 render change breaks click-selection **silently**. The bump is not
done until someone has clicked a block in each modelled type and confirmed the right element
selects. §0.5's `unstamped` return is the automated half of this, but note its limit (completeness,
not correctness): it cannot catch mis-targeting that still counts 3/3. Sequence the bump **after**
any `stampPaths` work, never during it, so there is one variable to blame.

### 0.5 Make stampPaths failures visible — three lines, highest value-per-line in the plan

`stampMjmlPaths` returns `{ html, stamped, expected, missing }`. `render.ts:69-77` spends `missing`
on a single `console.warn`, then returns `c.json({ html })` and **discards it**. So the browser is
not merely un-warned, it is **structurally blind** — it cannot know that blocks are unselectable.

Return `{ html, unstamped }` instead. The data is already computed; the change is three lines.

**Know its limit: this is a completeness check, not a correctness check.** The mis-stamping
measured in §11 returned `stamped=3/3 missing=[]` while the boxes landed on the wrong elements — so
`unstamped[]` cannot catch silent-and-plausible mis-targeting. It is still worth the three lines for
the registry-gap class and as the mjml 4→5 smoke alarm, but the dangerous failure mode needs the
structural fix (expand before stamping) plus a test. It
buys two things:
- a real affordance in the canvas (`⊘ 3 blocks can't be selected here`) instead of silence;
- **a smoke alarm for the deferred mjml 4→5 bump (§0.4)**, whose most likely casualty is exactly
  this file. Without it the failure surfaces as "selection mysteriously stopped working", reported
  weeks later, by a user.

Note the vocabulary: *unselectable-on-canvas* and *unreachable-by-propagation* are **one phenomenon
wearing two hats**. Use one word for it in the UI, or users learn they are unrelated problems.

### 0.6 Fix a documented-but-absent security control, and two drifted facts

**`README.md:13` claims a defence that does not exist:** "The local server binds to `127.0.0.1`
and rejects requests whose `Host`/`Origin` headers don't match the bound port (DNS-rebinding /
CSRF defence)." Verified absent — grepping `src/` for origin/host/csrf/cors returns only
`originalTagName` in the parser. The only middleware registered is rate limiting and a body-size
cap (`createWebApp.ts:62-63`).

With no auth by design, the live vector is **DNS rebinding**, which bypasses CORS entirely and
yields full read/write to every template. Plain CSRF is partly blunted by browser preflight
(DELETE and JSON POSTs), but that is the browser's policy doing the work, not the server's — and
it is exactly what the missing Host check was supposed to guarantee. Either implement the check or
delete the claim; a documented defence that does not exist is worse than an acknowledged gap,
because it stops anyone looking.

**`settings.default_mode` has drifted three ways across five locations** — `0000_initial.sql:4`
says `'api'`, `schema.ts:29` says `"cli"`, `settingsService.ts:10` says `cli`, the schema comment
says `api`, `OPERATIONS.md:18` says `api`. Existing rows default to `api`. Left alone, the next
`drizzle-kit generate` may bundle a `settings` rebuild into the brands migration. Fix in its own
commit, before any brands work.

**Settled empirically by the §0.1 regeneration: the regenerated file emits `'cli'`, confirming
`schema.ts` is the newer truth** and `0000_initial.sql` is the stale one.

**`SettingsService.get()` performs an INSERT on a read path** (`settingsService.ts:44-56`). Two
concurrent GETs both miss and both insert → primary-key violation raised out of a GET.
Unreachable at one user; reachable at five. Independent of the pivot — `settings-routes.test.ts`
survives the refactor untouched, which is the evidence it is a separate defect.

**`ALLOWED_MODELS` is defined twice, and the asymmetry is user-visible.**
`src/server/services/settingsService.ts:5` and `web/src/settings/Settings.tsx:5` hold the identical
literal with **no shared import and no test asserting they agree** — the same defect class as the
`default_mode` drift, which has already bitten once. The asymmetry is what makes it matter: the web
list is the only thing the user can pick from; the server list is the only thing that validates.
Add a model server-side and it never appears in the UI (silent, harmless). Add it UI-side and
`SettingsService.update` throws `UnknownModelError` — **the settings page offers a radio button the
server rejects**, with nothing the user can do about it. The wiring for the fix already exists:
`web/vite.config.ts` and `web/tsconfig.json` alias `@shared` → `src/shared`, which is how the web
bundle imports the block registry today. And it is cheaper than it looks — **the server's copy is
already `export`ed**, so the duplication is not load-bearing; the web file simply declares its own.
A pure oversight, not a structural constraint. The fix is **one import swap plus a test asserting
the two agree**, since nothing has ever caught them diverging. Do it **before** brands work touches
settings scoping.

**`package.json:5` says "Hosted multi-tenant MJML email designer."** Brands are **not**
multi-tenancy — no auth, no users, the deployer still owns every brand in the file. Fix the
description in the same commit, or someone will eventually read brand isolation as a security
boundary. It is not one: the FKs in the schema are integrity constraints, not access control.


---

## 5. Component identity and the override model

> **SUPERSEDED IN PART by D-2 (§11).** The verdict is the reference model, which deletes
> three-way merge, the locked/default/slot trio, unknown-base degradation, the `data-cmp-h`
> tripwire and conflict resolution. What survives: the charset constraint below (it now applies to
> `ov-*` values and the `component-id` slug), and the reasoning about why out-of-band provenance
> is impossible. Read this section as history plus two live constraints.

Provenance **cannot** live out-of-band: `schema.ts` persists a single `mjml text` column, so
anything not expressible as MJML text dies on the next parse, and `BlockNode.id` is worse than a per-parse counter — `__id` is a **module-global that is
never reset** (`parser.ts:37-41`; three references, no reset), so two parses of an identical
document in one process yield disjoint ids (`n_3,n_2,n_1` then `n_6,n_5,n_4`). Useless as a
stable key. So the stamp carries its own provenance.

> **A coupling worth flagging rather than hiding.** `allowedAttrs` is documented at
> `registry.ts:20-25` as a **UI form view filter, explicitly not a validation gate** — and the
> derivation above makes it one. Widening it for form reasons will then silently widen what
> instances may override. The trade is probably right, since *"what you can change on a block"* and
> *"what you can override on an instance"* being the same set is a good invariant. But it is a
> **load-bearing reuse of something whose own comment says it is not load-bearing**, and that is the
> kind of thing that surprises someone two years out.
>
> **Concretely: adding an attribute to get a form field is now a permission change.** The person most
> likely to do that is a UI developer adding a field — and the comment sitting there will reassure
> them it is safe. **Fix it at the source: that comment changes in the same commit**, and the server
> derives from the same constant.
>
> Note the symmetry — `registry.ts` being genuinely shared by both sides is the *counterexample* to
> the `ALLOWED_MODELS` duplication, and precisely why that one is a bug.

**Two comments that will actively mislead whoever reads them next, both worth a one-line fix:**
`render.ts:118` still says the cache key is source-only (it is expanded-only now), and
`registry.ts:20-25` still says `allowedAttrs` is not a validation gate (it is one now).

**Hard constraint on stamp values — identity attrs must be `[A-Za-z0-9._/-]` only** (slug plus
integer, plus comma for lists). This is not stylistic: the §0.2 double-escaping bug corrupts any
value containing `&`, `<` or `"` cumulatively on every save. Demonstrated —
`data-cmp-hash="a&amp;b&lt;c"` becomes `"a&amp;amp;b&amp;lt;c"` and degrades further each cycle.
**Consequence: `data-cmp-lock='{"attrs":[...]}'` is not viable as an attribute at all** — JSON
carries quotes. Any per-instance lock state richer than a slug list belongs in a DB column, not
the MJML. Constraining the charset sidesteps the serializer bug rather than depending on the §0.2
fix landing correctly.

**Three valued attrs:** `data-cmp` (component), `data-cmp-v` (the **merge base**, not a currency
marker), `data-cmp-i` (instance id). Always valued — **valueless attributes are silently dropped**
by the parser, so a bare `data-cmp-locked` would vanish.

**Overrides: declared per-attribute ownership (`locked` / `default` / `slot`) plus a three-way
merge against the stamped base version.** Ownership is a **component-level** fact, held on the
component definition — not stamped per instance, which would create N independently-editable
copies that go stale the moment the component gains an owned attribute. A fourth stamp,
`data-cmp-h`, is adopted as a self-contained tripwire: it detects local modification *without*
needing the base version, closing the `unknown-base` gap.

**`textPolicy` defaults to `"slot"`, not `"default"` — this default is load-bearing.** Three-way
merge on text is safe only when a base exists. At `unknown-base` or first adoption it degrades to
take-component, which **rewrites every button label in the brand**. Unrecoverable across 40
templates, and exactly the failure that ends a customer relationship. Two-way replace and a stored override list were both
considered and rejected with reasons. Container components carry
`childPolicy: "owned" | "slot"`; real tree merge is refused in v1 rather than half-implemented.

`stampPaths.ts` teaches the opposite lesson from reuse — it recomputes positional paths on every
render precisely because persisting them is wrong.

### Where this is a guess, not a finding
The override model assumes instance edits are intentional and durable. If the real agency workflow
is "the brand file is law, template edits are mistakes", then `locked`-everything is correct and
this machinery is pure overhead. **No evidence either way exists, in the codebase or the market
research.** Ship with a handful of real components and watch whether users hit conflicts or resent
them.

Declared ownership also front-loads a configuration tax — somebody must mark every attribute of
every component before the feature does anything. Sane defaults (`default` for anything unlisted)
make an unconfigured component merge rather than clobber, which is safe but feels weak on first
use. **Worth prototyping second:** infer the initial policy from observed variance across existing
instances — attrs that vary become `slot`, attrs identical everywhere become `locked`.

---

## 6. Propagation engine and dry-run diff

> **SUPERSEDED IN PART by D-2 (§11).** Under the reference model the diff is
> `expand(template, pins)` vs `expand(template, bumped)`. What survives: the measured performance
> numbers, the "blocked must not become furniture" point, and detect-and-report for opaque nodes.

Full design: `.plan/propagation.md` (795 lines, with runnable proofs in `.plan/scratch/`).

- **The plan IS the write.** Apply writes the approved `afterMjml` and re-merges nothing —
  eliminating the class of bug where preview and apply disagree.
- **Granularity:** per-attribute -> per-instance -> per-template.
- **Failure:** per-template atomic, batch non-atomic, argued explicitly. The plan phase
  pre-validates everything (parse + serialize + compile), so apply-time failure reduces to
  stale-version and DB error. Durable run records carrying `prevMjml` make partial application
  recoverable; systemic errors abort by error class.
- **Drift:** six kinds, including a locked-attr fingerprint detector for stamps deleted outright.
  The metric that matters is instances *located* vs. *propagated*.
- **Performance, measured not estimated:** parse+serialize is 2.15ms at 18KB -> **~1s for 480
  templates**. `mjml2html` is 14.6ms, **7x more expensive** -> 7s for the same corpus. So
  validate-by-compile only on changed templates. The approach breaks around **2,500 templates**;
  the denormalized-index fix is named with a trigger rather than built now.

### The run-1 reformat problem — largely dissolved by D-2
Under the reference model neither side of the diff is re-serialized: a revision bump changes one
attribute. The residual case is narrow — **detach**, and templates that were hand-edited — where a
re-serialize genuinely happens. See §10.2 for the measured, conditional version of this risk; the
universal "whole-file reformat" framing was wrong and is withdrawn.

### "Blocked" must not become furniture
If every run reports the same three permanently-blocked templates, the blocked count stops being
read and a genuinely new blocker hides inside it. Blocked items need an acknowledged state so the
plan can distinguish "blocked, known" from "blocked, new".

---

## 7. Schema, migration and API scoping

> **DEFERRED per §12.** This is designed and current under D-2, but the build order puts the
> brand-scoping refactor *after* one agency has run on the component system. It is the largest
> block of work in the plan and serves a multi-brand dimension a single hand-run migration does not
> need. Read it as the plan for weeks 6+, not for week 2.

Full designs: `.plan/schema.md` and `.plan/api.md` (816 lines, with a **72-entry single-user
assumption inventory** by file:line).

### The cost is scoping, not DDL
The DDL is a couple of hours. The cost is that `TemplateService.list()` is an unscoped
`SELECT … ORDER BY updated_at DESC`, and `get`/`update`/`delete` take a bare id with no namespace
to check it against. `templateService.ts:104` — `delete(id)` — has the worst blast radius.

**The danger is not the refactor's size. It is that "forgot to scope" produces no type error** —
just a 200 returning another brand's template.

**Mitigation, adopted: make scope non-optional in the type.** Construct the service per-brand
(`new TemplateService(db, brandId)`) so there is no unscoped method left to call by accident — a
constructor error instead of a silent cross-brand read.

Other load-bearing entries from the inventory:
- `templateService.ts:35` — `constructor(db: DbHandle)`, no method takes a scope. That one line is
  the shape of the whole problem.
- `server/types.ts:6` — `export interface AppVariables {}`. Nothing is carried per-request, so
  every handler re-derives everything from path params.
- `templates.ts:24` / `query.ts:36-37` — services constructed **once at factory time**, closing
  over a non-transactional handle. That is the missing seam for both scoping and transactions.

### Path scoping, not a header
`/api/brands/:brandId/templates/...`. The decisive argument is two tabs: a header-sourced "current
brand" is per-browser, not per-tab, so switching brand in tab B corrupts tab A's autosave — a
singleton with extra steps. It also survives contact with the client: `web/src/api/templates.ts`
are pure functions taking identifiers as arguments, so adding `brandId` breaks every call site
**loudly**. A header needs an interceptor in `client.ts` (explicitly interceptor-free) and every
call site keeps compiling while being silently wrong.

### Concurrency
`templateService.update()` is already correct — SQL-side `version + 1`, single conditional
statement, `.returning()`, disambiguating SELECT. Keep it, add the brand term. The real finding is
the tab scenario: `useTemplate.ts:306-312` **drops the pending edit on 409** — its own comment says
"pending edit was dropped". Propagation makes a third party a writer, turning a theoretical
data-loss path into a routine one. Mitigations: 409 gains `reason` + `currentVersion`; route token
propagation through `<mj-attributes>` so bodies stay byte-identical.

### Transactions
**Zero uses today.** Three non-negotiables: the better-sqlite3 callback is **synchronous** — an
`async` one commits before the awaited work runs, which is silent corruption, so **LLM calls must
precede the transaction**; use `{ behavior: "immediate" }`; and the service-construction seam above
must be fixed first or there is no handle to pass.

### Migration
`0001` additive + a `'default'` brand (literal id, not `randomUUID`). `0002` is a **full table
rebuild** for `templates.brand_id` — SQLite cannot `ADD COLUMN` a `NOT NULL` + `REFERENCES` column.
Two silent traps: drizzle-kit emits `PRAGMA foreign_keys=OFF`, which is a **no-op inside a
transaction** (use `defer_foreign_keys`), and `DROP TABLE` takes the indexes with it. **Not
reversible in place** — the rollback is a file backup, stated plainly rather than shipping an
untested down-migration.

### Settings stays a singleton
`defaultModel`/`defaultMode` are deployment facts (env key, `claude` on PATH) and `scripts/setup.mjs`
writes them before any brand exists. **Do not add `active_brand_id`** — that is URL state, or two
tabs fight over one row.

### Resolved by D-2: reference
The foundational question of this section is decided — **reference** (§11 D-2). The resulting table
set is `components` + `component_revisions` + `component_usages`. The earlier objection that
`components (id, brand_id, name, mjml, version)` "cannot support pinning" is answered by
**immutable revisions**, not by bolting a history table onto a head row: a pin names a revision that
can never change, which is also what makes the `(component, revision)` graph a DAG by construction.

Per D-3, `brands.slug` and `components.key` are immutable identity; `components.id` stays a UUID PK
with the slug as a unique natural key resolved at extraction.

**The render cache key must include the brand — a defect the brand-head design introduces.**
`getCached` matches on `e.source === source`, which is sound today: pins are immutable and `ov-*`
lives in the source, so identical source means identical output. **Once the brand head merges at
render time that stops holding** — editing a brand token changes `brands.head_mjml` and *no
template's source*, so every cached entry stays stale and the designer watches their token edit do
nothing. Key on **`source + brandId + brands.version`**: the optimistic-lock column already exists
on `brands` and bumps on every brand write, so it is the correct invalidation token at no new cost.

**The fix may be cheaper than a composite key — and the rule is narrower than either.** `getCached`
now keys on the **expanded** MJML rather than `source` (it changed when expand-before-stamp landed),
so the key is **correct by construction as long as the brand head is merged into the string that
becomes the key**.

> **THE RULE, now proven by a real bug rather than argued: any cache downstream of expansion must
> key on POST-EXPANSION bytes.** The render cache was keyed on the **stored source**. Under the
> reference model the same source expands differently depending on what the component store holds —
> so after a revision changed, `/api/render` served the **previous component's HTML**.
> **Propagation would have appeared to do nothing at all, with no error.** Caught by the
> implementer's own test and re-keyed on the expanded MJML, which is the real input to compilation
> and self-invalidates when a pin or revision moves.

> **Content keys self-invalidate; composite keys rely on remembering to bump every contributing
> column, forever, including ones added later.** Stronger form: the expanded, head-merged MJML **is**
> the complete input to `mjml2html` + `stampMjmlPaths`, and nothing else varies within a process
> lifetime — an mjml bump or stamper change arrives with a deploy, which empties an in-memory cache
> anyway. So a content key is **provably** complete where a composite key can only be **currently**
> complete.

**Placement, decided: merge before the key — and enforce it with a type, not a convention.** Have
the preparation step return a branded `PreparedMjml` that `getCached`/`setCached` alone accept. That
makes "merged before keyed" a **compile error** rather than something a reviewer has to notice.

> **A reflex worth naming, this being its third instance in this plan** (after removing `slug` from
> the update DTO and constructing `TemplateService` per-brand): **when a rule must hold forever,
> spend the type rather than the comment.**

**Honest cost, and it lands on the hottest path in the product:** expansion and the head merge now
run on **every** request including cache hits, and the canvas re-renders on every debounced change —
so this sits under the most frequent call there is. **Watch it; do not pre-optimise.** And if it
does bite, the fix is a **memo on the preparation step**, not a retreat to composite keys.

So hold the narrow rule rather than the fix: *whatever the brand head touches must be inside the
cache key's input.* If the merge happens **before** `getCached`, nothing further is needed. If it
happens **after** — injected into compiled HTML — the content key silently stops covering it and the
composite key becomes necessary. **Decide which, because only one of those failure modes is
detectable.**

Worth flagging because **the symptom lands in the UI lane first**: *"my brand colour didn't apply,
but it works after a restart"* gets diagnosed as a browser cache for about a week before anyone
looks at the server. (Also stale and worth fixing: the comment at the stamp call still says "cache
key remains source-only" — it is expanded-only now, and it is the kind of comment someone will
trust.)

**`component_revisions` carries `root_tag`** — not to prevent a silent drop (the falsified
hypothesis above removed that justification) but **to stop broken nesting shipping**. The canvas
cannot judge whether an instance is legal in a given slot, because `allowedChildren` keys on block
*type* and every instance is `mj-component` whatever it expands to. Derived at publish and
guaranteed single by the single-root invariant, so **drop legality becomes a local check with no
resolve.**

**It also closes a gap nobody had designed: how a component gets *placed* from the palette.**
`resolveInsertion` keys every decision on `BlockType`, and every instance is `mj-component` whatever
it expands to — so a footer rooted at `mj-section` and a badge rooted at `mj-image` need **opposite**
insertion behaviour and are indistinguishable to it. With `rootTag` on the palette payload,
`resolveInsertion` reads it wherever it reads `type` and everything downstream works unchanged.
(Test correction that falls out: `web.IconRail.test.tsx` asserts `groups.length === 2`, so a
Components group breaks it — it is *not* in the unaffected set.)

## 8. UI

> **DEFERRED per §12.** The weeks 2–4 vertical slice prints its diff **to the terminal**. This
> section is what gets built once an agency asks to run the tool themselves — funded, and to a
> spec written by a customer rather than guessed here.

Full design: `.plan/ui.md` (954 lines, with ASCII sketches for the library grid, component health,
and the three-pane propagation diff). File impact: **24 created, 11 modified, 0 deleted**, plus a
per-file test verdict — three components' new props are specced optional so existing assertions
pass untouched.

### The largest saving in the whole plan
**The canvas is already document-source-agnostic.** `Canvas.tsx` reads only three contexts and MJML
bytes, so the component editor is a **provider swap, not a second editor**. No parallel editing
surface needs building.

**Qualified twice, and the second retraction is mine to own.** Experiment (a)'s failure (below)
means the overlay needs expanded-tree addressing. And "the canvas is unchanged" is **only true of
the component editor** — it is *not* a no-op for the **template** editor once instances exist:
`OverlayTree` hit-testing, `Canvas.selectByPathKey`, `handleOverlayDoubleClick`, `handleDragEnd` and
`InlineTextEditor` all move. The provider-swap saving is real but smaller than first claimed.

### The overlay, which is the largest thing D-2 creates
Stamp the **expanded** source, and have `/api/render` return the path map alongside it:
`{ expandedPath, storedPath | null, instancePath | null, overridable | null }`.

**The rule: a click inside a component expansion selects the whole instance**, not the inner node —
the inner node has no stored identity, and pretending otherwise hands the user a selection they
cannot act on. Gesture ladder: click → instance; double-click → open the component in the library;
drag → reorder the instance, with drops *into* an expansion rejected; Backspace → delete the
instance. Interiors get a visually distinct non-editable treatment, so "why can't I grab this" is
answered before it is asked. Refinement: where the clicked inner node maps to an `overridable` key,
scroll to and highlight that field — click the button inside the footer and the footer selects while
"Button label" lights up.

**Three failure modes that look identical to a user, and only one is currently detected:**

| Failure | Symptom | Detected by |
|---|---|---|
| block not stamped | cannot be selected | `unstamped[]` → the chip (§0.5) |
| path mis-mapped | selecting picks the **wrong** block | **nothing at runtime — test only** |
| **component not expanded** | **the block is not there at all** | **nothing yet** |

The third is the worst: the other two make editing awkward, this one **silently ships an email with
a missing footer**. It is also the **third silent-success-with-200 in this codebase**, which is a
pattern rather than three coincidences.

**A fourth row was hypothesised and falsified — do not add one.** The candidate was a component
that expands fine but lands where MJML rejects it (`mj-section` inside `mj-column`), which
throw-on-survivor would miss because nothing survives unexpanded. Probed three ways: **MJML renders
the content anyway** in all of them, reporting the error but emitting the markup. So only
*unregistered* elements vanish; misplaced-but-registered ones render with probably-broken table
nesting — a **quality** failure, not data loss. The table stays at three rows.

**What checking it turned up instead is worse, and predates this entire project.**
`render.ts:60-62` types the compile result as `{ html: string; errors?: unknown[] }` — **someone
knew the field was there** — and then reads only `.html`. **Every MJML validation error this product
has ever produced has been discarded, on every render**, component-related or not. That is the **fourth**
silent-success-with-200 found in this codebase, and it is shipping today in the builder.

> **The generalizable rule, which is worth more than the four instances:** *when a server path can
> partially fail, check whether the failure has a route to the browser or stops at a log line.*
> **Three of the four stopped at a log line.**

So the render contract should be **broader** than the component case: add **`mjmlErrors`** —
free, since it is already in the return value being thrown away — as a *separate* field from
`expansionErrors[]`, because the weight distinction below is right and must survive. Expect this to
make `CanvasHealthChips` **three tiers rather than two**: existing templates may light up with
advisory errors on first deploy.

So the render contract needs **`expansionErrors[]` alongside `unstamped[]`** — and the two must be
treated *differently*, deliberately: the unstamped chip is informational and dismissible because
editing still works; the expansion banner is heavier and persists, because **what is on screen is
not the email**. Keep all of them in one `CanvasHealthChips` component so the distinctions live in one place instead
of drifting apart — **three tiers, ordered by consequence to the delivered email rather than by
proximity to the click**:

| Tier | Signal | Treatment | Why |
|---|---|---|---|
| 1 | `expansionErrors` (**two feeds**) | persistent, **not dismissible** | what is on screen is not the email |
| 2 | `mjmlErrors` | dismissible, collapsed | quality problem, email is still the email |
| 3 | `unstamped` | quiet chip | editor limitation only; rendering is fine |

> **CACHE TRAP — the tier-1 banner would vanish on the second render.** `render.ts` returns
> `unstamped` on **both** the cache-miss and cache-hit paths; whoever implemented it got that right.
> But the natural way to add `mjmlErrors`/`expansionErrors` is to touch the **miss** path, where the
> compile happens — and forget the **hit** path, where there is no compile to read them from.
> That fails in the way that hurts most: tier 1 is specified as persistent and non-dismissible
> *because what is on screen is not the email*, and it would disappear the moment the same source
> renders twice. **A guarantee that evaporates on a cache hit is worse than no guarantee, because
> the first render taught the user to trust it.**

**CORRECTED CONTRACT — `expansionErrors[]` on the 200 path can never fill, and must not be specced.**
`expand()` throwing already returns **422 with no HTML**, so expansion is **all-or-nothing**: a 200
can never carry an expansion error. An `expansionErrors` field on the success path would be a
permanently empty array — the kind of field someone later deletes, or repurposes into something it
was never for.

```
200 -> { html, unstamped, mjmlErrors }
422 -> { error, instancePath?, reason }
```

**But do not apply that correction one step too far — the tier-1 SCREEN is still reachable on a
200.** Deleting the field and deleting the banner are one short step apart, and the banner is the
backstop:

| Path | Reaches | Response | Screen |
|---|---|---|---|
| expander **recognises** a reference, cannot resolve it | throws | **422** | canvas error state |
| expander **never recognises** it | mjml | **200**, tag dropped | **tier-1 banner** |

Row two is the class the guard is structurally blind to. It arrives via `mjmlErrors`, which makes
**`tagName` load-bearing rather than incidental metadata** — it is the entire classifier between
*"content is missing"* and *"advisory"*.

> **One gap to close in that classifier, flagged rather than assumed away.**
> `mjmlErrors.some(e => e.tagName === "mj-component")` catches an unrecognised *well-spelled*
> reference — but **not the measured typo case**, where the tag is `mj-compnent` and the `tagName`
> is therefore not `"mj-component"`. Since any unregistered element means content was silently
> dropped, the classifier should be **the broader "element does not exist / is not registered"
> class**, not an equality check on one tag name. Otherwise the exact failure this backstop was
> built for lands in the advisory tier.
>
> (`tagName` itself is confirmed present and exact by probe, at body level and nested inside a
> column — so the classifier needs **no string matching on message text**. The gap above is about
> *which* errors it must match, not about the field being reliable.)

**Send `{ message, tagName }` to the browser — never `result.errors` itself.** The natural
implementation is `errors: result.errors`, and it is wrong twice:

- **`formattedMessage` leaks the server's absolute filesystem path.** MJML interpolates its working
  directory when no `filePath` is supplied, so the deployer's full path would reach every browser.
  Low severity for a localhost deployer; **not nothing for the reverse-proxied and private-network
  deployments `OPERATIONS.md:126-134` actually describes** — verified, not assumed — and gratuitous
  either way, since the UI needs none of it.
- **`line` is a line number in the *expanded* document.** It has no correspondence to the stored
  template the user is looking at, so it points confidently at the wrong place — **worse than
  omitting it, because a wrong line number gets trusted.** Same reasoning that keeps byte offsets
  server-side. Include `line` only if someone does the translation.

The banner is not redundant with the 422 — **it is the UI for exactly the case the 422 cannot see**,
and the measured example is the typo'd tag: `<mj-compnent …>` is not the string the guard scans for,
so no 422 is raised and only `result.errors` reports it. The two mechanisms fail independently,
which is the only property that makes a backstop worth having — *a second check that fails whenever
the first does is decoration*.

Note that a four-field contract is what invited the two screens to be collapsed into one in the
first place: **one payload was read, correctly, as implying one surface.**

`Canvas` currently treats a 422 like any other render failure, which wastes the loudness the server
went to the trouble of producing.

**The guard must fire on EXPORT, not only on render — and this outranks everything else on the UI
surface.** A render that 500s is a visible, recoverable annoyance. **An export that silently omits a
footer leaves the building.** Bulk expanded-MJML export is a week-one item, so the guard has to
exist before that path does. Small trap: `.export-btn` and `.export-error` already sit unused in
`styles.css`, so the CSS will suggest the feature is half-built when it has not been started.

> **THE REFLEX WORTH KEEPING, and the most transferable thing this plan produced.** Three separate
> measurements turned out to have the same shape — the experiment (b) override distribution, the
> rich-`mj-text` frequency, and the `mjmlErrors` corpus volume. Each takes about ten minutes and each
> decides between a chip and a workstream. And in **all three**, a design had been written that
> assumed a moderate number **without anyone noticing they were assuming it**. The assumption is
> invisible, it is always convenient, and every one of the three was caught by somebody asking
> **"how many?"** — not by anyone reasoning harder about the design.
>
> **The pattern has two axes, and the second is worth budgeting for separately.** One lane assumed a
> **quantity**, three times. Another assumed a **mechanism** — the `ov-text` "designated text node"
> phrase *needed* one to make sense, so it read as though one existed. Both convenient, both
> invisible, and **neither was caught by being careful**: one was caught by *counting*, the other by
> *re-reading prose against its own worked example*.
>
> **"Be more careful" is not a third check.** It is the reflex that would otherwise absorb both
> lessons and act on neither.
>
> A third instance of the same shape, caught in this document: deleting `expansionErrors` was
> justified as *"expansion errors can't happen on a 200"* — **true of the field, false of the
> screen**, and one step from removing the backstop. Same failure as "designated text node".
>
> **The class, named precisely, because it is the hardest of the three to catch:** *a sentence that
> is correct about its subject and reads as correct about its neighbours.* It survives review
> **precisely because it is true** — the reader extends it at no cost to its accuracy, and there is
> nothing false in it to notice. Counting does not catch this one and neither does care; only
> checking the sentence against the thing it is *not* about does.

**Size tier 2 before designing it** — the same move that worked for Class B. Run the error stream
over the existing corpus and **count first**. Three errors total means ship it quietly; four hundred
means tier 2 is the **wrong design** and needs aggregation or opt-in, not a dismissible chip with
better copy. The compiler and the corpus are both to hand, so this is the same ten-minute shape as
the `mj-text` count — and nobody should write the copy before knowing which artefact they are
building.

**Tier 2's first deploy is a migration event, not a feature launch.** Switching on an error stream
that has been discarded since the beginning means templates that have "always worked" light up the
moment it ships. Unframed, that reads as *"the new version broke my templates."* The copy has to
carry the history, and **it must not ship alongside anything that changes rendering** — or the two
become indistinguishable to the user.

**The mis-mapping row is the one behaviour in the plan with no runtime signal at all** — caught by a
test or not at all. `web.Canvas.pathMapping.spec.tsx` is item 0 on the cut list, not a
nice-to-have.

#### The expander must return provenance, not a string — decide this before the module is written
The schema design specs `componentExpander.ts` as expand + memoise + depth cap + `ov-*` application
+ throw-on-survivor, **returning MJML**. The overlay above needs, for every stamped path in the
*expanded* tree: which stored `<mj-component/>` node it came from, which instance, and which `ov-*`
key an inner node binds to.

**That information exists only inside the expander at the moment of substitution, and is
unrecoverable from the expanded string afterwards.** You cannot reconstruct "this `<mj-text>` came
from the footer component's headline slot" after the fact. If the expander discards it, the overlay
has no foundation and a click cannot map to anything the user can act on.

```ts
interface ExpansionRegion {
  start: number; end: number;          // byte range in the expanded MJML
  componentId: string; revision: number;
  instancePath: string;                // index path of <mj-component/> in the STORED tree
  overridable: Map<string, string>;    // inner path (relative) -> ov-* key
}
interface ExpansionResult { mjml: string; regions: ExpansionRegion[] }
```

The expander already computes all of it — it knows where it substituted, and
`ov-slot-headline` → `<mj-text data-slot="headline">` is a binding it performs. It just has to stop
throwing it away. **This is a return-type change to a module that does not exist yet: free today,
expensive the moment it does.**

> **CORRECTION.** An earlier draft said the offsets "need no invention — `parser.ts` already carries
> `el.start`/`el.end`." That holds for the **expander** (it scans strings) and **not for the
> stamper**, which walks a tree that has forgotten them. Checked: `BlockNode` is
> `{id, type, attrs, children?, text?}`, `PlanEntry` is
> `{pathKey, type, isContainer, childrenStart?, childrenEnd?}`, `StampResult` is
> `{html, stamped, expected, missing}` — **none carries source offsets**. `parser.ts` computes
> `el.start`/`el.end` as **locals** inside `readElement`/`parseElement`, uses them to slice
> `rawXml`, and drops them.
>
> **The trap that produced the error:** `PlanEntry.childrenStart` / `childrenEnd` *look* like source
> offsets and are **indices into the plan array**. Anyone reaching for offsets will find these
> first.

**Two boundaries, not one — and they are either end of a join, not competing shapes.** The
expander's natural output is **byte-ranged** (substitution happens at offsets); the overlay's
natural input is **path-keyed** (that is what stamping produces). The join belongs on the server,
between them: `ExpansionRegion[]` out of `componentExpander.ts`, and
`Record<path, StampedPathInfo>` out of `/api/render`.

**The join must be path-to-path, not offset-to-offset — it currently has nothing to join on.**
Do **not** fix this by adding offsets to `BlockNode`: they go stale on the first mutation, and they
would land in the core type the round-trip gate (§0.3) is about to start asserting on. The fix that
needs no offsets anywhere is **one added field on the region: `expandedPathRange: [number, number]`**
— bookkeeping the expander already does, since the usage extractor returns `instancePath` and the
expander knows which stored node it replaced and how many top-level nodes it emitted.

**Keep `expandedPathRange` a range even though it is always `[n, n]`.** The single-root invariant
makes stored↔expanded indices 1:1, so any stored path is *literally the same path* in the expanded
tree and resolution is "walk up until you hit an instance root" — no search, no fuzzy matching,
auditable by inspection. Someone will notice the two numbers are always equal and propose a scalar.
**Refuse:** as a scalar, relaxing single-root later becomes a breaking change to a boundary with two
implementations; as a range it degrades to bookkeeping. This is exactly the kind of invariant traded
away by someone optimising elsewhere, and **the overlay breaks first.**

> ### Expansion is a coordinate-space boundary
> **Three findings, arrived at by three unrelated routes, are one rule.** Byte offsets, overlay
> paths and MJML error line numbers are all **values computed against the expanded document, in a
> coordinate space the browser does not have**:
>
> | Value | Found by | Failure if untranslated |
> |---|---|---|
> | byte offsets | checking the join | arithmetic on meaningless numbers |
> | overlay paths | writing the panel | clicks select the wrong block |
> | error `line` | probing the error object | points confidently at the wrong line |
>
> **Nothing crossing that boundary goes untranslated — it is translated, or it stays server-side.**
>
> **The operational clause: a wrong coordinate is worse than an absent one — an absent one is
> ignored, a wrong one is trusted.**
>
> Worth stating once as a rule rather than three times as precedents: these were found by a join
> check, a panel spec and an error probe. **A fourth will arrive by a fourth route, and a rule
> catches it where three precedents do not.** Note that `line` is the most dangerous of the three,
> because a line number on an error object reads as *obviously useful* — and a wrong one is worse
> than none, since it gets trusted.

**Byte offsets must not reach the browser.** The client never sees the expanded MJML, so offsets are
meaningless there and would only invite someone to attempt arithmetic on them — and with a
path-to-path join they now have no reason to travel at all.

**`instancePath` elements need a sibling index — `id@rev#n`.** Without it, **two instances of the
same component produce identical chains**, and "which instance did I click?" — the exact question
the field exists to answer — is unanswerable.

**The survivor guard must use a scanner with a strictly more permissive failure mode than the
substitution scanner.** Sharing one scanner makes the guard a **tautology on the expander's own
fixpoint**: it can only find what the substituter already recognised, which is precisely the set
that never survives.

**`instancePath` must be a chain, not a string — components nest.** The schema permits
`<mj-component/>` inside a component body with a depth cap of 5, so one expanded path can sit inside
several regions at once. Click inside a footer that contains a button component: footer, or button?
**The payload carries the chain and the UI owns the decision** — the endpoint must not bake it in.
Same reasoning as the byte-offset constraint above.

**Resolved: outermost wins for both selection *and* `overridable`; the chain exists to explain, not
to choose.** The governing rule is that a node with no stored identity in *this document* cannot be
selected, because any selection of it is a promise the system cannot keep. A Button nested inside a
Footer's revision **has no `<mj-component/>` tag in this template** — it lives in the Footer's
revision, in the library — so it cannot be detached, re-pinned or overridden from here.

That same fact settles `overridable` in the *opposite* direction from the intuitive one: this
template contains exactly one `<mj-component/>` tag per region, so **only its `ov-*` keys are
settable here.** Innermost-wins would highlight a field that does not exist in the panel — the
promise-we-cannot-keep failure, reintroduced one level down.

**Sharper still: innermost-vs-outermost is a false choice.** If the only `<mj-component/>` tag in
the template is the outer one, nested regions contribute **no keys at all** — there is nothing to
resolve between regions, and `overridable` is simply "read the outermost region's map."

> **One sentence that prevents a future break: do not partition the `overridable` map per region.**
> Building it per region is the natural implementation, and it works today. But if below-root
> `ov-*` resolves yes via declared slots (§11), a Footer could declare a slot reaching a node
> physically inside its nested Button — an innerPath in one region mapping to a key owned by an
> outer one. A single flat map survives that for free; a partitioned one silently cannot express it.

So the chain is carried **for explanation**: the panel renders it as context — *"Button, inside your
Footer"* — which answers "why can't I edit this button?" far better than silence. And because the
chain is there, the restriction becomes a **fork rather than a wall**: that label can carry both
routes out — *edit the component*, or *detach*.

**Test it explicitly.** This is *correct by construction in a one-level fixture* and only wrong once
someone puts a button component inside a footer — combined with §0.3 (mis-mapping presents as
perfect counts and wrong boxes), it stays the one behaviour in the plan with **no runtime signal at
all**.

#### Delete `css-class` injection rather than fixing it
The schema design still specifies the overlay mechanism the probes refuted — `mj-component` as a
stampable leaf matched in rendered HTML, anchored on `css-class` injection against the **stored**
source. Both halves fail measurement (§11): `css-class` does not reach the stamped element for
`mj-section`, and stamping stored source against expanded HTML mis-stamps **silently** at
`stamped=3/3 missing=[]`. Stamping the expanded source measures clean (`6/6 missing=[]`) and needs
**no HTML-side anchor at all**, so `css-class` injection should be **dropped, not repaired**. One detail worth keeping as an
argument against reviving it later: MJML emits a *second*, `-outlook`-suffixed copy of the class
onto the MSO table inside an `<!--[if mso]>` block that `stampPaths` treats as opaque — so any
class-based scheme needed **two classes and a comment-visibility rule**. It was worse than it looked
even where it worked.

#### A named regression surface with no runtime signal
`InlineTextEditor`'s `beginEdit(ordinal, expectedText)` matching
(`web/src/canvas/InlineTextEditor.tsx:34,101`) will run against rendered text that now includes
component interiors, **shifting ordinals**. That is a silent behavioural regression — it needs a
test, not a warning.

**The §5.5 overlay makes the below-root override question land harder** (§11 experiment (b)): users
will click inner elements constantly, and the honest answer is "that part is controlled by Footer."
Fine once; a product problem on the twentieth click.

### Stamps cannot anchor the canvas overlay
MJML treats `data-*` as illegal and strips it from rendered HTML, so component stamps are invisible
downstream of render. Positional `data-mjml-path` remains the only overlay mechanism. **But experiment (a) (§11) RAN AND
FAILED** for `mj-section`, the likeliest component root: `css-class` does not land on the element
`stampPaths` matches. So the canvas must address the **expanded** tree and map back to stored
positions, marking component interiors non-editable — **real, previously unscoped work** that
belongs in the cost table. Do not plan this as free.

### The properties panel states — simplified by D-2
An earlier draft specified four states built on three ownership policies (`locked`/`default`/`slot`)
and a `data-cmp-h` hash, warning that conflating `locked` with `default` would silently destroy a
user's edit. **D-2 deletes that entire apparatus** — there is no merge, so there are no policies,
no hash and no conflict state. What remains:
1. **inherited** — the value comes from the component at the pinned revision
2. **overridden** — an `ov-*` attribute exists on the reference tag
3. **inside an opaque node** — not under component control at all

The UI lane's argument for *synchronous* detection survives and gets cheaper. Its point was that a
marker painting `in sync` and then flipping to `overridden` teaches users to distrust the marker —
so detection must not wait on a fetch. Under reference, "is this overridden?" is simply **whether an
`ov-` attribute exists on the node**: synchronous, derivable from the node alone, and it *cannot*
go stale, because the override is not derived from anything — it **is** the stored value. Only the
comparison value ("Footer r9 uses `20px 0`") arrives late, via `…/versions/:v`. The two-phase panel
survives as drawn.

### The header is two diffs, and showing both is the demo
D-2 gave the screen something no copy-model build can say. There are **two** diffs and the product
shows both:

- *"What will my readers see differently?"* → the **expanded** diff. Large, rich, visual.
- *"What are you writing to my file?"* → `revision="4"` → `"5"`. **One attribute per instance.**

Under copy the second answer was "every byte of 23 templates, including an entity bug that turns
`&amp;` into `&amp;amp;`." An agency deciding whether to let software touch their clients' files is
asking exactly that question, and **"here is everything your readers will see; here is the single
attribute we change in your file"** is the sentence that closes it.

### What D-2 deleted from this screen
**The component's r4→r5 change is identical in every template.** Under copy each instance could
differ — different bases, different overrides, a merge per site — so the screen owed the user 28
individual diffs. Under reference there is **one change description, computed once, shown once**,
and the template list becomes purely *where it lands*. Per-instance detail reduces to a single
question: does an `ov-*` here shadow part of the change? That is a set intersection the client
computes from data it already holds.

Three of five statuses disappear: **no conflicts, no drift, and no per-template `blocked`** — a
revision either expands and compiles or it does not, so validate once at publish rather than 23
times at roll-out. The `preserved[]` field requested earlier is withdrawn: the architecture deleted
the requirement rather than satisfying it.

### The scope-disclosure invariant
One rule covers five separate places where correct behaviour reads as breakage when silent:

> **A change whose scope is narrower than the user would assume must say so at the moment it
> happens.**

1. **Auto-converted override** (§13) — *"set for this template only · 23 others unchanged"*.
2. **Component save** (below) — *"saved as r5 · 23 templates still on r4"*.
3. **Detach** — this instance leaves the component permanently.
4. **Partial propagation.** Propagation is **per-template atomic**, so "update all 23" landing 20 is
   the **normal** outcome, not the error path — and it will be the most-seen completion state in the
   feature. "Updated ✓" on a run that skipped three is the same failure as a silent component save.
5. **Brand-scoped search, after the §7 refactor.** Once every list is `WHERE brand_id = ?`,
   "all templates" silently means "in this brand". Browsing is fine — the switcher reads as a
   filter. **Search is the one that bites:** a user looks for a template they know exists, gets
   nothing, and the reason is invisible. Concretely: **a zero-result search must count across
   brands** — *"No matches in Acme — 2 matches in other brands."* That is a real extra query, but
   only on the empty path, which is the only path where it matters.

7. **Locking an attribute.** `ownedAttrs` is declared **per revision**, and revisions are immutable
   — so an author who locks `background-color` in r5 has locked **nothing** for the 14 templates
   still pinned to r4. They keep overriding it until someone re-pins. Correct behaviour (it is what
   pinning *means*) and it reads as broken: *"I locked it and they're still changing it."* Needs the
   same treatment as the component save, from the same root cause:
   *"applies to templates on r5+ · 14 still on r4 · [review propagation]."*
   **Keep the copy distinct from case 2, and do not fold it upward:** a save that changes nothing is
   mildly surprising; a **lock** that changes nothing *contradicts what the word means*. The
   stronger the false expectation, the less a generic sentence does.

Each is one line of copy. Each, omitted, teaches the user the product is broken.

> **A note against future tidying.** Normalising all six into a single "say when scope is narrower"
> rule would make case 6 look like a duplicate of case 3 — and **the one that looks redundant is the
> one guarding the irreversible action.** Case 6 is the only case where the user *under*-estimates
> what survives rather than over-estimating what changed. Leave it separate.

Case 5 is worth noting for *how* it was found: there was **no search surface designed at all**.
A gap in a design is invisible in a way a wrong decision is not — which is the argument for writing
invariants down rather than trusting each screen to get it right independently.

### Saving a component changes nothing — and the UI must say so
The direct, user-visible consequence of pinning over floating: edit the footer, save, and **23
templates keep rendering r4**. Correct, intended, and invisible.

So the component editor's save needs the same scope disclosure the query pane needs (§13):
*"saved as r5 · 23 templates still on r4 · [review propagation]"*. This is the user-facing half of
the pinning decision, not a UI nicety — **without it a pinned system reads as broken rather than
safe**, and the user learns "component edits don't work" at precisely the moment they are most
likely to walk away.

### Publish and roll out are two steps, and that is a feature
Under copy they had to be one frightening button, because materialising the component **was** the
write. Under reference, publishing r5 is **immutable and inert** — nothing moves until a pin does.
So an author can publish at 5pm and roll out Monday with the team watching. Label step 1's button by
what it does *not* do.

### Detach must be SHALLOW, and this was unspecified
"Expand-in-place then drop the reference" does not say whether nested components are also expanded,
and the two answers produce **different panels from the same click**:
- **Shallow** — nested `<mj-component/>` tags survive as real references, so the Button inside the
  detached Footer remains independently overridable and re-pinnable.
- **Deep** — everything is recursively expanded and **nothing** is overridable afterwards.

**Take shallow — and the deciding argument is structural, not cautious: shallow composes, deep does
not.** Shallow-detaching twice equals a deep detach; nothing gets you back from deep. Since detach
is explicitly one-way, the only defensible default is **the primitive that can be repeated into the
other one**. This is the same shape as the pin-over-float call: pin → float is one line, float → pin
is unrecoverable, so ship the recoverable direction.

The supporting argument still holds: deep detach quietly converts a component tree into plain MJML —
the copy-model-by-attrition this plan warns about under experiment (b), arriving through the detach
button instead of through `ov-*` scope. Same failure, different door.

**How this ambiguity survived so long is worth recording.** The original spec said the template
"becomes ordinary blocks" — which does not *read* as ambiguous; it reads as **deep**. Nobody
questioned it until two lanes were far enough into the panel to notice the two answers produced
different screens. **An ambiguity that announces itself gets resolved; one that reads as a decision
does not.**

**Concretely:** detaching a Footer that contains a Button leaves the Button's reference in the
template — still pinned, still propagating, still overridable, and carrying whatever `ov-*` the
Footer revision had applied to it, since the tag is preserved verbatim. Its pin is now owned by the
template directly rather than inherited through the Footer.

**Two obligations shallow carries:**

1. **The confirm must say what stays *linked*, not only what is severed** — concretely, when a
   detached component contains nested ones: *"Components inside it keep updating."* Without that,
   **shallow looks exactly like deep until someone notices the Button still moves.** This is the
   scope-disclosure invariant **inverted** — here the scope is *narrower* than the user assumes.
   Left silent it teaches *"I detached it and it still changed on me"*, which is the worst possible
   lesson to attach to a one-way action.
2. **Detach must resolve-check every nested reference before writing — which means detach can
   FAIL.** That changes the dialog more than it first appears: the confirm is no longer a
   guaranteed-success action and needs a real error state, where the natural spec assumed it was
   local and certain. `onDelete: restrict` should
   make a dangling nested reference impossible, but a direct SQL delete could produce one — and
   shallow detach would then write a template carrying a reference that cannot resolve, which the
   hard-fail guard turns into a **500 at render**. Fail the detach with a message rather than
   writing an unrenderable template.

### Detach costs more than it looks, and the confirm must say so
Under copy, detach merely removed markers. Under reference it **materialises bytes that were
virtual**: the file grows and re-linking is not supported. Lead the confirm with *"it will look
exactly the same"* and put *"cannot be undone"* second — an agency frightened of detach will avoid
components altogether, which is the failure detach exists to prevent.

### Presenting residual reformat noise — narrow scope under D-2
A propagation diff no longer re-serializes, so this applies only to the two paths where one
genuinely happens: **detach**, and templates that were hand-edited. There:
**diff canonical-vs-canonical, with one quiet inline note on the affected row.** The alternatives
were argued and rejected: *suppress* defers the credibility problem to `git diff` where it cannot
be explained; *a modal notice* is a blocking interruption for a non-decision, which trains people
to dismiss the dialogs that do matter; *a collapsed section* implies review and teaches
expand-and-ignore.

**Do not label it "first propagation."** It is not first-propagation, it is *first-write-by-us* — a
template hand-edited afterwards gets reformatted again next run. Frame it as a property of the
template's current state (*not yet normalized*), which stays true. *"'First' is a lie that breaks
the second time."*

### Unreachable is a first-class bucket, never folded
The result is **updated / unchanged / unreachable**, never two. *Unchanged* means the pinned revision already
matches; *unreachable* means we could not look. Folding them is the lie. It gets a permanent slot in
the headline, its own group above all others in the template list, its own line in the post-apply
result, and **it repeats in the footer beside the confirm button** — so someone who scrolled past
the header still meets it at the moment of decision. Rows **name the offending tag** (`in <mj-wrapper>`) — so the next registry gap
self-reports through a string rather than a support ticket — and offer only `[ open template ]`: do not draw a fix the system cannot perform. Templates can be
*partly* unreachable, so "Welcome series · 1 of 2" appears in both groups.

The passthrough state is a **whole-panel banner, not a per-attribute decoration** — it invalidates
every row beneath it.

### A pre-existing data-loss bug the new IA makes much worse
`useTemplate`'s load effect has deps `[id, …]` and its cleanup **clears the debounce timer without
flushing**. Switching templates within 1s of a keystroke silently discards the save. Brand
switching triples how often users do this, so `useUnsavedGuard` is **required, not polish**.


---

## 9. Known-fragile code — do not let a refactor near these

- **`stampPaths.ts` (738 LOC, **second** largest file — `web/src/canvas/Canvas.tsx` is 1,229 — no direct test).** An MSO-conditional-
  comment-aware HTML tokenizer doing right-to-left offset splicing, with per-block-type detectors
  matched against mjml's *rendered output*. Tightly coupled to mjml 4.18's exact emission. Its
  failure mode is a **graceful skip** — pushes to `missing[]`, with the lone `console.warn` at
  `render.ts:72` (stampPaths.ts contains no `console.` call at all) — so when it breaks, canvas
  selection silently stops working instead of erroring. The mjml 4→5 bump will
  most likely break it.
- **`parser.ts` raw walker.** `readElement` depth counting relies on a `(?![\w-])` lookahead so
  `<mj-social>` doesn't match `<mj-social-element>`. Two `lastIndexOf` boundary fixes exist at
  `parser.ts:365` and `:578` — **not inside `readElement`**, and their comments explain why the fix
  is needed rather than recording a regression. Pure byte-offset math either way.
- **`normalizeWhitespace`** — untested, index math, and every fidelity assertion depends on it. Its
  comments document **one** off-by-one (`m[0].length - 1`, `roundTrip.ts:29-33`) plus one
  missing-normalization-rule fix (the `>\s+<` collapse, `:20-25`) — not two off-by-ones.

  **FOUND AND FIXED: a live third defect that no comment mentioned — the function was not
  idempotent.** It appended a literal `" "` on **both** sides of every protected range, so each call
  grew every `mj-text` / `mj-button` body by two characters:
  `<mj-text>hi</mj-text>` → `<mj-text> hi </mj-text>` → `<mj-text>  hi  </mj-text>`.
  Benign in existing use — which is exactly why it survived — because `assertRoundTrip` normalizes
  both sides exactly once and the padding cancelled. But **every fidelity assertion in the suite
  routes through it**, and §0.3's gate required it sound. Fixed by dropping the padding: a protected
  body is bounded by its own tags and cannot run together with the collapsed text around it.
  **Found only because §0.3 asked for `normalizeWhitespace` to be covered directly** — an
  instruction that earned its place.
- **`validationLevel: "soft"` (`render.ts:60`) is load-bearing and undocumented.** It strips
  `data-*` stamps from rendered output (desirable) but reports them in `result.errors`, which
  `render.ts:60-63` reaches via a **type assertion** (not a destructuring) and never reads. Under `strict` it throws.

### Stale documentation — corrected
- **The `TODO(serializer)` in `types.ts` is stale.** `serializer.ts` already emits `if (doc.head)`
  and never writes `__synthetic`. Verified correct. Do not schedule work for it.
- **OPERATIONS.md has drifted.** It references `.omc/plans/ralplan-frontend-rewire.md`, which does
  not exist, and advises pinning to "a previous Better-Auth-based revision in git history" — but
  `git log` shows exactly one commit, `d9c10ad init`. That history is not in this repo.

---

## 10. Open risks

1. **Parser opacity may be fatal to the value proposition, not merely inconvenient.** See the
   §3.5 gate. `mj-wrapper` collapses the entire body to one node; `mj-hero`, `mj-navbar`,
   `mj-group`, `mj-table`, `mj-carousel`, `mj-accordion` and `mj-raw` all demote; and critically
   **rich text demotes too, and this is the biggest half of the problem** — `<mj-text>` containing
   **any** inline HTML demotes to a passthrough (`parser.ts:433-446`). `<p>`, `<b>`, `<a>` and
   `<br/>` all trigger it; only bare text and entities stay modeled. So the reachable surface for
   imported templates is not "templates avoiding `mj-wrapper`" — it is closer to "templates where
   no copy block contains a `<b>`". and two of the seven modeled block types are `contentField:"text"` leaves whose
   realistic authored form contains inline HTML. If most agency templates are mostly opaque, the
   engine's reachable surface is small and the honest drift report mostly says "cannot propagate".
   **Measure before building.**

   **DECIDED:** detect-and-report is **mandatory and permanent** — `locateInstances` returns
   opaque instances with `status:"opaque"` and `summary.unreachable` is a headline figure, never a
   silent skip. Measured, and since **reproduced by the implementation**: a template with two
   identically-stamped buttons yields **1 of 2 reachable**.

   **Implementation detail the report depends on:** a bare `<mj-component/>` is **itself** an
   unmodeled tag, so the parser gives it its own passthrough node. **Without excluding that case
   every instance reports unreachable and the report is pure noise.** The distinction that matters
   is being swallowed into a *larger* opaque slice, where the reference is not a node at all —
   merely bytes inside one. Modelling `mj-wrapper` is accepted as a **scoped follow-on**, and it is
   better than free: `RightPanel.tsx:579` **actively instructs users to paste `<mj-wrapper>`**
   while `parser.ts:304` collapses that subtree into an opaque passthrough — **the product is
   instructing people into the hole.** Adding it as a container (`allowedChildren: ["mj-section"]`)
   **deletes the unreachable category** rather than giving it a UI state, for roughly the same code
   as the special-casing. It is a registry entry, not parser surgery; the raw walker's depth tracking is confirmed working, and MJML
   forbids wrapper-in-wrapper so nesting disappears. `mj-hero` is not in that batch. Operating on
   `rawXml` slices was **rejected**: `stampPaths` splices into rendered HTML that is then discarded
   and never re-parsed, so persisting raw-slice surgery would kill the verbatim-capture property
   and create a second, divergent attribute parser.

   > **RETRACTED — an earlier draft of this plan claimed `allowedChildren` demotes *legal* MJML,
   > citing `<mj-section><mj-text>`. That is false, and was tested against mjml@4.18.0:**
   > where the parser demotes, MJML agrees — *"mj-text cannot be used inside mj-section, only
   > inside: mj-attributes, mj-column, mj-hero"*. The gate is not misfiring, and removing it would
   > admit structurally invalid MJML as a modeled node. **The real mechanism is narrower coverage,
   > not a misfiring gate:** `BLOCK_REGISTRY` models 9 of MJML's ~30 tags, and its `allowedChildren`
   > lists are narrower than the real content model (`mj-group`/`mj-raw` in section;
   > `mj-table`/`mj-accordion`/`mj-carousel`/`mj-navbar` in column). So the fix is **model more
   > tags**, not stop gating. Caveat: three cases were tested, not the content model exhaustively.
2. **The run-1 diff is noisier than it should be — and the risk is CONDITIONAL, not universal.**
   Executed: input already in the serializer's 2-space canonical form round-trips **byte-equal,
   0 of 10 lines changed**. 4-space or tab-indented input: **7 of 10**. A realistic template with
   `mj-head`, `mj-attributes`, a comment and a blank line: **1 line** — the blank line (the head is
   re-emitted verbatim by design, `serializer.ts:105-107`). So the noise depends on the source
   template's indentation. Earlier drafts called this a universal whole-file reformat; that is
   wrong as written, and stating it universally invites someone to test one clean file and discard
   the mitigation. The mitigation still stands for 4-space/tab sources.

   **The measurement found the real problem:** the same probe returned `canonical is idempotent?
   false`. **Because of the entity bug there is currently no canonical form at all**, so "diff
   against canonical before" is not even expressible until §0.2 is fixed. That is a second,
   independent reason §0.2 gates everything downstream.
3. **The AI can silently de-stamp a template, and no existing check would catch it.**
   `promptBuilder.ts:41` asks Claude for the *complete* document every turn, and `query.ts:116`
   validates only parseability — so a document that came back with every `data-cmp` stripped
   passes every check in the system today. `promptBuilder.ts:120` feeds `def.allowedAttrs` as the
   attribute vocabulary, so the model is told `mj-button` has only `[href, background-color,
   color]` and does not know identity attrs exist.

   **Do not fix this by adding `mj-component` to `allowedAttrs`.** `registry.ts:5-9` states it is
   "a UI-form view filter consumed by PropertiesForm.tsx" — adding `data-cmp` would turn component
   identity into an **editable text input in the properties panel**, and identity is universal
   rather than per-block, so it would be duplicated 12×. Use a single catalog-level
   `IDENTITY_ATTRS_NOTE` instead: no `BlockDef` change, no registry churn.

   **A prompt instruction is necessary but not sufficient, and under D-2 the guarantee is a gate,
   not a repair.** Extract the `mj-component` reference **multiset** before and after the turn and
   **reject the turn (502) on any change**. Do not attempt to restore references structurally —
   that was the copy-model answer, and its "prefer false negatives" bias is exactly wrong for a
   gate. A rejected turn is visible and retryable; a silently altered reference set is neither.
4. **Propagation vs. concurrent edits.** `useTemplate` runs a 1000ms-debounced save with 409
   conflict-refetch. A propagation writing N templates while a user edits one of them, half-applying
   and then 409-ing on template #17, is the worst case.
5. **MJML itself rejects `data-*` attributes.** At `validationLevel: "soft"` they land in
   `result.errors` and are stripped from rendered HTML (both desirable). **At `strict` MJML
   throws.** So soft mode is a load-bearing, undocumented dependency of the entire identity
   scheme, and the errors array is reached by type assertion and never read (`render.ts:60-63`).
   Any future tightening of validation breaks the product.
6. **The AI pane's handling of reference tags is unmeasured.** `promptBuilder.ts:41` asks Claude for
   the complete document every turn, so the reference tags pass through the model on every edit.
   Measuring survival requires live LLM calls against real templates. Unlike the copy model — where
   this was existential, because stamps *were* the identity — the reference model has a hard answer
   available: the 502 multiset gate in §10.3 turns a mangled reference set into a rejected turn
   rather than silent corruption. Measure it to size how often users hit the gate, not to decide
   whether the architecture holds.

   **This is no longer the largest single uncertainty.** That title belongs to §11 experiment (b):
   if instances need more than ~3 `ov-*` overrides on average, `ov-*` has degenerated into the copy
   model with worse ergonomics and **D-2 re-opens**.
7. **References are a visible, user-editable implementation detail — but a far safer one.** Someone
   hand-editing MJML will see `<mj-component component-id="shoe-brand/footer" revision="4" />` and
   may delete or duplicate it. Both are caught: deletion by the multiset gate in §10.3, a
   malformed or unresolvable reference by the extractor's 422 (D-3) and the throw-on-survivor guard
   at the expander's exit (D-2). This is materially better than the copy model's exposure, where
   four `data-*` attributes spread across a subtree could each be mangled independently — a single
   self-closing tag with a readable slug is harder to break and trivially easier to detect.
8. **RESOLVED — plan storage.** An earlier draft worried that plans persist `afterMjml` for the
   whole corpus. D-1 removed the blob entirely (apply re-derives), and D-2 removed the merge that
   made it large. The measured figures are in D-1's table; the surviving artifact is small enough
   that the concern no longer applies.
   Fine now, ugly at 5,000. Expire plans (24h) and garbage-collect.

---

## 11. Decisions register

### D-1 — Apply mechanics: **re-derive AND verify** (decided; largely SUPERSEDED by D-2)

> **SUPERSEDED IN PART by D-2.** Under the reference model, apply is a pin bump and the diff is
> expand-vs-expand, so most of the apparatus below is moot — the per-template hash pin, the
> policy-set hash, `onConflict` granularity and `data-cmp-v` addressing all belong to the copy
> model. **What survives and must still be built:** plan supersession (**410 Gone** with the
> successor id, not 409); **version-addressed component reads** (`/versions/:n`,
> `Cache-Control: immutable` — the list must not be); a **drift endpoint that must not call
> `mjml2html`** (14.6 ms each, 7 s corpus-wide); and **per-item atomicity** — each template row and
> its run-item carrying `prevMjml` commit together, or undo corrupts in one of two directions.
> Everything else below is history.

I originally adjudicated this as "persist the plan, apply writes it." **That was wrong on the
mechanism, and the propagation lane overturned it by testing both positions.**

**Determinism holds.** 50 runs of the same propagation, interleaved with unrelated parses to
perturb the parser's module-global `nid()` counter, produced **one distinct output hash**.
`BlockNode.id` does vary between parses (`n_2ck` vs `n_2d4`) and never reaches output — the one
thing that could have broken it. So re-derivation is sound for the current stack.

**But the measurement found both documents wrong about size.** Over 480 templates / 2,400
instances:

| | |
|---|---|
| full `afterMjml` | 1.06 MB — persisting every rewrite |
| rich diff JSON | **667 KB** — per-attribute rows for every instance |
| per-template hash | 7.5 KB — an integrity pin |

The body cap is **256 KB** (`createWebApp.ts:15`). So the rich diff does not fit either — an
assumption the propagation design had missed about its own payload. (A circulating "50 MB" figure
was 200 × the cap, not realistic template sizes; real corpora are 1–9 MB.)

**Resolution:**
1. Preview returns summary + **per-template rows only** (~120 bytes each → **58 KB** at 480
   templates, inside the cap).
2. Per-instance `AttrChange[]` / `Conflict[]` load **per template on expand**, via
   `GET …/plans/:planId/templates/:templateId` — which is what a diff screen does anyway.
3. **Apply re-derives.** Nothing large persisted.
4. **The plan stores a 16-byte hash of each template's re-derived output** (7.5 KB total). Apply
   compares its fresh re-derivation against that hash before writing; mismatch → `failed-plan-drift`
   and **no write**.

Step 4 is the part worth defending. Determinism is a property of the code *as it is today*, and it
stops holding the moment anyone routes propagation through the LLM — or changes the serializer, a
registry default, or a merge rule between preview and apply. The failure it prevents (approve
preview A, get rewrite B) is silent and corpus-wide. **An invariant stated in a comment is a hope;
a hash compared before the write is a guarantee.** Re-derive *and* verify costs 7.5 KB and is
strictly better than either original position.

**Two gaps that stand independently:**
- **`pins` covers template versions only.** The three-way merge also reads the component definition
  and its policy set — edit either between preview and apply and the rewrite changes with no
  version mismatch to catch it. `ApplyRequest` needs `componentVersion` plus a policy-set hash.
- **`onConflict: "abort" | "skip"` is too coarse** once merges produce per-instance conflicts. Fine
  for v1, but it cannot express "apply these 37; on the 3 conflicts, take-component on one".
  `Conflict.resolution` exists so the request can grow a `resolutions[]` field without a redesign.

**Two routes the UI needs**, now argued rather than asserted: a component **drift/health** endpoint
(without it drift is computed and discarded), and **version-addressed** component reads
(`…/components/:key/versions/:v`) — a conflict row must show base/component/instance to be
judgeable, and `componentId`-only addressing cannot reach the merge base at `data-cmp-v`.

### D-2 — Reference vs. copy model: **REFERENCE**, plus a per-instance detach (decided)

Templates store `<mj-component component-id="shoe-brand/footer" revision="4" />`; content lives
once in **immutable revisions**; expansion is server-side at render/export only. Propagation is a
revision bump. Adjudicated against executed probes, not argument.

**1. Opacity damages the two models asymmetrically.** Both get buried by `mj-wrapper` — but it only
matters for copy. Reference must find a **fixed-shape self-closing token** and substitute a string;
run straight through an opaque wrapper this produced correct, compilable MJML. Copy must
**understand a variable-shape subtree** — read its attrs, three-way merge, splice back at a byte
range inside `rawXml` that nothing tracks. The sharpest case: a rich-text instance parses to
`mj-custom-passthrough` with **attrs unreadable** (`parser.ts:435-446`), so merge on it is
*impossible* — and rich text is "the main case for copy blocks". The same rich text as a component
**body** compiles with 0 errors, `<b>` intact. **Copy's worst case is reference's easiest case**,
because content you store whole and emit whole never needs to be understood.

**2. The dry-run diff is BETTER under reference** — this was posed as possibly decisive for copy and
decides the other way. The diff is `expand(template, pins)` vs `expand(template, pins bumped)`: real
before/after MJML and rendered HTML, both pure functions of stored data. ("Revision 4 → 5" is not
the diff and must not ship as one.) The copy model **cannot diff before-vs-after at all**, because
its own write path reformats the template — it has to diff against `serialize(parse(before))` and
explain the reformat away in prose. Measured: propagating under copy mutates
`<mj-text>Buy &amp; save</mj-text>` → `&amp;amp;`, bytes with no relationship to the component. A
reference bump changes **one character**. Blast radius per run: copy = every byte of 23 templates;
reference = one attribute value in each. That generalises past the entity bug — **copy's write path
is "re-serialize the corpus", so every serializer fidelity defect, present and future, becomes a
corpus-wide data-loss event under an unattended feature.**

**Treat the one-attribute blast radius as an invariant, not a happy property.** If a future change
makes propagation rewrite more than the pin, it has removed the reason the model was chosen. That
is a checkable condition an implementer can hold the design to, rather than a quality that quietly
erodes.

**3. Reversibility runs one way.** Reference → copy is the expander you already wrote, run over
every template and written back (~40 lines, deterministic, per-template). Copy → reference is
*inference*: prove each instance still matches a revision, adjudicate by hand every one that
doesn't — against drift the copy design accumulates **by design**.

**What this deletes** — and this is the 8-week argument, since the cost is novel algorithm rather
than line count: three-way merge, the `locked`/`default`/`slot` policy trio, `unknown-base`
degradation, six drift detectors, the `data-cmp-h` tripwire, fingerprint orphan adoption, and the
conflict-resolution UI.

**Overrides are supported and simpler:** `ov-*` attributes on the reference tag, applied at
expansion. Verified byte-identical over 5 parse/serialize cycles with an entity-bearing URL. No
merge, no base, no conflicts — an override is a literal attribute propagation never touches.

**Exact semantics, after a correction found by applying the ambiguity lesson to the spec itself:**
an earlier draft said `ov-text` replaces "its designated text node" — **nothing designates a text
node; no such mechanism exists.** The phrase merely *sounded* like it referred to one. Worse, the
worked example above it was **incoherent under its own rule**: `ov-href` and `ov-text` on a footer
rooted at `mj-section`, an element with neither an `href` nor text content. It sat in front of two
lanes for several exchanges and neither caught it — *precisely because it read as settled.*

- **`ov-<attribute>` sets that attribute on the single root element, and nothing else.** Legality is
  checkable **without expanding**: `rootTag` + `BLOCK_REGISTRY[rootTag].allowedAttrs`. So the
  properties panel's override fields are derivable **client-side**, from the palette payload it
  already holds.
- **Slot markers use `data-slot`, not `mj-slot`** — MJML strips `data-*` from rendered HTML, so the
  marker cannot leak into the delivered email. (`ov-slot-headline` sets a slot's *text*; the
  attribute form is unspecified and gets ugly fast — not worth solving before experiment (b) says
  slots are needed at all.)
- **`ov-text` is the one reserved name**, valid only when the root's `contentField === "text"` —
  **422 at save** on any other root, never a silent no-op.
- **A section-rooted footer therefore cannot override its unsubscribe link.** That is not an
  oversight; it is exactly the gap experiment (b) measures. The honest panel for such a component
  shows very few fields — **and that emptiness *is* the signal, not a bug to design around.**
  A thin panel reads as unfinished work, and enriching it would paper over the very measurement
  (b) depends on. Likewise, clicking the unsubscribe link highlights **nothing, because nothing
  can** — that is not the degraded case, it is the **common** one, and it is where the limitation
  becomes *visible* rather than merely true. **A user told plainly that the link belongs to the
  Footer has learned the system; one who finds a field that silently does nothing has learned to
  distrust it.**
- **Always show two examples, never one.** The incoherent `ov-text`-on-a-section example above
  propagated from one lane's document into another's, then reproduced itself in a second passage
  there. **A coherent-sounding example is load-bearing in a way prose is not, and copying one copies
  whatever is wrong with it.** Show a section-rooted Footer (background-colour, padding, **no text
  field**) beside a button-rooted CTA (label, link) — one example is how the bad version survived.
- **Two policies, not one — a gap found by tracing the bad example into the other documents.** An
  attribute is either **component-owned** (no `ov-` accepted) or **overridable**. An earlier spec
  had only one policy — everything on the root is overridable — which leaves a component author no
  way to say *"the brand blue is not yours to change."* So the derivation is
  **`allowedAttrs(rootTag) − ownedAttrs`**, with `ownedAttrs` declared in the component body
  (`mj-own="…"` on the root), parsed at publish and stored on the revision for the same reason
  `rootTag` is: the panel needs it **per palette entry, without fetching a body**.
- **The panel has three states, and the distinction protects a measurement:**

  | Case | Cause | Panel | Route out |
  |---|---|---|---|
  | overridable | in `allowedAttrs`, not owned | editable field | — |
  | **owned** | author marked it | **shown, locked** | edit the component |
  | **not addressable** | below the root | **not shown at all** | detach, or slots |

  **Owned attributes are shown locked, not omitted** — an invisible policy reads as *no* policy, and
  omitting them makes a deliberate decision look like a missing feature.

  **This also protects the experiment (b) signal.** The emptiness that matters is only the third
  row. Locked rows do **not** count as filling it: a panel full of grey locked fields and zero
  editable ones is a **different diagnosis**, and collapsing the two would hide the mechanism gap
  behind the author's choices. Make it a spec-test assertion — it is exactly the kind of distinction
  that gets merged during implementation for looking similar on screen.

  > **A post-launch trap in the same measurement.** Experiment (b) runs *before* components exist,
  > so ownership cannot affect its count. Re-run it after ship and the meaning **inverts**: if
  > authors lock aggressively, the observed override rate falls for **policy** reasons while
  > frustration *rises*. **A healthy-looking average post-launch means the opposite of what it means
  > pre-launch.** Anyone re-running that count after ship must exclude owned attributes, or it
  > measures the authors rather than the mechanism.
  >
  > **The dangerous version is not someone forgetting the measurement — it is someone re-running it,
  > getting a number, and trusting it.** A measurement that silently changes what it measures is
  > worse than one nobody runs. **So that warning belongs written on the query itself, not in this
  > document.**

- **Default to overridable**, permissive until an author locks something, rather than rigid until
  opened up. **The opposite default is Knak's — and *"difficult to copy paste modules from one
  template to next"* is what it produces.** That review is in §1 as the evidence this whole product
  rests on; shipping its cause would be a poor joke.
- **The entire field list is derivable client-side** from the palette payload: `rootTag` +
  `allowedAttrs` − `ownedAttrs` gives the fields, `contentField` decides whether `ov-text` is legal.
  No fetch.
  Fields render immediately; only *comparison values* need `…/versions/:v`. **Structure is local,
  history is remote** — the same sync/async split as override detection, extended to the whole
  panel.

**Hybrids:** storing both expansion and reference is the worst of both — rejected. Per-component
choice is coherent but is the union of both costs — rejected. The one coherent hybrid is
**DETACH**: reference storage plus a per-instance, one-way expand-in-place that drops the link.
It answers the real requirement (a designer breaking from the component for one email) with no
merge machinery, and agencies will want it regardless.

### The `/query` finding that independently confirms the verdict
`query.ts:131` replaces the **entire** template with the LLM's output wholesale, and
`SYSTEM_GUIDANCE` demands "the COMPLETE updated MJML source… never a fragment". So **every AI turn
rewrites every byte of every component region in that template.**

Canonical hashing kills the formatting half. It does **not** kill the half where the model edits a
real attribute inside a component region — which it will, because nothing in the prompt marks those
bytes as sacred. Under copy, therefore, **a template enters "locally modified" because someone asked
Claude to change the subject line** — not a user action, not visible in the request, and landing on
the tool's headline feature rather than an edge case.

The detection asymmetry is the point: under copy it means canonically diffing every instance region
against its component revision **on every turn**; under reference it is a multiset comparison of
self-closing tags. Raised by the lane that had *proposed* reference and was preparing to concede to
copy — which makes it unusually good evidence.

### The strongest argument against this verdict, and what it changes
Copy's stored artifact **is the thing the customer bought** — complete, portable, intact even if
the expander is buggy or the company disappears. And **mjml's soft validation silently drops an
unexpanded reference**: verified — *"Element mj-component doesn't exist or is not registered"*,
`component-id` never reaches the HTML, the section still renders. **One expansion miss is a
footerless email sent with a 200.**

**A second objection, from the schema lane: "copy is the better fit for this codebase — loud beats
clever."** Its reference design needed five separate guards purely to stop silent failures
(registry entry, stamp matcher, single-root-element rule, css-class injection, LLM reference guard),
where copy's hard problems — drift, conflicts, reformat noise — are at least loud.

Answered on two fronts. **The five guards collapse to roughly one**: a throw-on-survivor check
converts the whole class from silent to loud. And **copy is loud in theory but silent in practice
here** — its write path is "re-serialize the corpus", so every serializer fidelity defect becomes a
corpus-wide data-loss event under an unattended feature, and the `/query` path above manufactures
false drift invisibly. Loud is achievable under reference; it just has to be built deliberately
rather than inherited.

That does not overturn the verdict; it **sets build order**. Week one, not week six:
1. **Throw-on-survivor** — a hard guard if any `mj-component` survives expansion. Put it at the
   **expander's exit**, not in `render.ts`, so every future caller inherits it rather than each one
   remembering. `render.ts` should also *read* `result.errors` instead of discarding them.
2. **Bulk "export all as expanded MJML"** — the customer must always be able to walk away with
   plain MJML.

### Experiment (a): RUN, and it FAILED. The verdict survives; the cost table grows.
`css-class` as an overlay anchor **does not work for `mj-section`** — the likeliest component root.
Measured, by checking which element actually receives `data-mjml-path`:

```
--- mj-section ---
  path="0"   on <table> class="(no class attr)"                        hasCssClass=false
  path="0/0" on <div>   class="mj-column-per-100 mj-outlook-group-fix" hasCssClass=false
--- mj-column ---
  path="0/0" on <div>   class="…mj-outlook-group-fix mjcmp-test"       hasCssClass=true
```

mjml puts `css-class` on an outer `<div>` and an `…-outlook` table; `stampPaths` stamps a **bare
`<table>` with no class attribute at all**. Works for `mj-column`, fails for `mj-section`.
(`mj-wrapper`/`mj-hero` stamp `0/0`, so the question does not arise.)

**Consequence:** `css-class="mjcmp-<pathKey>"` as specified must be dropped. The canvas must instead
address the **expanded** tree and map back to stored positions, marking component interiors
non-editable. **That is real, previously unscoped work** and belongs in the cost table. It does not
reverse D-2 — the same probe found a working anchor — but the verdict was explicitly conditional on
this and the condition was not met.

### Experiment (b): still to run — and it needs a second question, or it can pass while the design fails
On ten real templates, count how many attributes differ per instance. **If it averages above ~3,
`ov-*` degenerates into the copy model with worse ergonomics** and D-2 should be re-opened.

**The average alone is not sufficient, and this nearly shipped as the gate.** `ov-*` is scoped to
**flat, root-level** targets — the component's root element plus one designated text node.
Below-root is out of scope. But the overrides email components actually need are frequently
below-root: a footer rooted at `mj-section` can have its background overridden but **not its
unsubscribe link**; a product card can have its padding but **not its CTA**.

So measure a second thing, at near-zero extra cost: **what fraction of differing attributes target
something below the root.** The count can come back at a reassuring 1.8 while every one of those
1.8 is a nested CTA `href` that flat `ov-*` cannot express — **the average passes and the design
still fails, for a reason the average was never going to show.**

**A third measurement, near-free: how many distinct components account for the overrides.** If most
land on the footer, the answer is "the footer needs slots", not a general mechanism.

The consequence if below-root demand is real: `[ Detach ]` stops being an escape hatch and becomes
the routine path — **the copy model reached by attrition, through a one-way door.**

### If (b) comes back below-root-dominant, the answer is declared SLOTS — not a targeting syntax
These look alike in a UI and are not the same thing. Separating them now prevents reintroducing the
exact failure the reference model was chosen to eliminate:

- **Ad-hoc targeting** (`ov-<nth-button>-href`) addresses a structure the component never declared.
  When r5 rearranges the interior, the override **silently lands on a different node** — silent
  post-re-pin drift, arriving through the override mechanism. Reject this.
- **A declared slot is a contract.** The component marks its overridable points; instances fill them
  by name; and an override naming a slot the pinned revision no longer declares **throws at
  expansion** rather than no-opping.

**The schema does not move either way** — slot declarations live in the component's MJML, overrides
in the instance's. So experiment (b) can invalidate the tag design without touching the table set.

**A guarantee that must be walked back if slots arrive.** "Overrides are fully orthogonal to
propagation" holds for flat root-level `ov-*`. With slots, *"r5 removed the slot this instance
overrides"* is a real conflict — statically detectable at dry-run, so a **blocking row** rather than
a three-way merge, but not zero. **REVERSED.** An earlier draft said to keep the panel's orthogonality promise unconditional, on the
grounds that hedging against a branch that may never happen is a permanent tax. That reasoning held
when slots were the only exception. **There are now two, and one of them is decided rather than
conditional:** r5 removing a slot the instance overrides, and **r5 marking owned an attribute the
instance overrides** — which follows from `ownedAttrs` existing at all, not from slots shipping.
Both surface as blocking dry-run rows rather than merges, so the propagation model holds — but the
copy must read **"overrides carry forward unless the component's policy changed."** The claim has
been qualified twice; **twice is the signal to write the qualified form.**

Keep the distinction that makes the sentence still worth having: **both exceptions are *policy*
changes — deliberate acts by a named person, not merge accidents** — so the clause points at
something a user can go and look at.

> **A failure mode distinct from the others in this plan, and worth naming: a sound decision left
> standing past its premise.** The argument for keeping that copy unconditional was correct *when
> slots were the only exception*. Locking then made the exception real — and the unconditional
> sentence was already wrong while it was still being defended. Not an invisible assumption; a
> conclusion that outlived its input. **When a premise changes, re-check what was decided on it**,
> not just what depends on it.

**Record *which component* is being detached, not just how often.** Concentrated on one component
means that component needs slots — cheap. Spread across many means the mechanism is under-powered —
redesign. Same datum, two very differently-priced conclusions, and without the breakdown the number
says something is wrong but not which.

**Detach frequency is the one piece of instrumentation this plan asks for**, and the interpretation
must be fixed in advance: **a climbing detach rate is not a UX finding about the dialog.** It is
evidence that `ov-*` is under-powered, and the response is to fix the mechanism, not the wording.
Careful confirm-copy is good practice on a *rare* action and a **smell** on a frequent one — and the
failure mode is that the copy works well enough that nobody notices the mechanism is wrong. Written
down now, before that copy gets praised for reducing friction on an action that should have been
rare.

### Two more findings from the same probe run

**A silent off-by-one that mis-targets every canvas click.** Stamping the **stored (unexpanded)**
source against **expanded** HTML produces:
```
stamped=3/3 missing=[]      <- render.ts warns only when stamped < expected
  top-level path="1" -> <table> background=#111111   <<< FOOTER (WRONG)
```
Every canvas click on that section selects and edits the **wrong block**, and `render.ts:70` can
never warn, because `stamped === expected`. Stamping the expanded source gives `6/6 missing=[]`.
**`render.ts` must expand before both `mjml2html` and `stampMjmlPaths`, and hand both the same
string.**

**The worst failure is confirmed and is one line away.** An unexpanded reference reaching the
compiler:
```
errors: ["Element mj-component doesn't exist or is not registered"]
component-id reaches HTML? false
rest of the email still renders?  true
```
mjml drops it silently under soft validation, HTTP 200. The warning lands in `result.errors`, which
`render.ts:60-63` never reads. **One missed expansion is a footerless email to a client's list with
no signal anywhere.** This upgrades throw-on-survivor from good practice to *the single line
standing between this product and its worst outcome* — week one, **with a test**, and `render.ts`
should read `errors` rather than discarding them.

### The cost the verdict did not price: adoption
Neither the verdict nor the schema design costs **componentization**. An agency arrives with 40
templates of literal `<mj-button>`s; before a single reference exists, something must find recurring
instances, decide which are the same component, and rewrite them as `<mj-component/>`. That is
`locateInstances` plus a locked-attr fingerprint matcher plus a human review queue — needed **once,
as migration tooling**, not as permanent product surface. `.plan/propagation.md` §1 and §5(a) are
the design for it; they survive D-2 in that role.

Secondary omission: *"make the footer say X"* needs **routing** from template to component in the AI
pane. The UX loss is named in the designs; the work is not costed.

### Two decisions locked now
- Key references by **human-readable slug** (`component-id="shoe-brand/footer"`), not UUID.
- Require all `ov-*` values entity-encoded, and have the expander use the parser's **quote-aware
  scan, not a regex** — a naive regex misses a raw `>` in an attribute value. It fails closed into
  the throw guard, but do not rely on that.

### Consequence for D-1
D-1's re-derive-and-verify machinery was designed for **copy-model merges**. Under reference, apply
is a pin bump and the diff is expand-vs-expand, so most of that apparatus is moot. What survives and
is still worth keeping: **plan supersession** — `GET`/`apply` on a plan whose component has been
re-published returns **410 Gone** with the successor id (not 409; nothing about the request
conflicts, the resource simply is not current). Without it: tab open over lunch, colleague ships v8,
Apply writes a v7 result under a green checkmark.

Also surviving from that lane, independent of D-2: **version-addressed component reads**
(`/versions/:n`, `Cache-Control: immutable` — the list must not be), a **drift endpoint** that must
not call `mjml2html` (14.6 ms each, 7s corpus-wide), and per-item atomicity — each template row and
its run-item carrying `prevMjml` must commit together, or undo corrupts in one of two directions.

### D-3 — Slug keying makes renames a corpus rewrite: **slug is identity, name is label** (decided)

A consequence the D-2 verdict implies but never stated. A slug is **half of every reference**, so
editing `brands.slug` or `components.key` orphans every template using that brand's components —
which is exactly the corpus-wide blast radius the reference model was chosen to avoid, re-entering
through the back door. And "rename a component" looks like table stakes in a design-system product.

**Resolved:**
- `brands.slug` and `components.key` are **immutable after creation** — identity, not labels.
- `name` is freely editable and is what the UI shows. **No rename affordance on slug/key.**
- **Enforce it in the type, not in review comments: remove `slug` from the update DTO entirely**, so
  a rename bound to the wrong field does not compile. Same reasoning as constructing
  `TemplateService` per-brand (§7) — a rule that cannot be expressed as a compile error is a rule
  that gets violated six weeks later by someone adding an edit pencil to a list row.
- A genuine re-slug is a **rare dedicated command**, not a `PATCH`.
- `components.id` stays a UUID PK with the slug as a unique natural key resolved at extraction.
  Internal FKs stay single-column, and the re-slug escape hatch is "rewrite references plus one
  UPDATE" rather than cascading a PK change through four tables.

If slugs should be mutable, the cost is a corpus rewrite per rename, and that must be a deliberate
decision rather than a default.

**Related, and load-bearing:** the extractor **422s** on an unresolvable slug, a brand mismatch, or
a missing revision. A reference that cannot resolve must never reach storage — the alternative is a
template that saves clean and 500s at render, or worse, renders 200 with the content silently gone
(see D-2's throw-on-survivor).

---

## 12. Sequencing — what actually gets built, and in what order

This section supersedes the implicit ordering elsewhere. It exists because an adversarial review
found two structural problems that reordering fixes for free.

### Problem A — with §5–§8 complete and perfect, there is still nothing to sell
Across this plan, `.plan/api.md` and `.plan/propagation.md`, the word count for **signup, login,
stripe, billing, subscription, pricing, onboarding and hosting is zero.** `.plan/api.md` §0.2 says
outright "I am not recommending building auth now." **Brands are not tenants** — §7 adds a brand
axis to a single-user localhost SQLite app that OPERATIONS.md says must not be exposed to the
internet.

So the finished state of §5–§8 is *a multi-brand single-user local app that cannot take money*,
against an 8-week "first paying customer" goal with **zero weeks allocated to that gap**. Also
unbudgeted: one user on Opus tokens can exceed $49/mo, so the price point may not clear COGS.

### Problem B — the v1 scope decision that dissolves three blockers at once
**Make propagation over *imported* agency templates a non-goal for v1.** Templates are authored in
the component system, so every node is a reference *by construction*.

This is not a workaround, it is a smaller product:
- **The opacity problem (§3.5, §10.1) shrinks to almost nothing.** For imported templates the
  reachable surface is not "templates avoiding `mj-wrapper`" — once rich text is counted it is
  closer to "templates where no copy block contains a `<b>`".
- **`allowedChildren` becomes a spec rather than a defect.**
- **The residual reformat noise disappears for free.**

The cost is an onboarding cliff: somebody must convert an agency's existing templates — the
componentization work §11 flags as unpriced. The build order below turns that cost into the
go-to-market motion instead of hiding it.

### The smallest thing that can actually be sold
**Not a SaaS. Sell the migration, productized, with the tool as private delivery leverage.**

*"Send me your five most-used templates and your brand rules. You get them back as a component
library plus a tool where changing the button changes all five. Flat fee, two weeks."* Priced well
under Mavlers' $4,999 — one person, narrower deliverable.

Requires: the component model, the expander, and a dry-run diff readable **in a terminal**. Does
**not** require: auth, accounts, Stripe, billing, hosting, multi-tenancy, signup, onboarding, the
brand-scoped API refactor, or mjml 5. **That removes the entire missing half above from the 8-week
window, and most of `.plan/api.md` with it.**

And it answers the one question the wiki names as blocking: *does labour spend convert to tool
spend?* Three paid migrations tell you, and every respondent is pre-qualified because they already
paid. If two of three ask *"can I keep using this myself?"* — that is the self-serve signal, and
*then* accounts and Stripe get built, funded, to a spec written by customers.

If services are rejected outright as a time-for-money trap: same information, worse economics —
build the tool, do one agency's migration free for design-partner access and a case study.

### Restate the goal
**"One agency's templates are running on the component system" — not "the SaaS is live."** The
current goal is not reachable in 8 weeks part-time, and its unreachability is the goal's fault, not
the plan's.

### Build order

| When | What | Why |
|---|---|---|
| **Week 0, ½ day** | Join Email Geeks Slack, read for the modular-reuse complaint | The only step that de-risks §1's bet. The wiki flags this twice as the one demand source never reached. |
| **Week 0, 1 hr** | §11 experiment (b): on ten real templates, how many attributes differ per instance | Above ~3 average, `ov-*` degenerates into the copy model and **D-2 re-opens**. Cheapest possible check on the biggest decision. |
| **Week 1** | Phase 0, reduced and timeboxed: **§0.3 property test written FIRST**, then §0.2 entity fix *validated by it*, on §0.1 bootstrap. Plus §0.5 (`unstamped` return) and §0.6 (Origin check, 409 fix). **No mjml bump.** | The property test is what makes the entity fix trustworthy; writing it second wastes the gate. |
| **Weeks 2–4** | Vertical slice, tool-authored templates only. One component ("primary button") **referenced** from three generated templates; the expander; **throw-on-survivor at the expander's exit**; bulk expanded-MJML export; one revision bump; the diff printed **to the terminal** as `expand(before)` vs `expand(after)`. No UI, no brands table, no API refactor, no auth. | Deliverable is a working expander + pin bump on your own machine. The guard and the export are week-one items per D-2, not polish — an unexpanded reference renders 200 with the content silently gone. |
| **Week 5** | First migration, by hand, for one real agency. Convert their templates, run the terminal tool, hand back rendered proof. Paid if possible, design partner if not. | This is the experiment §1's bet needs. |
| **Weeks 6–8** | Build what that agency asked for while you sat with them | If they ask to run it themselves, you have a funded, specified reason to build the UI, brands schema, auth and Stripe — and you know which of §7–§8 was speculative. |

### The gate above the gate
§4 says "nothing in §5–§8 may start before Phase 0 lands." Add one above it: **nothing in §7–§8
should start before one real agency has tried the component model at all.**

D-2 reduces the force of this considerably — the reference model already deleted the override
machinery this gate was mostly guarding against. It still holds for `ov-*` ergonomics, which
experiment (b) sizes directly, and for the brand-scoping refactor, which is the largest block of
work in the plan and serves a multi-brand dimension a single hand-run migration does not need.

---

## 13. `/query` under the reference model — the capability loss, and a third exit

**The problem.** Claude receives `<mj-component component-id="…" revision="4" />` — an opaque
self-closing tag. It cannot see or edit component interiors, so *"make the footer say X"* stops
working the way it does today. This is the **routing** gap: the AI pane must resolve a request
about a template into an edit on a *component*, and neither the verdict nor the schema design
costed it.

Not a defect in D-2. Under copy the model *could* edit component interiors — but only by silently
de-stamping them (§10.3), which is worse. Reference makes the limitation **visible and fixable**
rather than silent.

**Two obvious exits, both lossy:** send expanded MJML and references silently become copy; send
references and Claude works around holes.

**A third exit — expand-and-recollapse.** Send expanded, take back expanded, re-collapse
mechanically. Wrap each template-level instance in
`<!-- cmp shoe-brand/footer r4 BEGIN … END -->`; on return, canonically compare each region's
interior against our own expansion before swapping the `<mj-component/>` tag back in.

**What makes it safe is that we know exactly what we sent.** A dropped delimiter, a mangled
interior and an invented region are all detectable — there is no silent path. The reference-multiset
gate (§10.3) survives as the final assertion, demoted to a backstop.

Two things fall out, and they are the reason to build it rather than accept holes:
- **A changed interior is *diagnosable*, not merely detectable.** Attribute-diff the returned
  region. If every change is root-level and overridable, **convert Claude's edit into `ov-*`
  automatically**. If it goes deeper, offer the user *edit the component (affects 23)* or *detach
  this one* — the design-system-correct answer to "make this one different", reachable only because
  Claude could see the content.
- **It is the same computation as §3.5 / §11 experiment (b).** The diff that decides whether an
  edit is override-shaped is the count that says whether `ov-*` is viable at all.

For the UI this **deletes** the "here's what Claude can't see" disclosure — an apology for a
limitation, shown before the user had done anything — and replaces it with a decision point on the
path users actually walk. **The two outcomes must not share a treatment:**

- **Auto-converted to `ov-*`** — informational, already applied, **no modal**. But it must state
  *what scope it took*: "I asked for green and got green" hides that 23 other templates did not
  change, and that silence is precisely what surprises people three weeks later. So:
  *"set for this template only · 23 others unchanged · [change Footer everywhere instead]"*.
- **Changes go deeper** — genuinely **blocking**. There is no safe default: "change 23 templates"
  and "fork this one permanently" are both too consequential to pick on someone's behalf.

**A fourth outcome, and it must not inherit the blocking dialog: the region is structurally
broken** — delimiter dropped, region missing, region invented. This is not a deeper version of
"changes go deeper". In the blocking case we know what the model meant and can offer a real choice;
here we do not know what happened, so **any choice offered is a guess wearing a decision's clothes,
presented in the one place the user will most trust it.** Its path is: reject the turn, apply
nothing, say plainly that it could not be verified.

**And do not point its repeat-hint at the model picker** until the `ALLOWED_MODELS` duplication
above is fixed: a hint aiming the user at a control whose options may not match what the server
accepts is a hint that **makes things worse**, on the one branch where they are already confused.

Worth separating now because it is **the likeliest failure with a long document or a weaker model**
— `settings.default_model` already permits sonnet — so if it inherits the blocking dialog it becomes
the most-seen dialog in the feature and the least able to support itself.

If a turn produces both of the first two, the blocking one resolves first.

**The override-shape diff has two consumers, which is an argument for building it early.** The
attribute-level "is this edit override-shaped?" comparison this needs at runtime **is** the
experiment (b) computation (§11). One implementation, two consumers — but they want different
reductions: runtime asks *"is this override-shaped?"*, the experiment asks *"how many and where."*
**Return the structured per-attribute diff and let each side reduce it**, or there will be two
implementations inside a month.

**Cost, stated honestly:** the most machinery of the three options, bigger prompts, and a
string-level re-collapse inside the LLM path.

---

## 14. A correction to my own rich-text argument

D-2 leaned partly on rich text working as a component **body** where it fails as a copy instance.
That holds, but it is narrower than stated, and two unreachable classes were wrongly grouped:

- **`mj-hero` / `mj-navbar` are registry gaps** — same shape as `mj-wrapper`, same fix, and the
  tag-naming explainer (§8) makes the next one self-report.
- **Rich `mj-text` has no registry fix.** `parser.ts:437-446` demotes *any* leaf with an element
  child to a passthrough, so `<mj-text>Buy <b>now</b></mj-text>` is already a
  `CustomPassthroughNode` with unreadable attrs. Inline HTML in `mj-text` is the norm in real
  email, so **plausibly a large share of real templates' text blocks are unreachable today —
  independent of components, and shipping now.** **Flagged honestly: "a large share" is inference
  from how email is written, not a measurement.** It must be checked before anything is built on
  it. The check is ten minutes and needs no fixtures: parse ten real templates, count `mj-text`
  nodes that come back as `mj-custom-passthrough`. `src/templates/starter.mjml` dodges it entirely
  (every `mj-text` in it is plain), which is likely why this has never surfaced.

Verified precisely: `parser.ts:433-445` demotes any leaf with an element child — **a comment
counts**. And `starter.mjml` contains exactly **two** `mj-text` blocks, both plain prose. The repo's
only fixture dodges the path entirely, which is why this has never surfaced.

**The two classes need different UI copy, because they are different situations:**
- **Class A (registry gaps)** — the banner can blame a container the user chose and invite a fix.
- **Class B (rich leaf content)** — neither applies. The user put a link in a sentence; nothing is
  at risk and there is nothing to fix. Copy should read as a tool limitation — *"this text block can
  only be edited as code… the text and styling are safe, they just aren't editable as fields here"*
  — not as damage.

**The consequence for the component library is the sharp one:** a footer with an unsubscribe link is
authored through the **raw-MJML textarea inside its own component editor**. The authoring experience
is weakest for exactly the content type email uses most.

**Size it before designing around it (ten minutes):** count `mj-text` blocks containing `<` across a
handful of real templates — same ten as §3.5 and experiment (b). **A caution about the word "provisional":** a design provisional on a count becomes permanent when
the count does not get run, and under schedule pressure it drifts toward the *cheaper* build — here,
the fallback-with-good-manners. So this is a **blocker on the copy, not a note attached to it**, and
the honest statement is: **if the count has not run, the state of this design is *unknown*, not
*rare*.**

If rich text turns out to be routine, **the answer is not a quieter
banner.** The inline "edit as code" affordance becomes the *primary* text-editing path for a large
share of blocks and should be designed as a **first-class editor, not a fallback with good
manners** — and likewise the raw-MJML textarea in the component editor, which is then where footers
actually get authored. At that point "weakest for the content type email uses most" stops being a
caveat and becomes the thing to fix. **The count decides which product is being built.**

And the honest narrowing: rich text works as a component *body*, but **inside the component's own
editor that `mj-text` is still raw-textarea only.** The reference verdict is not overturned by this;
its rich-text argument is simply less sweeping than §11 states.
