# Iterative pattern editing

`src/index.js` processes a folder as a loop, not as one giant prompt.

Prerequisites are Node.js 24 or newer, a local OpenCV 4/5 installation,
`OPENAI_API_KEY` access to `gpt-5.6-luna`, and Playwright CLI/browser support.
On macOS, install OpenCV with `brew install opencv@4` before `npm install`.
Put the API key in the ignored root `.env` file as `OPENAI_API_KEY=...`; the
pipeline and dev commands load it automatically.

```sh
npm run run -- ./original ./updated \
  --instruction 'Replace the company postal address "OLD" with "NEW".' \
  --artifacts ./edit-evidence
```

| option | default | meaning |
|---|---|---|
| `--instruction TEXT` | — | the requested change; required unless `--instruction-file` is given |
| `--instruction-file FILE` | — | read the instruction from a file instead; using both is an error |
| `--artifacts DIR` | `OUTPUT.evidence` | where captures, `evidence.jsonl`, and `loop-report.json` are written |
| `--model MODEL` | `gpt-5.6-luna` | Responses API model |
| `--max-validation-attempts N` | `2` | retries per file before it is sent to review; integer 1–10 |

`INPUT` must be a directory holding at least one `.html`/`.htm` file and no
symlinks. `OUTPUT` and the artifacts directory must not already exist, must sit
outside `INPUT`, and the artifacts directory must sit outside `OUTPUT` as well;
each of these fails closed rather than overwriting anything.

The command exits `0` only when every email passes. It exits `2` when the run
completes with files left in review, and `1` on an error; a review run writes
`loop-report.json` but publishes no `OUTPUT` directory.

## Loop

1. Pick the first unprocessed email as the seed.
2. Ask Luna whether the seed and the second email share the requested text/tag structure.
3. If they do not, keep the seed and try the third, fourth, and so on.
4. Stop discovery as soon as two files establish one uniquely replayable pattern.
5. Apply that pattern deterministically to every unprocessed file where it uniquely matches.
6. Render and validate every application.
7. Return unmatched or failed files to the unprocessed set and repeat.
8. If a seed has no partner, only a verified `no_change` result may pass. A proposed one-off edit remains `review`, and no final output directory is published.

## Validation

Every edit is tied to an exact parsed text or attribute-value span. Replacements are replayed against the original source; parsed HTML is never serialized back to disk. Invalid UTF-8, stale targets, structural text injection, unsafe unquoted attributes, symlinks, duplicate or overlapping spans, and ambiguous selectors fail closed.

`script`, `style`, `title`, `textarea`, `noscript`, `iframe`, and `xmp` bodies are never offered as editable targets. Their contents are raw text, so the `<`-rejection that protects ordinary text would not stop a replacement from closing a CSS rule block or appending script.

A pattern rule discriminates on `sourceEquals` and `contextIncludes`. A context part matches only a contiguous run of whole ancestor segments, or a visible label in full — never a substring of a longer label, which would otherwise let a rule compiled from "SHOP NOW" rewrite an unrelated "SHOP NOW AT OUR PARTNER STORE" link in a third file.

Untrusted email content reaches the model only inside an `<email_html>` element, or `<email_data>` where the payload is the extracted edits and target catalogue rather than markup. Each prompt separately instructs the model to treat everything inside as data and never as instructions. Filenames are JSON-quoted before interpolation, and both the `⟦id⟧` target markers and any forged fence tag are stripped from source content, so an email that contains `</email_html>` cannot close the fence early and have the rest of itself read as instructions.

The output directory is assembled under a staging path and renamed into place as the last step, so a partially copied batch never appears as a finished one.

Playwright captures a full before/after render and focused crops for changed elements. Remote requests and scripts are blocked by Content Security Policy. The first file to *pass* validation supplies OpenCV templates for the changed region; a file that fails never becomes the reference, so a bad render cannot become the standard the rest of the batch is measured against. That first file therefore carries no containment evidence of its own — it is admitted on the Luna verdict plus complete crop coverage alone, and every later file is measured against it. `@pkboom/opencv-nodejs` performs multi-scale normalized-correlation containment checks against later captures and returns tri-state evidence: `present`, `absent`, or `unestablished`. A miss or unestablished comparison goes back through the loop; it is never treated as proof that a target is absent.

