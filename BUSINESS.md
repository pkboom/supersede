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

Move each repeated block into one file, and leave a note in its place.

    before   <tr><td><p>Shoe Brand · 123 Old Street</p></td></tr>
    after    <x-component component-id="shoe-brand/footer" revision="1" />

Before sending, a program reads each note, fetches the block, and pastes it in.
Out comes ordinary HTML — **byte-identical to what they had**. Nobody can tell
anything changed.

What changed is the price of the *next* change: one edit instead of forty.

**Versions are explicit.** Publishing footer v2 changes nothing — templates still
pin `revision="1"`. Expanding against a pin produces the real after-HTML, so you
can read exactly what would change before committing to it. Moving a template to
v2 is one attribute. Nothing ever moves behind their back. (The pin machinery is
in the library; the two commands on top of it are §9 "Not built".)

---

## 3. Where it happens

**Your laptop.** No servers, no hosting, no accounts, nothing deployed.

    they email you .html files
      → you work in a folder locally
      → you zip it back and invoice

This is why the missing login/billing/hosting is not a gap — the business never
needs them. Cost to deliver: your Claude subscription.

Their templates sit on your disk. The app runs `claude
--dangerously-skip-permissions` inside `./workspace/`, which **persists between
runs** — wipe it between customers.

**Ceiling:** one person, one laptop, one migration at a time.

---

## 4. What you hand over

    shoe-brand/
      templates/       their emails, rewired
      components/      each shared block, in one place
      proof/           before vs after — byte-identical
      plain-export/    their emails with everything pasted back in
      HOW-TO.md

`proof/` sells the job. `plain-export/` removes their reason to say no — if they
hate it, their templates work with no trace of your tool.

**The handover demo:** ask for a real change they need. Edit the one component
file. Re-run the handover. Thirty seconds, for something that used to take two
days.

---

## 5. Intake — ask, then scan

**Ask them first:** *"Which blocks are the same across all your emails?"*

Costs nothing, and it tells you what they **care** about — which is not the same
as what actually repeats. If they say "honestly, just the footer", that is a
smaller, cheaper job and you should quote it that way.

**Then scan the files, because they will be wrong in both directions:**

- **Wrong about sameness.** "The footer is identical in all 40." It's in 37 —
  three still say the old address because someone missed them last time.
  **You just found a live bug before doing any work.**
- **Blind to the boring repeats.** Nobody mentions the preheader, the spacer row,
  the social strip, the "view in browser" line. All identical, all extractable.
- **They think in emails, not components.** "What's shared?" gets you "our
  branding", not a list of blocks with boundaries.
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

**Never quote a second batch you haven't scanned.** Their other 35 files contain
blocks the first 5 never had. Count them first, then quote:

> "$100 per template, plus $120 per new component beyond what we already built.
> I'll give you the exact number before we start."

**A different brand = a full base fee again.** One agency running 6 clients is 6
libraries, not one.

### Why not monthly

- Tools in this category sell for $10–$30/mo, with free MJML / React Email /
  Maizzle underneath. Too cheap to live on.
- One heavy user's Claude bill can top $49/mo. You'd lose money as they used it.
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
top of an MJML parser. Both are gone: `web/` was deleted in `0856b63`, and
`src/shared/blocks` — 1,964 lines of MJML parse/serialise — went with the switch
to raw HTML. What is left is what this business actually uses.

| part | lines | for this business |
|---|---|---|
| `src/shared/components` — expander, store, tag scanner, types | 1,380 | **core.** this is the product |
| `src/cli/handover.ts` — publish, expand, prove, export | 192 | **core.** the whole delivery |
| `src/cli/term.ts` — terminal colours | 19 | plumbing |

`src/` is 1,591 lines. There is no server, no API, no `web/`. `proof/` used to
need `POST /api/render`; it doesn't any more, because there is nothing to render.

### The proof got stronger. One guard got weaker.

Before/after used to mean two MJML files pushed through `mjml2html` and the
output compared. Both sides are plain HTML now, so `handover` sha256s the
delivered bytes directly. That is strictly stronger — it cannot be satisfied by
two different inputs that happen to compile the same way.

**The other half of that trade is a real loss.** The MJML compiler was also a
second, independent refusal of an unexpanded reference. Raw HTML has no
compiler, and a surviving `<x-component/>` renders as *nothing* — the email
ships without its footer and nobody is told. That is now caught by a single
`assertNoSurvivors` over the final bytes in `handover.ts`. One guard where there
were two.

### "They want a screen" is not "finish the canvas"

There is no canvas left to reach for, which makes this easier. The screen answer
C asks for is small: list the components, edit one, read the diff, press Apply.
Three screens.

### Works today

- `npm run handover -- <job-dir>` — publishes every `components/**/*.html`,
  expands every `templates/**/*.html`, writes `proof/` + `REPORT.md` +
  `plain-export/`, exits 1 on any failure. `--check` writes nothing.
- expander + throw-on-survivor guard
- `ov-*` per-instance overrides, `data-slot` filling, nesting under a depth cap
- byte-identical before/after against `originals/`. A template with no matching
  original is reported unresolved rather than counted as proven — it does not
  refuse the run
- 97 tests across 3 files, all passing; `tsc --noEmit` clean

### Not built

- a standalone `publish <id> <file.html>` command. `handover` does publish from
  files — no more hardcoded string constants — but into a fresh in-memory store
  each run, so every component is always revision 1 and templates can only pin
  `revision="1"`
- a `scan` command to find repeated blocks across a template folder — *in
  progress*
- the dry-run diff and the pin bump as commands. Both exist as library
  capability (`expand(src, store, { pins })`, tested) with no CLI on top
- persistence — the store is in-memory JSON, on purpose, until a real agency has
  used the model and shaped the schema
- auth, billing, hosting, multi-brand

**Build before migration #2, not before #1:** `scan`, then `publish` and the pin
commands. Nothing else. They are the only things that make the next job faster,
and faster next jobs are the entire return on this repo.

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
