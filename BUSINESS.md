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

    before   <mj-text>Shoe Brand · 123 Old Street · Unsubscribe</mj-text>
    after    <mj-component component-id="shoe-brand/footer" revision="1" />

Before sending, a program reads each note, fetches the block, and pastes it in.
Out comes ordinary MJML — **byte-identical to what they had**. Nobody can tell
anything changed.

What changed is the price of the *next* change: one edit instead of forty.

**Versions are explicit.** Publishing footer v2 changes nothing — templates still
pin `revision="1"`. A dry-run diff shows exactly what would change. Then one
command rewrites one attribute per template. Nothing ever moves behind their back.

---

## 3. Where it happens

**Your laptop.** No servers, no hosting, no accounts, nothing deployed.

    they email you .mjml files
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
      proof/           before/after renders — identical
      plain-export/    their emails with everything pasted back in
      HOW-TO.md

`proof/` sells the job. `plain-export/` removes their reason to say no — if they
hate it, their templates work with no trace of your tool.

**The handover demo:** ask for a real change they need. Edit the component.
Show them nothing has changed yet. Run the diff. Apply. Thirty seconds, for
something that used to take two days.

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

## 9. What is actually built — and what is dead weight

### The repo contains two products

It was built as an **AI email designer** (canvas, drag-and-drop, Claude pane).
The business above does not use any of that. You work in a text editor and a
terminal; the customer receives files.

| part | lines | for this business |
|---|---|---|
| `src/shared/blocks` — MJML parser/serializer | 2,620 | **core.** the scan tool gets built on it |
| `src/shared/components` — expander, guard, overrides | — | **core.** this is the product |
| `POST /api/render` — MJML → HTML | — | **needed** for the `proof/` renders |
| `web/src` — the React canvas editor | 4,707 | **not used** |

### Freeze the canvas, don't delete it

Stop paying maintenance on `web/src`: no test fixing, no mjml-v5 compatibility
work, no browser sign-off. It cost real work and a future screen may reuse parts
of it, so it stays in the repo — it just stops being a thing you owe anything to.

**Consequence:** the 61 failing tests are all `web.*` React tests. They block
nothing. Same for the untested canvas click-selection overlay in `NEXT.md` §4.
Both were on an earlier to-do list of mine; both were wrong.

### "They want a screen" is not "finish the canvas"

The screen answer C asks for is a different, much smaller thing: list the
components, edit one, read the diff, press Apply. Three screens. Do not reach for
the canvas to build it.

### Works today

- expander + throw-on-survivor guard
- `ov-*` per-instance overrides
- dry-run diff, pin bump, bulk export
- `npm run measure` over a template directory

### Not built

- a `publish <id> <file.mjml>` command — today component bodies are **hardcoded
  string constants** in `scripts/component-slice.ts`
- a `scan` command to find repeated blocks across a template folder
- a components table in the DB — it's in-memory JSON, on purpose
- auth, billing, hosting, multi-brand

The server returns **HTTP 422** for any template containing `<mj-component/>` —
no store is wired in. Deliberate: plan §12 scopes the slice to the terminal until
a real agency has used it.

**Build before migration #2, not before #1:** `publish` and `scan`. Nothing else.
They are the only two things that make the next job faster, and faster next jobs
are the entire return on this repo.

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
research. `business-ideas/notes/email-production-bottleneck.md` is marked
UNRESOLVED on exactly this, and `open-questions.md` lists it verbatim.

**Three paid migrations answer it, and you get paid either way.**