Luna also reviews the before/after captures against the requested change. Source replay, OpenCV evidence, and the Luna visual verdict are recorded under the artifacts directory. The final output is copied only when all emails pass.

Browser validation does not prove Outlook-specific rendering. The evidence report preserves that limitation instead of converting uncertainty into success.

A pattern rule replays the seed's complete replacement value. When a rule covers a whole `style` attribute and a later file carries extra declarations the seed lacks, replaying the seed value drops them. That is a real regression, and the Luna visual verdict does not reliably catch it; the OpenCV containment check does, and the file goes to review rather than to the output directory.

## Inspect one extraction

```sh
npm run dev
# or run the command directly
npm run dev:extract-pattern
```

Both flows prompt for anything not supplied. To skip the prompts, pass both
values; omitting `--value2` still prompts for the file.

```sh
node dev/extractPatternCommand.js --value1 'TRACK YOUR ORDER' --value2 asset/sample.html
node dev/extractPatternCommand.js --value1 '123 Example Street Suite 500 Springfield, IL 62704'
```

There is no text-or-button choice. You name any identifiable item and it goes
straight into the prompt: visible copy, a button or call-to-action label, a
link, an attribute value such as `alt` or `title`, an image, or a colour. The
model decides which element carries it.

| you type | you get |
|---|---|
| `TRACK YOUR ORDER` | the whole `td.innertd.buttonblock`, not the label span |
| `123 Example Street Suite 500 Springfield, IL 62704` | `td#Footer`, matched across `<br>`, `<strong>` and `&bull;` |
| `Example Company logo` | the `<img>` carrying that `alt`, which renders no text at all |
| `https://example.com/unsubscribe` | the `<a>` with that `href` |
| `#1f6feb` | the smallest element carrying that colour |

A label for an interactive element returns the container that carries its
background and padding. Anything else returns the smallest element that carries
it. When two elements are equally plausible the model returns `review` and the
command fails rather than guessing.

The `dev/index.js` → `dev/indexArguments.js` → `dev/*Command.js` dispatcher
mirrors `../dmarc_lambda/dev`. Choose `extractPatternCommand`, enter visible
text, and accept the default fixture at `asset/sample.html` or provide another
email file. It
uses the same UTF-8 decoder and element-ID annotation as the pipeline, asks Luna
through the OpenAI Responses API to select the smallest related element, then
writes that exact original source span to `asset/extracted-pattern.html`.

## See the prompt without spending anything

`extractPromptCommand` takes the same text and shows the prompt that would be
sent, then stops. It makes no API call.

```sh
npm run dev:extract-prompt -- --value1 'TRACK YOUR ORDER' --value2 asset/sample.html
```

It prints the model, the response schema, the element count, the prompt size in
bytes and estimated tokens, and the prompt itself. Both commands build that
prompt from the same `buildRelatedPartPrompt` in `src/partExtractor.js`, and a
test asserts the two are byte-identical, so what you read here is what gets
sent.

## Run the extract scenarios

`validation.md` lists the extract scenarios: exact text, `<br>`-split "similar"
text, and buttons, each across one, two, and three files with the target present
or absent. `dev/validateExtractCommand.js` builds those corpora and runs them.

```sh
npm run dev:validate-extract -- --value1 all --value2 offline
npm run dev:validate-extract -- --value1 exact-text --value2 live
```

`offline` substitutes a deterministic selector for the model, so it costs
nothing and still exercises the real rule compilation and uniqueness checks in
`src/patternAgent.js`. `live` calls the Responses API. Each scenario prints the
expected and actual pattern/processed/review counts and the resulting footer or
button colour; the command exits `2` if any scenario misses.

Similar-text scenarios show a real limitation. A text replacement cannot contain
tags, so an address split across a `<br>` is edited segment by segment: the new
one-line address lands in the first segment and the second is blanked, leaving
the `<br>` behind.
