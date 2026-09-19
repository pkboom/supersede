# Interactive flow checklist

The flow `src/cli.js` drives, one change per pass:

```
  put email files in asset/<job>                e.g. asset/delta
  node src/cli.js
<start>
  ask for one change request                    e.g. find the Submit button and make it blue
  split it into two phases                      phase 1 what to find, phase 2 what it becomes
  extract the element phase 1 names
  SHOW IT — human reviews
    looks wrong  -> stop
    looks right  -> continue
  narrow with both phases                       smallest span, unique in every file
  return two things: the narrowed change, and a script that applies it
  run that script on the email files
  record the change and the files it covers
  report what is left, and go back to <start>
```

## Layout

```
src/
  cli.js                       entry and console rendering; nothing else imports it
  job.js                       the loop's steps as plain functions, no I/O prompts
  html.js                      UTF-8 gate, element view, prompt-fence stripping
  luna.js                      OpenAI Responses client
  pipeline/
    splitRequest.js            one typed request -> find phase, replace phase
    extractElement.js          find phase -> the element it names
    narrowChange.js            element + both phases -> smallest unique span
    replacementScript.js       span -> a standalone script that applies it
    progress.js                what was changed, which files, written to the job folder
```

`pipeline/` is the five stages in the order the loop runs them. The four files
above it are the shell: entry, steps, bytes, model.

## Build

- [x] Extract the element a request refers to (`src/pipeline/extractElement.js`).
- [x] Narrow an element to the smallest span that is unique in every file (`src/pipeline/narrowChange.js`).
- [x] Generate a standalone replacement script per change (`src/pipeline/replacementScript.js`).
- [x] Track processed files and applied changes in the job folder (`src/pipeline/progress.js`).
- [x] `src/cli.js` as the interactive loop with the human review gate.
- [x] Write the generated script to `<job>/changes/` and the log to `<job>/log.md`.
- [x] Let the human stop at review, and loop back to `<start>` otherwise.
- [x] Resume a job: read back what is recorded and report what is left.
- [x] Split the single request into two phases: what to find, what to replace with.
- [x] Take one typed request and let Luna do that split (`src/pipeline/splitRequest.js`).
- [x] Send phase 1 to extraction alone; join both phases for narrowing (`buildChangeRequest`).
- [x] Run the generated script from the loop, and record whether it applied.
- [x] Re-read the emails after applying, so the next pass narrows against current bytes.
- [x] Report files covered and files still to check after every pass.
- [x] Split the entry from the library: importing `src/job.js` no longer starts a prompt.
- [x] Record the files a change actually rewrote, not the files it hoped to cover, so a
      refusal no longer reports its files as done.
- [x] `dev/splitRequestCommand.js`: one typed request through Luna, phases printed.

## Verify

- [x] Unit tests for the script generator, progress tracking, and the loop's decisions.
- [x] Drive the loop non-interactively in tests by injecting the prompts.
- [x] Assert phase 1 reaches extraction without the replacement leaking into that prompt.
- [x] Assert the loop asks once, splits, and flags a split that leaks the replacement into phase 1.
- [x] Real-Luna e2e for the split itself, feeding its phases through extraction and narrowing (`tests/e2e/splitRequest.e2e.test.js`).
- [x] `replacementLanded` also compares raw, so a request sentence written into an attribute is caught: a whole-tag span normalizes to nothing, which used to switch the guard off.
- [x] Cover the apply path: applied, refused, and the next pass narrowing against applied bytes.
- [x] Run a generated script with `--check` and confirm it writes nothing.
- [x] Confirm a generated script refuses a file where the span does not match exactly once.
- [x] Full suite green. 81 tests, 10 files.
- [x] Cover partial application: two files written, a third refused, and only the two recorded.
- [ ] Run the real Delta job end to end against Luna: two phases, review, narrow, script, apply, log.
- [ ] An independent review of the two-phase loop.

## Lost in the two-phase change

`src/itemResolver.js` resolved a loose request into `current` and `replacement`.
`src/pipeline/splitRequest.js` now splits one typed request into the two phases, but it
reads the request alone and never the email, so it still resolves no `current`.
The resolver was deleted along with
`dev/requestedItemCommand.js`, `dev/requestedItemPromptCommand.js` and their
12 tests. `git log` has them.

What went with it is the `expectFrom` cross-check: narrowing used to verify that
the span it picked carried the exact `current` the resolver had read out of the
email. There is no resolved `current` any more, because phase 1 may legitimately
be a description rather than a value.

- [x] Partial replacement: check that the narrowed _result_ carries what phase 2
      named (`replacementLanded`). It prints a note rather than failing, since a
      phase 2 like `blue` will not appear literally in `background-color:#0000ff`.
- [ ] Decide whether that is enough, or whether the review gate should move to
      after narrowing so the human approves the span rather than the element.
      Today the human approves the element and never sees the span before the
      script runs.

## Removed: the validation pipeline

`src/{patternWorkflow,patternAgent,patternLoop,visualValidation,imagePresence}.js`
and their 25 tests are gone — 1,025 lines, unreachable from any command since
`src/index.js` stopped being the entry to `runEmailPatternWorkflow`. `git log`
has them.

Removing them also killed the per-attribute/per-text-node half of the old
`htmlTargets.js` — `buildAnnotatedView`, `materializeEdits`,
`applyMaterializedEdits`, `assertSafeReplacement` and their parse5 machinery,
~175 lines with no remaining caller. What survives is `src/html.js`: the UTF-8
gate and the element view the loop actually uses. `@pkboom/opencv-nodejs` and
`@playwright/cli` left `package.json` with them.

**What this gives up.** The loop proves a change is _deterministic_ — one span,
unique in every file. It does not prove the result _renders correctly_. Those
were always different guarantees, and the second one is now off the table. The
button run is the case in point: Luna passed a file that OpenCV caught. Nothing
would catch that today.

Deleting the pipeline also removed `assertSafeReplacement`, which was the only
markup-safety check in the tree. It sat on the dead branch and never guarded the
loop, so this is not a regression — but determinism is now the sole guarantee,
and a span inside a `<script>` or `<style>` body is rewritten like any other.

## Open, needing a decision

- [ ] The generated script applies file by file, so a refusal on the third file
      leaves the first two written. Deliberate and covered by
      `tests/unit/replacementScript.test.js`; revisit if a batch ever needs to be
      all-or-nothing.
- [ ] `leaks` treats a quoted run in the find phase as the value being retired, so it stays quiet when a shortening edit names part of the old text. An unquoted request that shortens a label is flagged anyway. The note is advisory; the human still reviews the element.
- [ ] A colour change touches several occurrences (`bgcolor`, `background-color`, `border`), so one span cannot express it. Narrowing returns `ambiguous` today. Either return several spans, or widen to one span covering them all.
- [ ] `decodeHtml` consumes a UTF-8 BOM, so a BOM-led file does not round-trip byte-identically.
