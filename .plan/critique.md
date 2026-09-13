# Adversarial review — PLAN-design-system.md

**The engineering in this plan is good and the business case is inverted: §1 cites the
founder's own research wiki as support while contradicting that wiki's two
highest-confidence conclusions, one of which uses this exact candidate as its worked
example of the reasoning error being made.** The plan is not fundamentally wrong about
*what to build*. It is wrong about *why*, about *what "done" means*, and about the
order.

Three most serious problems first, then the five questions as asked.

---

## Problem 1 — The plan inverts its own cited evidence

`PLAN-design-system.md:21-22`, offered as evidence the category is open:

> Incumbents (Knak, Dyspatch, Stensul, Chamaileon, Taxi) are four-figure and sales-led;
> four of five publish no price at all

`~/code/ideas/notes/thin-niche-fallacy.md` (confidence: **high**), instance 1 of the
three ways the instinct failed:

> **Sub-$300/mo email design-system governance appeared open until all five incumbents
> proved sales-led, "four publish no price at all"** ([[landscape-mapper]] §2).
> **Not empty — priced invisibly.**

Same five vendors, same "four of five publish no price", same niche. The plan presents
as the opportunity the precise fact the wiki records as the canonical instance of the
thin-niche fallacy. That is not a difference of interpretation; the plan reached the
conclusion the wiki was written to prevent.

It gets worse on inspection of the two notes §1 *does* cite as "Full market research":

- **`notes/email-tooling-consolidation.md`** (confidence: high) ends: "the niches still
  self-serve and healthy are template builders at *'$10–$30/mo'* undercut by free open
  source ([[landscape-mapper]] §1) — **crowded and below a $49/mo floor.**" It also
  records that the $99–$199/mo tier was *acquired and shut* between 2021 and 2025
  (Litmus "$99 Basic and Plus tiers killed Aug 2025"). The plan's $49/mo target sits
  above where self-serve email tooling has demonstrated it can hold and below where the
  surviving incumbents live. No datapoint sits under it.

- **`notes/email-production-bottleneck.md`** carries an `UNRESOLVED` contradiction whose
  resolution is *exactly this plan's central bet*: demand-miner priced the **labour**
  ("$78 (72hr) / $91 (48hr) / … $395 (2-day)"), landscape-mapper priced the **tools**
  ("Topol $10/mo", "Stripo $20–$125/mo", "Beefree $30/mo"), and the note concludes:
  "Both can hold — people pay for the service because the tools do not do the job —
  **leaving open whether a tool can capture labour spend, with tool prices below the
  $49/mo floor.**" The plan resolves this silently in its own favour and states it as
  settled fact.

- **`notes/open-questions.md`** lists it verbatim as an open question: *"Does the labour
  spend on email production ($78–$395 per outsourced template) convert to tool spend?
  (asked 1×) — would need evidence of a tool capturing per-template outsourcing budget,
  **or a failed attempt to.**"*

- **`sources/decision-log.md:31-33`** already scored this candidate inside the run that
  produced all of the above: *"agency-design-system demand 21/edge 5"* — and that run's
  terminal condition was *"the mission's constraint set has been shown unsatisfiable by
  desk research"*, with three evaluator iterations all `pass=false`.

Three notes bear directly on this candidate and all three are negative
(`thin-niche-fallacy`, `edge-demand-diagonal`, `bootstrapped-email-saas-benchmarks`).
None is cited. The two that are cited say something different from what §1 claims they
say.

**The Mavlers anchor is also misused.** "$4,999, flat, 6–7 week engagement" is evidence
that someone pays for a *service* — a human who performs the migration. Repricing that
outcome at $49/mo is asking the buyer to pay 1/100th and do the work themselves. It is
evidence for consulting revenue; it is used here as a pricing anchor for self-serve SaaS.
That is the labour→tool conversion the wiki explicitly marks unproven.

**This does not mean don't build it.** It means: the plan should say, in §1, "this is an
attempt to falsify `edge-demand-diagonal` and to resolve the `UNRESOLVED` on
`email-production-bottleneck`; the wiki's prior is that it fails; here is the cheapest
experiment that settles it." Reframed that way the plan is honest and the sequencing in
Q5 falls out of it naturally. As written, it reads as a decision that has already
laundered its own counter-evidence.

---

## Problem 2 — There is no product here. There is an editor.

Grep across all three planning documents:

