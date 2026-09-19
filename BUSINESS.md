# The business

You sell a **one-time repair job**, not software. It runs on your laptop.

---

## 1. The problem

An agency has 40 email templates. The same footer, header and button are typed
out separately in all 40 files.

When something changes — address, logo, legal line, button colour — a developer
opens 40 files and retypes it 40 times. Two days. That happens about 5 times a
year.

**~10 developer-days a year, forever.** They are already paying this bill; it
just never arrives as an invoice.

---

## 2. The fix

Say what to change. It finds every place that thing lives, edits only the span
that carries it, and shows you the before and the after.

    you say    find: company address → replace with: 456 New Street
    it finds   the address in 37 of the 40 files, and names the 3 it did not match
    it edits   56 bytes inside a 1,738-byte block — nothing else in the file moves
    it proves  before/after renders, checked by a Luna verdict and by OpenCV

Two days becomes an afternoon, and the files come back as ordinary HTML.
Nothing is restructured. There is nothing for them to adopt, and nothing of
yours left behind for them to undo.

**The edit is anchored, not searched-and-replaced.** Every change is tied to an
exact parsed source span and replayed against the original file, and applied
only where it matches a file *uniquely* — a file with two candidates goes back
to the loop instead of being edited on a guess. A batch publishes
all-or-nothing: one file left in review and nothing ships. That
has already paid for itself — on the real Delta button run it stopped an edit
that would have dropped two style declarations.

---

## 3. Where it happens

**Your laptop.** No servers, no hosting, no accounts, nothing deployed.

    they email you .html files
      → you work in a folder locally
      → you zip it back and invoice

This is why the missing login/billing/hosting is not a gap — the business never
needs them. Cost to deliver: metered GPT-5.6 Luna API usage plus local labor.

Their templates sit on your disk. Pattern extraction and visual validation send
bounded HTML/capture inputs to the OpenAI Responses API; exact edits, files,
Playwright rendering, and OpenCV matching remain local. `./workspace/`
**persists between runs** — wipe it between customers.

**Ceiling:** one person, one laptop, one batch at a time.

---

## 4. What you hand over

    shoe-brand/
      *.html                  their emails, with the change applied
      log.md                  each change: the span, the from, the to, and
                              which files it covered
      changes/001-….mjs       the script that made that edit, re-runnable
      progress.json           what has been processed

    artifacts/                kept separate from anything you deliver
      captures/before|after/  the renders every verdict was made on
      evidence.jsonl          each validation decision, in order

They get their own files back — ordinary HTML, minus the thing you changed. So
there is no "what if we hate it" conversation to have.

**`log.md` sells the job.** It reads as a receipt, down to `span: 56 bytes (3.2%
of the element)` and a per-file coverage table. The files it could *not* match
sell the next one: those are usually the ones that drifted.

**The demo:** ask for a real change they need. Run it in front of them. Minutes,
for something that used to take two days.

---

## 5. Intake — ask

**Ask them first:** *"Which blocks are the same across all your emails?"*

Costs nothing, and it tells you what they **care** about — which is not the same
as what actually repeats. If they say "honestly, just the footer", that is a
smaller, cheaper job and you should quote it that way.

**Do not take the answer at face value. They will be wrong in both directions:**

- **Wrong about sameness.** "The footer is identical in all 40." It's in 37 —
  three still say the old address because someone missed them last time.
  **You just found a live bug before doing any work.**
- **Blind to the boring repeats.** Nobody mentions the preheader, the spacer row,
  the social strip, the "view in browser" line. All identical, all stale in the
  same way, all fixable in one pass.
- **They think in emails, not in the thing that repeats.** "What's shared?" gets
  you "our branding", not "the address, the CTA colour, the legal line".
- **They may not have written them.** A marketing manager has no idea what is in
  the MJML.

**Open the quote with the gap between what they said and what you found:**

> "You said the footer was the same everywhere — it's in 37 of 40, and these
> three still say 123 Old Street. You didn't mention the social strip, but it's
> identical in 31."

