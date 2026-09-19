# Interactive flow checklist

The flow `src/index.js` drives, one change per pass:

```
  put email files in workspace/<job>            e.g. workspace/delta
  node src/index.js
<start>
  ask what to find                              phase 1
  ask what to replace it with                   phase 2
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

## Build

- [x] Extract the element a request refers to (`src/partExtractor.js`).
- [x] Narrow an element to the smallest span that is unique in every file (`src/changeNarrower.js`).
- [x] Generate a standalone replacement script per change (`src/replacementScript.js`).
- [x] Track processed files and applied changes in the job folder (`src/progress.js`).
- [x] `src/index.js` as the interactive loop with the human review gate.
- [x] Write the generated script to `<job>/changes/` and the log to `<job>/log.md`.
- [x] Let the human stop at review, and loop back to `<start>` otherwise.
- [x] Resume a job: read back what is recorded and report what is left.
- [x] Split the single request into two phases: what to find, what to replace with.
- [x] Send phase 1 to extraction alone; join both phases for narrowing (`buildChangeRequest`).
- [x] Run the generated script from the loop, and record whether it applied.
- [x] Re-read the emails after applying, so the next pass narrows against current bytes.
- [x] Report files covered and files still to check after every pass.
- [x] Carry the two phases through `dev/narrowChangeCommand.js` as well.

## Verify

- [x] Unit tests for the script generator, progress tracking, and the loop's decisions.
- [x] Drive the loop non-interactively in tests by injecting the prompts.
- [x] Assert phase 1 reaches extraction without the replacement leaking into that prompt.
- [x] Assert the loop no longer calls the requested-item resolver.
- [x] Cover the apply path: applied, refused, and the next pass narrowing against applied bytes.
- [x] Run a generated script with `--check` and confirm it writes nothing.
- [x] Confirm a generated script refuses a file where the span does not match exactly once.
- [x] Full suite and syntax checks. 95 tests, 16 files, green.
- [ ] Run the real Delta job end to end against Luna: two phases, review, narrow, script, apply, log.
- [ ] An independent review of the two-phase loop.

## Lost in the two-phase change

`src/itemResolver.js` resolved a loose request into `current` and `replacement`.
The human now types both, so it was deleted along with
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

## Orphaned: the validation pipeline

`src/index.js` used to be the entry to `runEmailPatternWorkflow`. It is now the
interactive loop, so **nothing calls that pipeline any more**. The code and its
tests are intact and green — they are simply unreachable from any command.

| module                    | lines | still reached by                     |
| ------------------------- | ----- | ------------------------------------ |
| `src/patternWorkflow.js`  | 255   | nothing but its own tests            |
| `src/visualValidation.js` | 235   | `patternWorkflow` only               |
| `src/imagePresence.js`    | 103   | `patternWorkflow` only               |
| `src/patternAgent.js`     | 315   | also `dev/validateExtractCommand.js` |
| `src/patternLoop.js`      | 117   | also `dev/validateExtractCommand.js` |

1,025 lines, 25 tests. `patternAgent` and `patternLoop` stay alive through
`dev/validateExtractCommand.js`; the other three are reachable only from tests.

**What is lost while it sits unused.** The loop proves a change is
_deterministic_ — one span, unique in every file. It does not prove the result
_renders correctly_. Those are different guarantees, and the second one is the
whole reason the Playwright captures, the Luna visual verdict and the OpenCV
containment check exist. The button run is the case in point: Luna passed a file
that OpenCV caught, and nothing shipped. Nothing in the loop would catch that
today.

- [ ] Decide: wire validation into the loop after a script is applied, keep the
      batch pipeline reachable behind a flag, or drop it and accept that
      deterministic is the only guarantee on offer.

## Open, needing a decision

- [ ] A colour change touches several occurrences (`bgcolor`, `background-color`, `border`), so one span cannot express it. Narrowing returns `ambiguous` today. Either return several spans, or widen to one span covering them all.
- [ ] A non-visual change such as an `href` edit cannot reach `pass` in the batch validator, because the visual prompt returns `review` for anything a capture cannot show.
- [ ] `decodeHtml` consumes a UTF-8 BOM, so a BOM-led file does not round-trip byte-identically.
- [ ] `pattern.id` hashes pre-strip rules, so the repeated-failed-pattern guard misses equivalent patterns.
- [ ] A file that is last in `pending` gets one validation attempt regardless of `--max-validation-attempts`.