| term | PLAN | api.md | propagation.md |
|---|---|---|---|
| signup / sign-up | 0 | 0 | 0 |
| login | 0 | 0 | 0 |
| stripe | 0 | 0 | 0 |
| billing | 0 | 0 | 0 |
| subscri* | 0 | 0 | 0 |
| pricing | 0 | 0 | 0 |
| onboard* | 0 | 0 | 0 |
| hosting | 0 | 0 | 0 |

`.plan/api.md` §0.2 states it outright: *"I am **not** recommending building auth now."*

What is actually in the repo: `src/db/schema.ts` is `templates` plus a `settings`
singleton — 32 lines, no user, no account, no org. `better-sqlite3`, one file on disk.
`OPERATIONS.md`: *"No accounts, no auth — `localhost` by default"*, *"Do NOT expose to
the public internet"*, rate limit *"per IP"* and *"process-local"*.

**Brands are not tenants.** §7 as scoped adds a brand axis to a single-user localhost
app. When §5–§8 land complete and perfect, what exists is a *multi-brand single-user
local application that cannot take money.* The stated 8-week goal is "first paying
customer."

Between "§5–§8 complete" and "a stranger's card is charged" sits: accounts, session
auth, org membership and invites, Stripe Checkout plus webhook handling, a hosted
deployment that is not a SQLite file on one node, password reset, transactional email,
a marketing page, a signup funnel, and a decision about who pays the Anthropic bill.
On a part-time budget that block is comparable in size to everything §4–§8 covers. The
plan allocates zero weeks to it and never names it.

Two live consequences that are not footnotes:

- **Token economics.** `ANTHROPIC_API_KEY` is a single server env var,
  `defaultModel` is `claude-opus-4-7`, rate limit 60/hour/IP. At $49/mo, one
  enthusiastic user costs more in tokens than they pay. BYO-key or a hard usage cap is a
  v1 decision, not a v2 discovery.
- **A present-tense hole.** `.plan/api.md` §0.4: `README.md:13` promises an
  `Origin`/`Host` check for DNS-rebinding/CSRF defence, and
  `grep -rn "Origin\|Host\|csrf\|cors" src/server/` returns nothing. Any page the user
  visits can `fetch()` `127.0.0.1:5174` and read or delete every template. ~15 lines to
  fix. Cheaper and more urgent than the mjml bump.

---

## Problem 3 — The asset being preserved may be a liability, and §9 missed the biggest stale doc

`PLAN:41` values `src/shared/blocks` at 2,620 LOC: *"Keep — the MJML engine, the
expensive part."* Check its provenance:

- `git log` → **one commit**, `d9c10ad init`. There is no history to inspect.
- Phase 0's own finding: `node_modules` absent, suite never run, 42 failed / 167 passed
  from a clean clone.
- `OPERATIONS.md` claims *"175 server-side tests green"* and an 8-phase frontend rewire
  citing `.omc/plans/ralplan-frontend-rewire.md`, which does not exist. §9 caught this.
- **§9 did not catch that `README.md` describes an entirely different application.**
  Verified: no `src/cli.ts`, no `start` script (`scripts` are
  `setup, dev, test, typecheck, db:generate, db:migrate`), no `workspace/` directory, no
  `ws` dependency, no WebSocket, no `POST /api/query`, no `MJMLState`. The README
  documents `npm start`, `tsx watch src/cli.ts`, `--dangerously-skip-permissions` inside
  `./workspace/`, and token streaming over `/ws`. None of it is in this repo.
  `.plan/api.md` §0.4 found this; `PLAN §9 "Stale documentation — corrected"` lists only
  the `types.ts` TODO and the OPERATIONS.md drift.

So the section whose entire job is enumerating the traps is incomplete on the first file
anyone opens. That is a calibration signal about §2's "measured" inventory generally.

The pattern this adds up to: generated scaffolding whose own documentation describes
software that was never in it, carrying a compounding data-corruption bug (§0.2), a
parse gate that mangles legal MJML, a 738-LOC untested heuristic tokenizer, and a
fidelity claim resting on six hand-written single-line examples. Calling that "the
expensive part" and preserving it around is sunk-cost reasoning wearing asset
valuation's clothes. The question §2 never asks — **is `parse → mutate → serialize` over
a bespoke MJML AST the right substrate at all, versus generating templates from
components and never round-tripping foreign MJML?** — turns out to be the question that
dissolves the §10.1 blocker. See Q2.