That is the moment they stop wondering whether you are worth the fee.

---

## 6. Pricing

**base + (templates × rate).** Not flat, not a rate card, not a subscription.

    JOB 1     $1,200 base      build the component library — paid once ever
            +   5 × $160      rewire each file
            = $2,000

    JOB 2         no base      the library already exists
            +  35 × $100      rewire
            +   9 × $120      NEW components the first 5 never revealed
            = $4,580

**Never quote 40 templates as a first job.** Same formula gives ≈$7,600 — that
needs a meeting and a decision-maker from someone who's never seen your work.
Quote five: $2,000 is a yes on the spot, and afterwards you know their real
per-template rate.

**Never quote a second batch you haven't counted.** Their other 35 files contain
blocks the first 5 never had. Count them first, then quote:

> "$100 per template, plus $120 per new component beyond what we already built.
> I'll give you the exact number before we start."

**A different brand = a full base fee again.** One agency running 6 clients is 6
libraries, not one.

### Why not monthly

- Tools in this category sell for $10–$30/mo, with free MJML / React Email /
  Maizzle underneath. Too cheap to live on.
- Unbounded hosted AI usage can exceed a low monthly tool price. You would lose
  money if usage were bundled without limits.
- There is no login, billing or hosting in the repo. You couldn't charge monthly
  this month if you wanted to.

---

## 7. Your economics — the uncomfortable part

    customer A job 1    10 days   $2,000   =  $200/day
    customer A job 2     7 days   $3,500   =  $500/day
    customer B job 1     3 days   $2,000   =  $667/day

**The first migration is barely worth doing for the money.** You do it because it
pays you to find out whether the business exists, and because it's what makes
the next one fast.

The customer keeps everything — templates, components, even the plain export so
they can walk away. **The only thing that stays with you is the tooling.** If
migration #3 takes as long as #1, you're freelancing and the repo earned nothing.

---

## 8. After the job — four emails

| they send | it means | you do |
|---|---|---|
| "Thanks, all good." | they have a developer | nothing. find customer #2 |
| "Do the other 35?" | it worked | quote it (see §5) |
| "Can you change the footer for us?" | they won't touch a terminal | do it, then offer a retainer |
| **"Can our team get a screen?"** | **the only blocker is the UI** | **build that, nothing else** |

**Retainer wording, if it comes up:** *unlimited component edits and rollouts
across your existing migrated templates.* Never "unlimited changes" — they can't
tell a 30-second pin bump from a 2-day new template, so you have to.

**Careful:** while you run changes for them, they never ask for the screen. Taking
that money costs you the answer you were buying.

### The decision, after three migrations

- **Two of three ask for a screen** → build it. Funded by their fees, specified
  by people who already paid.
- **Nobody does** → no monthly business here. Three paid jobs and a real answer,
  for three weeks instead of two months building login and billing for nobody.
- **Mostly retainers** → the retainer *is* the business. Go sell more. Fine
  outcome — just notice you're in it rather than drifting there.

---

## 9. What is actually built

### The repo is now one product

It was built as an **AI email designer** (canvas, drag-and-drop, Claude pane) on
top of an MJML parser. Those went first: `web/` was deleted in `0856b63`, and
`src/shared/blocks` — 1,964 lines of MJML parse/serialise — went with the switch
to raw HTML. The `<x-component/>` engine and its `handover` delivery step have
now gone too. They solved this problem by restructuring the customer's emails
into components they would have to adopt. What replaced them solves it without
touching how their emails are written.

| part | lines | for this business |
|---|---|---|
| `src/{patternAgent,patternWorkflow,patternLoop}.js` — discover a shared pattern, apply it, loop | 687 | **core.** this is the product |
| `src/htmlTargets.js` — exact source spans, safe replacement, model-facing views | 263 | **core.** every edit is anchored here |
| `src/{visualValidation,imagePresence}.js` — Playwright captures, OpenCV containment | 338 | **core.** this is what makes a change provable |
| `src/{itemResolver,partExtractor}.js` — request to item, item to element | 108 | the front of the flow |
| `src/{index,luna}.js` — the CLI and the Responses API client | 204 | plumbing |
| `dev/*.js` — one command per phase, runnable alone | 551 | how you inspect and debug a phase |

