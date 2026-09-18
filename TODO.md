# Current implementation checklist

- [x] Replace the hardcoded `src/index.js` address/button rules with an iterative pattern loop.
- [x] Keep the first unprocessed email as seed; try second, then third, until two establish a pattern.
- [x] Stop discovery after the first valid pair and apply its exact source-span pattern across matching files.
- [x] Return failed validations to the loop and carry failure evidence into the next discovery request.
- [x] Add Playwright full/detail captures, Luna visual verdicts, and OpenCV tri-state containment evidence.
- [x] Port bounded OpenCV matching with `@pkboom/opencv-nodejs` and retain score/location/scale.
- [x] Remove the obsolete one-pass corpus planner, stale tests, and `workspace/delta-updated` output.
- [x] Provide a minimal button/address fixture at `asset/sample.html`.
- [x] Mirror `../dmarc_lambda/dev` with `dev/index.js`, `dev/indexArguments.js`, and `dev/extractPatternCommand.js`.
- [x] Verify both `node dev/index.js` and direct `node dev/extractPatternCommand.js` interactive flows.
- [x] Replace deterministic dev text matching with Luna Responses API element selection, including `<br>`/nested-tag coverage.
- [x] Finish and test the seed-extraction → candidate-catalog pattern-agent refactor.
- [x] Ensure every publishable email has complete capture evidence for every edit; unresolved proposed singletons remain review-only.
- [x] Run a live Luna Responses API extraction with `OPENAI_API_KEY` for text and button modes.
- [x] Re-run the real Delta address workflow and inspect exact diffs plus OpenCV/Luna evidence.
- [x] Re-run the real Delta button workflow and confirm failed visual variants cannot bypass into a pass.
- [x] Run the complete test suite, syntax checks, diff checks, and independent final review.
- [x] Remove any generated scratch artifacts and update documentation to the final CLI behavior.

## Review follow-ups

Fixed after the independent review:

- [x] Seed OpenCV templates only from a file that passed validation, not the first attempted.
- [x] Reject substring context matches that rewrite the wrong target in a later file.
- [x] Refuse `script`/`style`/`title`/`textarea` bodies as editable targets.
- [x] Assemble the output under a staging path and rename it into place.
- [x] Fence untrusted HTML in prompts, quote filenames, and strip forged `⟦id⟧` markers.
- [x] Keep targets addressable when their URL is opaqued.
- [x] Apply the input exclusion set in `walkDirectory` as well as `copyInput`.
- [x] Reject duplicate and overlapping spans when replaying persisted edits.
- [x] Cover `visualEvidence` with direct unit tests.

Open, needing a decision:

- [ ] A non-visual change such as an `href` edit cannot reach `pass`, because the visual prompt returns `review` for anything the capture cannot show.
- [ ] `decodeHtml` consumes a UTF-8 BOM, so a BOM-led file does not round-trip byte-identically.
- [ ] `pattern.id` hashes pre-strip rules, so the repeated-failed-pattern guard misses equivalent patterns.
- [ ] A file that is last in `pending` gets one validation attempt regardless of `--max-validation-attempts`.