---

# The five questions

## Q1 — Is Phase 0 correctly scoped, or is it a trap?

### The case for cutting

**0.2 (entity double-escape) is not urgent, only important.** The plan calls it "live
data corruption." There is no live data: one commit, no deployments, no users, no
corpus. It is a bug that *will* corrupt data once someone uses the product. It must be
fixed before propagation *ships*, not before propagation is *built*. It is ~30 lines
(`parser.ts:185` and `serializer.ts:17-29` made inverses, minding the deliberate
double-escape at `headEdit.ts:59-61`) and a fix is already proven in
`.plan/scratch/probe3.test.ts`. Cheap — but its stated urgency is rhetorical.

**0.4 is the trap, and it is the whole reason to be suspicious of Phase 0.** The plan
proposes to bump mjml 4→5, which "may change render output" and which §9 says "will most
likely break" `stampPaths.ts` — 738 LOC of MSO-conditional-comment-aware tokenizer doing
right-to-left offset splicing against mjml 4.18's *exact* emission, with matchers like
"a `<td>` whose first inner tag is a `<p>` with `border-top:`", no direct test, and a
failure mode that is a silent skip into `missing[]`.

Now look at what the three advisories actually mean **for this app, today**:
html-minifier ReDoS during a build-time compile of the deployer's own MJML;
fast-xml-parser comment/CDATA injection parsing the deployer's own MJML; an `ai`
whitelist bypass in a single-user localhost tool. All three require attacker-controlled
input. The only input source today is the sole user, on loopback. **These become
mandatory the day you are hosted and multi-tenant, and they are not load-bearing before
it.** They belong in the same block of work as auth and hosting.

And the sequencing argument is brutal: the plan has you bump mjml, break a 738-LOC
untested heuristic tokenizer, and spend an unbounded number of part-time evenings
repairing a *canvas click-overlay* — before a single line of the actual product exists
and before anyone has seen it. That is the single most likely way this project dies:
eight weeks spent, no product, and the last three of them on selection highlighting.

### The case against myself

- Phase 0's real argument is not "bugs are bad." It is: propagation is an unattended
  fleet-wide rewrite, and the thing being sold is *trust that it will not wreck client
  templates*. If the one demo corrupts the agency's `?utm_source=x&utm_medium=y`, there
  is no second meeting. That is real and it is the correct instinct.
- **0.3 is the cheapest bug-finder in the entire plan** and I would not cut a line of
  it. `assertRoundTrip` is already written (`roundTrip.ts:69`) with zero call sites;
  `fast-check` is already a devDependency. Call sites plus an adversarial corpus is an
  afternoon. The plan's own diagnosis is that the entity bug survived *because* this
  test did not exist. Cutting it re-arms exactly the defect class that is fatal to the
  pitch.
- The mjml argument cuts back at me: absorbing a render-output change with zero users is
  free; absorbing it with five paying agencies is an incident. If you are definitely
  taking it, earlier is cheaper.
- Agencies handle client brand assets. "We run a version with a published advisory" is a
  bad answer in a sales conversation, even a self-serve one.

### Verdict

**Correct discipline in 0.1 and 0.3, defensible in 0.2, and a trap in 0.4.**

- **Keep 0.1** (test bootstrap — the repo does not build; this is not Phase 0 work, it
  is table stakes).
- **Keep 0.3, and do it FIRST**, before 0.2. It is what tells you whether the entity fix
  is actually right and whether a dependency bump is safe. Writing it before the fix it
  validates is the whole point.
- **Keep 0.2**, verified by 0.3.
- **Cut 0.4 down to at most `fast-xml-parser`**, and take even that only if it is clean
  under the new property test — which the property test will tell you in minutes, since
  it is directly in the parse path.
- **Defer mjml 4→5 and `ai` 4→5 explicitly, with a written trigger:** take them in the
  same block as auth and hosting, the week before the app is first exposed to a
  non-you user. Write the trigger into the plan so it is a deferral and not a forget.
- **Add the ~15-line Origin check** (Problem 2). It is cheaper than any bump and
  strictly more urgent.
- **Add the `useTemplate.ts:306-312` 409-drops-unsaved-work fix.** `.plan/api.md` grades
  it "M, and non-optional" and notes "the first bug report will not say 'propagation',
  it will say 'the editor lost my changes'." `PLAN §10.4` mentions the concurrency risk
  but not that the existing conflict handler *discards the user's work*. That is a
  Phase 0 item, not a §10 risk.