`src/` is plain JavaScript. There is no product server, API, or `web/`. Playwright
rendering exists only as a local validation step for batch edits.

### The proof is now the product

The old pipeline proved delivery: `handover` sha256'd the expanded bytes against
`originals/` to show nothing had changed. That only ever proved the *machinery*
was faithful, because the customer's own edit was made by hand upstream.

This one proves the **edit**. Every change is anchored to an exact parsed span
and replayed against the original source, then rendered before and after and
checked two ways — a Luna verdict on the captures, and OpenCV containment of the
changed region against the first file that passed. Neither signal can publish
alone, and one file left in review suppresses the entire batch.

That is a stronger claim than the one it replaces, and it has already been
earned: on the real Delta button run, Luna passed a file that OpenCV caught, and
nothing shipped. The edit would have dropped two style declarations.

### Works today

- `node src/index.js` — asks what you want, then the folders, then runs the loop
  over a directory of emails and writes evidence. Fully specified on the command
  line, it never prompts and stays scriptable
- resolve a free-form request to the item it refers to, and fail closed when the
  email contains no such thing
- extract the smallest element carrying any item: visible text, a button label, an
  `alt` value, a link, a colour
- iterative pattern discovery from the first matching pair, exact source-span
  application across every file it uniquely matches, and return of failures to
  the loop with the evidence attached
- Playwright before/after captures, Luna visual verdicts, OpenCV tri-state
  containment, and an all-or-nothing publish staged through a rename
- `dev/validateExtractCommand.js` — the `validation.md` scenario matrix, offline
  for free or live against the API
- 62 automated tests over the loop, exact source edits, OpenCV matching, the
  visual-validation gates, prompt construction, and the CLI

### Not built

- the middle of `FLOW.md`: creating a new element from the extracted pattern and
  replacing the old one with it, as a phase you can run and inspect on its own.
  The workflow applies edits in place today; it does not build a replacement
  element first
- a non-visual change such as an `href` edit cannot reach `pass`, because the
  visual prompt returns `review` for anything a capture cannot show
- persistence of any kind. Every run is self-contained, on purpose, until a real
  agency has used the model
- auth, billing, hosting, multi-brand

**Build next:** the two `FLOW.md` steps above. They are what turns this from a
tool that edits emails into one that builds the replacement and proves it.

---

## 10. Which numbers are real

**Real:** Mavlers sells the equivalent design-system build at **$4,999 over 6–7
weeks** — your only hard anchor, and why $2,000 in 2 weeks reads cheap and fast
rather than suspicious. Competitor tool prices ($10–$30/mo) and the killed
$99–$199 tier are researched.

**Invented by me, for shape only:** $1,200 base, $160 and $100 per template,
$120 per component, $150/mo retainer, $500 developer-day, 5 changes a year.

Replace them after migration #1 with what it actually took.

---

## 11. The open question this is all built to answer

Nobody knows whether agencies would pay *monthly* for this — not you, not your
research. `../business-ideas/notes/email-production-bottleneck.md`, in the
separate wiki repo, marks it UNRESOLVED: demand is measured in *labour*
($78–$395 per outsourced template), supply in *tools* ($10–$30/mo), and nothing
shows the first converting into the second. `open-questions.md` beside it
carries the same question and already names three paid migrations as its route,
"Unstarted".

**Those two notes are not a second opinion.** This plan's reasoning came from
them, and the bottleneck note now cites this plan back — it says so itself: *"the
source's own reasoning is derived from this page, so it carries no evidential
weight in either direction."* The question being open in both places is one
belief recorded twice, not two findings agreeing. Nothing outside your own head
has tested it yet.

**Which is the point. Three paid migrations answer it, and you get paid either
way.**