- **Do not repair `stampPaths.ts` if something breaks it.** It drives canvas click
  selection. That is editor polish, not the product. Ship with the overlay degraded and
  a banner.

**Timebox the whole of Phase 0 to one calendar week of part-time evenings** — roughly
15–20 hours for 0.1 + 0.3 + 0.2 + Origin + the 409 fix. If it runs over, something in it
was 0.4 in disguise.

---

## Q2 — Is the mj-wrapper blocker fatal?

**The plan understates it, and the option nobody has put on the table is the right one.**

### First: it is worse than §10.1 says

§10.1 names `mj-wrapper`, `mj-hero`, `mj-navbar`, `mj-raw`. The propagation lane's own
D4 (`.plan/propagation.md:152`) found the larger half:

```
RICH TEXT node kind: passthrough
<mj-text data-cmp="brand/copy"><p>Hello <b>world</b></p></mj-text>
```

Any leaf with element children demotes (`parser.ts:435-446`). D4's own words:

> Two of the seven modeled block types are `contentField: "text"` leaves whose realistic
> authored form has inline HTML. **This is not an edge case. It is the main case for
> copy blocks.**

So the reachable surface is not "templates that avoid `mj-wrapper`." It is "templates in
which no copy block contains a `<b>`, an `<a>`, or a `<p>`." Against real agency MJML
that is approximately none.

**Therefore option (a) — "model wrapper as a real container" — is a false fix, and it is
the most dangerous item in the plan** precisely because it *looks* like a resolution. It
addresses maybe a third of the demotion paths and leaves the main case broken. Whoever
implements (a) and ships will hit "0 instances found" on the first real template, having
already spent the parser work.

Option (b), operating on `rawXml` slices, is string surgery on unparsed XML to implement
a feature whose entire promise is "this will not break your templates." No.

Option (c), detect-and-refuse, is **mandatory regardless** — §10.1 is right that silent
success is the one unacceptable outcome, and `.plan/propagation.md` correctly makes
`opaque` a first-class instance status rather than an error. But refusal is not a
strategy. A product that declines most of its inputs is not a product.

### The option nobody has considered

**Make imported-template propagation a non-goal for v1. Templates are authored in the
component system, or they are not in the system.**

You compose a template from components you defined. The tool owns the MJML it emits.
Therefore every node is stamped, modeled and reachable *by construction* — because your
serializer wrote it. Propagation over a corpus you generated is a tractable engineering
problem. Propagation over arbitrary hand-authored MJML is a parser research project with
no defined end.

What this buys immediately:

- **D4 evaporates for the v1 surface.** The parser only ever has to round-trip its own
  output — which is exactly what the 0.3 property test can guarantee, and exactly what
  the current parser is already closest to doing.
- **`allowedChildren` stops being a bug and becomes a spec.** It was written as a
  drag-and-drop palette rule. Used as a palette rule, it is correct. The plan currently
  calls it "a drag-and-drop palette rule used as a parse gate" — that is only a defect
  under the arbitrary-MJML assumption.
- **§10.2 dissolves for free.** "The first diff on any template is a whole-file
  reformat" cannot happen if every template was already emitted by your serializer.
  That is the audit's mitigation (a) obtained as a property of the model rather than as
  a one-time migration with its own review.
- The `data-cmp-own` / `data-cmp-h` / `data-cmp-slots` machinery survives intact, but
  its job narrows to *detecting hand edits to your own output* rather than
  *comprehending foreign MJML*. Much smaller problem, same design.

**The honest cost:** the agency cannot bring their existing 40 templates. That is a real
onboarding cliff and the plan must state it as a product boundary. But weigh it against
the alternative: with `mj-wrapper` and rich text unsolved, **they cannot bring their
templates anyway** — they simply discover it later, after paying, on a screen reading
"0 instances affected." An explicit boundary is strictly better than an undisclosed
defect.

And the import path need not be zero. "Paste your existing template, we render it, you
rebuild the repeated parts as components" is a one-time chore an agency will perform for
its top three templates if the payoff is real. **You can also sell that chore** — a flat
setup fee to do the conversion for them is the Mavlers motion at 1/10th scale, and it is
the only form of the Mavlers datapoint that is actually evidenced (see Q3).

**So: `mj-wrapper` is not fatal. The assumption that this tool must operate on arbitrary
existing agency MJML is what is fatal** — and that assumption is load-bearing in §10.1,
in D4, and in the api lane's copy-model reasoning. Remove it and three of the plan's
hardest problems leave with it.

**Do D4's measurement anyway** — "take ten real agency templates and count modeled vs.
opaque nodes" — but run it as market research, not as a build gate. It is one hour and
it sizes the onboarding cliff, which is a number you need for the sales conversation
either way.

---

## Q3 — Is the pivot sound? Is $49 self-serve fantasy?

Split the question. The **observation** is sound and well-evidenced: modular reuse fails
inside the tools built to solve it, corroborated by three independent reviewer sets
(Knak, Beefree, Chamaileon) in `notes/email-production-bottleneck.md`, with Mavlers
selling the fix as a service. Nobody should argue that the pain is fake.

The **business** has three problems, and the wiki documented all three before the plan
was written.

**1. The price floor has no datapoint under it.** `email-tooling-consolidation.md`
(confidence: high): healthy self-serve email tooling lives at "$10–$30/mo", undercut by
free MJML / React Email / Maizzle — "crowded and below a $49/mo floor." The $99–$199
tier was *acquired and shut down* between 2021 and 2025. $49/mo is the dead zone: above
where self-serve email tools have shown they can hold, below where the surviving
sales-led incumbents operate. The plan chose a price because it is the founder's
constraint, not because anything in the research supports it.

**2. Self-serve is in direct conflict with the product.** The incumbents are sales-led
*because this buyer requires onboarding*. An agency does not adopt a design system by
swiping a card; it adopts one by migrating 40 templates and retraining three people. The
value appears only *after* the migration — and the migration is precisely what v1 cannot
do (Q2). "No enterprise sales" and "a workflow product for agencies" are not compatible
constraints at 8 weeks. That is not pessimism, it is what the "four of five publish no
price" datapoint means.

**3. The clock is off by an order of magnitude.**
`bootstrapped-email-saas-benchmarks.md`: "12–36 months to $10K MRR"; EmailOctopus ~2
years to ramen profitability and ~10 to $3M; Parseur "~9 years... won via SEO + Zapier
directories"; base rate "50% of active indie hackers are under $1K/mo". All of them
"won on marketing and endurance, not technical depth." The plan has 8 part-time weeks
and no distribution section at all.

**Is $49 fantasy?** Not the number — the *shape*. $49/mo self-serve, for a workflow tool
with a migration cliff, from a founder with no audience, in 8 part-time weeks, is
fantasy. The same $49/mo as the second thing an existing audience buys is ordinary.

### The smallest thing that could actually be sold

**Not a SaaS. Sell the migration, productized, with the tool as private delivery
leverage.**

Mavlers sells a 6–7 week engagement at $4,999. You offer: *"Send me your five
most-used templates and your brand rules. You get them back as a component library plus
a tool where changing the button changes all five. Flat fee, two weeks."* Price it well
under Mavlers — you are one person and the deliverable is narrower.

What that requires: the component model, the propagation engine over templates *you*
authored (Q2's scope), and a dry-run diff you can read in a terminal.

What that does **not** require: auth, accounts, Stripe, billing, hosting,
multi-tenancy, signup, onboarding, a brand-scoped API refactor, or mjml 5. **That
deletes the entire missing half of the plan (Problem 2) out of the 8-week window**, and
most of `.plan/api.md` with it.

And it answers the one question the wiki names as blocking on this candidate — *does
labour spend convert to tool spend?* Three paid migrations tell you whether these people
want the tool, and every respondent is pre-qualified because they already paid. If two
of three ask "can I keep using this myself?" — that is your self-serve signal, and
*then* you build accounts and Stripe, funded, with a customer list and a specification
written by customers.

If the founder rejects services outright (time-for-money trap — fair), the fallback with
the same information and worse economics: build the tool, then do one agency's migration
free in exchange for design-partner access and a case study.

**Either way, the 8-week goal should be restated as "one agency's templates are running
on the component system," not "the SaaS is live."** The current goal is not reachable
and its unreachability is not the plan's fault — it is the goal's.

---

## Q4 — What is missing from the plan entirely

Ordered by how much damage the omission does.

1. **Money.** Zero mentions of signup, login, Stripe, billing, subscription, pricing,
   onboarding or hosting across all three documents. Nothing in §5–§8 covers it. Largest
   single omission. See Problem 2.

2. **Who the first customer is and how you reach them.** No distribution section
   anywhere. The wiki already has the answer and has been asking for two runs —
   `notes/open-questions.md`: *"What do email practitioners complain about in Email
   Geeks Slack? (asked 2×) — would need a member inside the workspace; '~28.9k members,
   Slack-only', not publicly archived. **The one demand source never reached, in the
   industry the operator works in.**"* The founder works in email. Joining is free and
   is the single highest-value hour in this entire plan. It is not in the plan.

3. **Import.** How does an existing agency template get in? Q2 turns this into a product
   boundary rather than a feature, but either way it is unaddressed and it is the first
   question a prospect asks.

4. **Export and lock-in.** No agency puts client work into a one-person tool without
   knowing it can get out. "Download every template as MJML and compiled HTML" is cheap
   and is a *sales* feature, not a nice-to-have. Absent entirely.

5. **Undo. There is no rollback for a propagation run.** The plan has a dry-run and
   §10.4 covers concurrency; `.plan/propagation.md` §4 covers *partial application*
   (the run failed halfway). Neither covers *the run succeeded and was wrong*. The only
   versioning is `templates.version`, an optimistic-lock integer — no snapshot table, no
   restore. A batch rewrite across N client templates with no rollback is the scariest
   thing in the whole design and the fix is cheap: write a `template_revisions` row for
   every template a propagation touches, plus one-click "revert this run."
   **Non-negotiable, and it is also a sales feature** — it is the answer to "what if it
   breaks my client's template."

6. **Manual escape hatch.** "Detach this instance from its component, permanently" and
   "edit this template's raw MJML directly." The `locked`/`default`/`slot` model implies
   them; nothing names them as user-facing operations. Agencies need the escape hatch in
   order to trust the cage.

7. **Backup.** `OPERATIONS.md` documents a `sqlite3 .backup` one-liner for a local file.
   There is no hosted backup story because there is no hosted story.

8. **Who pays for tokens.** `ANTHROPIC_API_KEY` as a single server env var,
   `defaultModel: "claude-opus-4-7"`, rate limit 60/hour/IP and process-local. At
   $49/mo one heavy user is unprofitable. BYO-key or a hard cap is a v1 decision.

9. **The present-tense CSRF hole.** `README.md:13` promises an `Origin`/`Host` check;
   `grep -rn "Origin\|Host\|csrf\|cors" src/server/` returns nothing. Any page the user
   visits can read or delete every template. ~15 lines.

10. **The 409-drops-unsaved-work bug** (`useTemplate.ts:306-312`). `.plan/api.md` grades
    it "M, and non-optional" — a pre-existing bug this feature promotes from theoretical
    to routine. §10.4 names the concurrency risk but not that the conflict handler
    *discards the user's edits*.

11. **Stamp survival through the AI pane is unmeasured, and §3 overstates its own
    verification.** §3 declares "The core technical assumption — VERIFIED" and "Proceed
    with attribute stamping. It is the foundation of everything below," on the basis of a
    *parser* round-trip. `.plan/propagation.md` §8 says the quiet part:

    > I did not verify the AI pane's actual stamp-preservation rate... **the single
    > largest uncertainty in the design** — everything in §1 rests on stamps surviving
    > the rewrite path. Measure it before committing to attribute-based identity: if
    > preservation is below ~95%, the comment-marker and side-table options deserve
    > reconsideration.

    The parser preserves stamps. **The LLM is the thing that might not**, and §10.3
    concedes `promptBuilder.ts:120` actively feeds Claude an attribute vocabulary that
    excludes `data-cmp`. That is a two-hour experiment — 20 real templates, one AI
    rewrite each, count surviving stamps — and it gates the entire identity model. §3's
    "VERIFIED" should be downgraded to "verified through the parser; unverified through
    the LLM" until it is run.

---

## Q5 — Sequencing: is the dry-run diff really the demo?

**No.** The dry-run diff is the screen that *closes* the sale. It is not the cheapest
proof of value, and it cannot come first because it presupposes the entire engine behind
it — identity, override model, splice, conflict detection, normalization — before
anything is visible.

The cheapest proof of value is a **before/after on the prospect's own templates,
produced by any means including by hand.** An agency owner does not need a diff UI. They
need: here are your five templates; I changed the button definition once; here are five
re-rendered previews. If that does not make them lean forward, no amount of diff UI will.

### The order I would actually build in

**Week 0 — half a day, before any code.** Join Email Geeks Slack and read for the
modular-reuse complaint. This is the only step that de-risks Problem 1, and the wiki has
flagged it twice as the one demand source never reached.

**Week 0 — two hours.** The stamp-survival experiment through the AI pane (Q4 item 11).
It can invalidate §3, and §3 is described as "the foundation of everything below."

**Week 0 — one hour.** D4's measurement: ten real agency templates, modeled vs. opaque
node counts. This sizes the onboarding cliff and tells you whether Q2's scope decision
is a boundary you are choosing or a defect you are hiding.

**Week 1 — Phase 0, reduced and timeboxed.** 0.3 (property test, written first), then
0.2 (entity fix, validated by it), on top of 0.1 (bootstrap), plus the Origin check and
the 409 fix. No mjml bump. One calendar week.

**Weeks 2–4 — the vertical slice, scoped to tool-authored templates only.** One
component ("primary button"), stamped; materialized into three templates the tool
generated; one propagation run; the diff printed **to the terminal**. No UI. No brands
table. No API refactor. No auth. The deliverable is a working `propagate()` you can run
on your own machine.

**Week 5 — the first migration, by hand, for one real agency.** You convert their
templates. You run the terminal tool. You hand back rendered proof. Paid if possible,
free for a design partner if not.

**Weeks 6–8 — build whatever that agency asked for while you sat with them.** If they
ask to run it themselves, you now have a funded, specified reason to build the UI, the
brands schema, auth and Stripe — and you know which of §5–§8 was speculative.

### What this defers, deliberately

The brands/components/tokens schema and the whole `.plan/api.md` route refactor —
which by its own §7 effort table is the largest block of work in the plan
(S–M + S + M + M + S + M + M–L + M + ...), and which exists to serve a multi-brand
scoping dimension that a single hand-run migration does not need. Plus the UI lane
entirely, plus the dep bumps.

### The one inversion I would make to §4

§4 says: *"Nothing in §5–§8 may start before this lands."* I would add a second gate
above it: **nothing in §5–§8 should start before one real agency has tried the component
model at all** — because §5–§8 is a large bet on an override model that
`.plan/propagation.md` §8 itself calls:

> **The override model is a guess about how agencies work.** ... If the real workflow is
> "the brand file is law, template edits are mistakes", then `locked`-everything is right
> and all this machinery is overhead. **I have no evidence either way and neither does
> the codebase.**

Building three-way merge, declared ownership, hash-based conflict detection and a
per-instance override protocol before knowing which of two workflows is real is the
expensive version of a coin flip. The same lane names the cheaper path and it should be
promoted into the plan: *"infer the initial policy set from observed variance across
existing instances — attrs that vary are `slot`, attrs identical everywhere are
`locked`."*

---

## Summary of changes I would make to the document

1. **Rewrite §1** to state the pivot as a falsification experiment against
   `edge-demand-diagonal` and the `UNRESOLVED` on `email-production-bottleneck`, citing
   `thin-niche-fallacy.md`, and naming the wiki's prior (negative). Remove the
   "four of five publish no price" line as evidence *for*, or keep it and address what
   the wiki says it means.
2. **Add a §11 "Path to revenue"** covering accounts, billing, hosting, token
   economics — or, better, adopt the productized-migration route in Q3 and state
   explicitly that v1 takes no money through software.
3. **Change §10.1's framing** from "a blocker with three mitigation options" to "a
   product scope decision": v1 propagates only tool-authored templates. Add the rich-text
   demotion from D4, which is the larger half and is currently absent from §10.1.
4. **Downgrade §3 from "VERIFIED"** to parser-verified / LLM-unverified, and make the
   two-hour AI-pane stamp-survival measurement a gate on it.
5. **Move the mjml and `ai` bumps out of Phase 0** into a named "before first external
   user" block with a written trigger. Move the Origin check and the 409 fix in.
6. **Add propagation rollback** (`template_revisions` + revert-a-run) to §6's
   requirements. It is the answer to the objection every agency will raise.
7. **Add the README to §9's stale-documentation list.** It describes a different
   application, and §9's job is to be the complete list of traps.
