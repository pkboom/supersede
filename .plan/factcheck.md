# Adversarial fact-check — PLAN-design-system.md

Method: every claim opened in the actual file at the actual line. Behavioural claims
(4, 6, 7, 19, 20, and §4.1's migration mechanism) re-derived by executing code against
the installed deps (`fast-xml-parser@4.5.6`, `mjml@4.18.0`, node v26.0.0). Scratch
scripts were written outside the repo; no repo file was modified.

**Headline: 14 of 20 fully verified. 5 are directionally right with a wrong detail.
1 (#20) is overstated to the point of being wrong as written. Two material facts the
plan does not contain are in §B.**

---

## A. The twenty claims

### 1. `allowedAttrs` absent from parser.ts / serializer.ts — VERIFIED, enumeration incomplete

Zero occurrences in `parser.ts` or `serializer.ts`. Confirmed.

The plan's list of where it *does* appear ("only `PropertiesForm.tsx`,
`promptBuilder.ts:120`, and tests") omits the two places that matter most:

- `registry.ts:25` declares the field; `registry.ts:38,46,61,79,87,108,125,133,141,149`
  populate it — this is where it is *defined*
- `types.ts:13` documents the contract

Also worth stating precisely, because §10.1 depends on it: `allowedAttrs` is not a parse
gate, but `BLOCK_REGISTRY` **as a whole absolutely is** — `parser.ts:367` reads
`def.allowedChildren` into the demotion gate, and `serializer.ts:48,53,65` reads
`isContainer` / `contentField`. "It is a UI view filter, not a parse gate" is true of the
one field and false of the registry.

### 2. `getAttrs()` at `parser.ts:212` is unfiltered — VERIFIED

`parser.ts:212` is exactly `function getAttrs(node: FxpNode): Map<string, string> {`.
Body (212–224) iterates `Object.keys(at)`, strips the `@_` prefix, `.set()`s every key.
No registry consultation. Confirmed at runtime: `data-cmp`, `data-cmp-v`, `mj-class`,
`border-radius` all land in the Map.

### 3. Parser config at `parser.ts:185` — VERIFIED, line-exact

```
177  const xmlParser = new XMLParser({
182    trimValues: false,
183    parseAttributeValue: false,
184    parseTagValue: false,
185    processEntities: false,
```

All four flags present with the claimed values, and `processEntities:false` is on line
185 as stated. The no-coercion consequence checked by execution:
`width="0.50"` → `"0.50"`, `data-v="007"` → `"007"`. Confirmed.

### 4. `serializer.ts:17–29` escapes `&` unconditionally, compounding — VERIFIED, but "exponentially" is FALSE

`escapeAttrValue` is 17–22, `escapeText` is 24–29. Both `.replace(/&/g, "&amp;")` with no
unescape anywhere in the file. Executed:

```
gen 0: <mj-button href="/x?a=1&amp;b=2">Tom &amp; Jerry</mj-button>
gen 1: <mj-button href="/x?a=1&amp;amp;b=2">Tom &amp;amp; Jerry</mj-button>
gen 2: <mj-button href="/x?a=1&amp;amp;amp;b=2">Tom &amp;amp;amp; Jerry</mj-button>
gen 4: <mj-button href="/x?a=1&amp;amp;amp;amp;amp;b=2">Tom &amp;amp;amp;amp;amp; Jerry</mj-button>
```

The plan's illustrative table is reproduced exactly. The bug is real and irreversible.

**But the growth is strictly linear, not exponential.** Measured payload length per
generation for `a &amp; b`: 9, 13, 17, 21, 25, 29, 33 — a flat +4 chars per save, and
the string never contains more than one literal `&`. Change "exponentially" to "once per
save, without bound". The word is the only thing wrong here, but it is the kind of thing
a skeptical reader uses to discount the whole section.

### 5. `headEdit.ts:59–61` double-escapes deliberately, asserted at test:70 — VERIFIED, line-exact

`headEdit.ts:59–61` is `escapeHtml`, and 60 is
`return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");`.
`blocks.headEdit.test.ts:70` is `expect(next).toContain("&amp;amp;end");` inside test
`(iv)`, whose input at line 66 contains a literal `&amp;`. The double-escape is locked in
by assertion. The trap is real and the warning should stay.

One nuance for whoever executes it: the *source comment* (56–57) justifies only the
ordering of the three replaces, not the escaping of a pre-existing entity. The "this is
deliberate" evidence is the test, not the comment.

### 6. `parser.ts:304–311` collapses `mj-wrapper` — VERIFIED, line-exact and by execution

304–311 is the `if (!isModeledType(tag))` branch in `parseElement`, returning a
`CustomPassthroughNode`. `mj-wrapper` is not a key of `BLOCK_REGISTRY` (`registry.ts:33–153`),
so it takes that branch. Executed on
`<mj-wrapper background-color="#000"><mj-section><mj-column><mj-button data-cmp="brand/primary-button">`:

- the whole subtree becomes one `[PASSTHROUGH tag=mj-wrapper]`
- **no modeled `mj-button` node exists anywhere in the tree** (searched the serialized tree: `false`)
- the stamp survives byte-wise in `rawXml` and re-emits

`mj-hero`, `mj-navbar`, `mj-raw` confirmed identical. §10.1 is correct as written.

### 7. `parser.ts:408–421` demotes legal MJML children — VERIFIED, line-exact and by execution

408–421 is the `isModeledType(childEl.name) && !allowed.has(...)` demotion block.
`mj-section.allowedChildren` is `["mj-column"]` only (`registry.ts:39`). Executed on
`<mj-section><mj-text>direct child text</mj-text></mj-section>`:

```
<mj-section> attrs=[]
  [PASSTHROUGH tag=mj-text] rawXml="<mj-text>direct child text</mj-text>"
```

Confirmed. Precision note for the edit: the bytes are not lost — they round-trip
verbatim. What is lost is the *modeled node*, i.e. anything walkable or stampable. "Loses
the text to a string" is fair shorthand; "loses the node, keeps the bytes" is exact.

### 8. `parser.ts:37–41` — MISLEADING. It is not a per-parse counter.

37–41 is the right region:
```
37  let __id = 0;
38  function nid(): string {
39    __id += 1;
40    return `n_${__id.toString(36)}`;
41  }
```
But `__id` is a **module-level counter that is never reset** — `grep -rn "__id" src/`
returns exactly three hits, all inside these five lines, and none of them a reset.
Executed, parsing the same source three times in one process:

```
parse #1 ids: n_3,n_2,n_1
parse #2 ids: n_6,n_5,n_4
parse #3 ids: n_9,n_8,n_7
```

Two parses of an identical document produce disjoint id sets. (They also come out in
reverse document order, since `nid()` is called after children are built — so it is not
even a positional index.)

The plan's *conclusion* — "useless as a stable key" — is not just right, it is
understated. Fix the label to "a module-global counter, never reset, not stable across
two parses of the same document".

### 9. `schema.ts` — VERIFIED

32 lines. `schema.ts:13` is `mjml: text("mjml").notNull(),` — a single text column, no
sidecar table, no JSON blob. `templates` (7–21) and `settings` (26–32) are the only
tables. The §5 inference ("anything not expressible as MJML text dies on the next parse")
follows.

### 10. `assertRoundTrip` has zero call sites — VERIFIED

`grep -rn assertRoundTrip src web tests scripts` → 2 hits, both in `roundTrip.ts`: its own
docstring (line 4) and its definition (line 69). Nothing calls it.

### 11. fast-check wired only to headEdit and attrsHelpers — VERIFIED

`grep -rln "fast-check" src web tests` → exactly `tests/unit/blocks.headEdit.test.ts` and
`tests/unit/blocks.attrsHelpers.test.ts`. The parser is not property-tested.

### 12. `blocks.passthrough.test.ts` characterisation — VERIFIED, and worse than described

6 `it()` blocks. Every one ends in `normalizeWhitespace(out) === normalizeWhitespace(src)`
(lines 54, 65, 79, 93, 107, 121) — no byte equality anywhere. All six sources are
hand-written literals; no generator. No entity, no URL, no quote, no CDATA, no unicode, no
duplicate attr in any of the six.

Worth adding to the plan, because it is a sharper version of the same point: the file's
own docblock at lines 9–10 claims *"Serialize → parse a second time still yields the same
variant (round-trip stability)."* **No test in the file calls `parseMjml` on `out`.** The
second generation is documented and not performed. The entity bug did not merely slip
past this suite — it slipped past a suite that says in writing it was looking for it.

### 13. `normalizeWhitespace` untested — VERIFIED. "two off-by-one bugs" — MISLEADING.

No direct test: the only importer is `blocks.passthrough.test.ts:15`, which uses it as the
comparator, never as the subject. Every fidelity assertion in the repo therefore routes
through untested index math, exactly as claimed.

But the comments document **one** off-by-one and **one** normalization-rule gap, not two
off-by-ones:

- `roundTrip.ts:29–33` — a genuine off-by-one: `lastIndexOf("<", m.index + m[0].length)`
  grabbing a sibling's close tag, fixed with `m[0].length - 1`
- `roundTrip.ts:20–25` — the "strict-between-tags rule (Lane B addition)", which is a
  missing `>\s+<` collapse, not an index error

Suggested wording: "its own comments document two already-fixed defects in it, one of them
an off-by-one."

(Related, in §9: the "two `lastIndexOf` boundary fixes" are **not in `readElement`**. They
are at `parser.ts:365` and `parser.ts:578`; `readElement` (63–160) uses regex depth
counting and contains the `(?![\w-])` lookahead at line 112. Also, the comments at 109–111,
359–362 and 574–575 explain *why the fix is necessary* — none of them says the code
regressed. "The comments document both as already-regressed-once" is an over-reading.)

### 14. `stampPaths.ts` — VERIFIED except "largest file in the repo", which is FALSE

- 738 LOC — correct.
- **"largest file in the repo" is false.** `web/src/canvas/Canvas.tsx` is **1,229 LOC**.
  `stampPaths.ts` is the second largest.
- No direct test — correct. Only `web/src/canvas/Canvas.tsx` and
  `src/server/routes/render.ts` reference it; no test file does.
- `missing[]` graceful skip — correct: declared at `stampPaths.ts:42`, pushed at 602 and
  612, returned at 725.
- `data-mjml-passthrough` sentinel "around line 532" — **exactly** line 532:
  `const PASSTHROUGH_SENTINEL_RE = /\bdata-mjml-passthrough\s*=\s*["']true["']/i;`
- Precision: the `console.warn` is **not in `stampPaths.ts`** (it contains no `console.`
  call at all — lines 20–21 only describe one in a comment). It is emitted by the caller
  at `render.ts:72`, gated on `stamped.stamped < stamped.expected` at line 70.

### 15. `render.ts:60` — VERIFIED on substance, "destructures" is the wrong word

`src/server/routes/render.ts:60` is exactly
`const result = mjml2html(source, { validationLevel: "soft" }) as {`, with
`errors?: unknown[];` at 62. `result.errors` is never read anywhere in the 85-line file.

But 60–63 is a **type assertion, not a destructuring** — there is no `const { html, errors } = `.
Substance holds (the field is declared and ignored); replace "destructures" with
"type-asserts `errors` into existence and never reads it".

The §9 behavioural claims around this are all confirmed by execution:
- soft returns `errors: [{"message":"Attributes data-cmp, data-cmp-v are illegal","tagName":"mj-button", ...}]`
- `data-cmp` does **not** reach the rendered HTML (stripped)
- `validationLevel: "strict"` **throws** `ValidationError: ... Attributes data-cmp, data-cmp-v are illegal`

### 16. `promptBuilder.ts:120` — VERIFIED, line-exact

`const attrs = \`attrs=[${def.allowedAttrs.join(", ")}]\`;` is line 120, inside
`formatCatalogEntry` (114–126). §10.3 is correct.

### 17. The `TODO(serializer)` in `types.ts` is stale — VERIFIED

The TODO is at `types.ts:29–32` and asks for two things: skip the sentinel when emitting,
and emit a head iff `head` is present (real or synthetic). Both are done:
`serializer.ts:104` is `if (doc.head) {` and `serializer.ts:107` emits only
`doc.head.rawXml`. `grep -rn __synthetic src/` returns no hit in `serializer.ts`.
`blocks.headEdit.test.ts:98` pins it: `expect(out).not.toContain("__synthetic")`.
Do not schedule work for it. Correct as written.

### 18. The §2 LOC table — VERIFIED, all six figures exact

```
src/shared/blocks   2620
web/src             4707
tests               3454
src/server           887
src/llm              529
src/db/schema.ts      32
```

Every number matches. The `templateService.ts` quote in §2 is also verbatim — it is at
`src/server/services/templateService.ts:31–32`.

### 19. Valueless attrs dropped, duplicates collapse — VERIFIED by execution

```
in : <mj-button href="#" disabled>Go</mj-button>
out: <mj-button href="#">Go</mj-button>

in : <mj-button color="red" color="blue">Go</mj-button>
out: <mj-button color="blue">Go</mj-button>
```

Both confirmed. Add the detail that duplicates collapse to the **last** value, not the
first — for a propagation engine reading a stamp that a human duplicated, which value wins
is a decision, not a detail.

### 20. "The first diff on any template is a whole-file reformat" — MISLEADING / overstated

This is the one claim I would not let ship as written. Executed on four inputs:

| input | byte-equal out? | lines changed |
|---|---|---|
| 2-space indented (serializer's canonical form) | **yes** | **0 / 10** |
| 4-space indented | no | 7 / 10 |
| tab indented | no | 7 / 10 |
| realistic: `mj-head` + `mj-attributes` + blank line + comment | no | **1** (the blank line between `</mj-head>` and `<mj-body>` is dropped) |

The serializer does not "re-indent everything" — it emits a canonical 2-space form, which
is a no-op on any source already in that form, and in the realistic case the entire diff
was one deleted blank line. The head is re-emitted verbatim (`serializer.ts:105–107`
explicitly does not re-indent inner head lines), so `mj-style` / `mj-attributes` blocks are
untouched regardless.

Rewrite as: *"On sources whose indentation differs from the serializer's canonical 2-space
form (tabs, 4-space, minified exports from Stripo/Beefree), run 1 reformats most lines.
Sources already in 2-space form round-trip byte-equal."* The mitigation
(diff normalized-vs-normalized) is still right — the risk is just conditional, not
universal, and stating it as universal invites someone to test one file, see a clean diff,
and throw out the mitigation.

---

## B. Two facts the plan does not contain, both load-bearing for §6/§10.1

### B1. `<mj-text>` containing *any* inline HTML demotes to a passthrough

`parser.ts:433–446`: a leaf block with any element child is returned as a
`CustomPassthroughNode`. Executed, with a `data-cmp` stamp on the `mj-text`:

| `mj-text` content | node kind |
|---|---|
| `hi` | BlockNode |
| `Tom &amp; Jerry` | BlockNode |
| `<p>Hello</p>` | **PASSTHROUGH** |
| `Hello <b>world</b>` | **PASSTHROUGH** |
| `Click <a href="#">here</a>` | **PASSTHROUGH** |
| `line one<br/>line two` | **PASSTHROUGH** |

`mj-text` with inline HTML is not an edge case — it is what `mj-text` is *for*, and a
bolded word or a single link is enough. §10.1 currently frames the invisibility problem
around `mj-wrapper`/`mj-hero`/`mj-navbar`. It is much larger than that: in a realistic
agency template, a large share of the *text* blocks are opaque too, and those are exactly
the blocks a "edit the component once" product needs to rewrite. This strengthens
§10.1's "would pass on toy fixtures and silently no-op on real client work" — the toy
fixtures in `blocks.passthrough.test.ts` all use bare `<mj-text>hi</mj-text>`.

### B2. The escaping bug is not only about `&`

`serializer.ts:17–22` also escapes `"` → `&quot;` and `<` → `&lt;` in attribute values,
with no inverse. Executed:

```
gen 0: data-j='{"a":"b"}'                          data-lt="x&lt;y"
gen 1: data-j="{&quot;a&quot;:&quot;b&quot;}"       data-lt="x&amp;lt;y"
gen 2: data-j="{&amp;quot;a&amp;quot;:...}"          data-lt="x&amp;amp;lt;y"
```

A JSON value in an attribute is destroyed on the **first** save, not gradually. This is
directly relevant to §5, which proposes putting structured provenance into attributes
(`data-cmp-own="href,color,…"`, `data-cmp-h="<hash>"`). Comma-separated lists and hex
hashes are safe; anything containing `"`, `<` or `&` is not. §0.2 should be scoped as
"fix attribute and text escaping", not "fix entity double-escaping".

This is independently confirmed by a failing test already in the tree —
`.plan/scratch/propagation-proof.test.ts:99`, "PROOF 3 — preserves JSON-in-attr and
entities", which fails with exactly this diff.

---

## C. §4.1's test numbers — mechanism verified, headline numbers not reproducible

**The mechanism is confirmed.** I copied `drizzle/migrations` to a temp dir, removed
`meta/`, and ran `applyMigrations` both ways:

```
with-meta -> OK
no-meta   -> THREW: Can't find meta/_journal.json file
```

`.gitignore:19–20` does exclude `drizzle/migrations/meta/`, and `git ls-files drizzle`
returns only `0000_initial.sql` — the journal is **present on disk but untracked**, i.e.
locally reconstructed exactly as §4.1 describes. The journal's `"when":1700000000000` is a
round number, corroborating "hand-reconstructed" and the instruction not to ship it.

**The headline split does not reproduce.** `npx vitest run` in the current tree:

```
Test Files  2 failed | 29 passed (31)
     Tests  2 failed | 229 passed (231)
```

Broken down: the real suite (`tests/`) is **193 tests, 193 passing, 0 failing** — 41
integration + 152 unit. The remaining 38 tests are scratch files under `.plan/scratch/`,
of which 2 fail.

The plan's "42 failed / 167 passed" totals 209, against 193 real tests here. I cannot
reproduce 209 from this tree and I am not going to guess which file set it counted. What I
can say:

- the "41/41 integration tests pass" figure is **exactly** corroborated — there are
  precisely 41 integration tests and all 41 pass
- the clean-clone failure mechanism is proven
- the current working copy is **not** a clean clone (the journal was reconstructed), so
  the 42/167 figure describes a state that no longer exists here

Recommend §4.1 says "on a clean clone the DB-touching tests all fail (41 integration tests
+ any unit test that opens a DB); reconstructing the journal makes 41/41 pass" and drops
the unreproducible 42/167 split.

Two further things §4.1 should know:
- `.nvmrc` says 20, `package.json` `engines` says `>=20`, local is **v26.0.0**. Confirmed.
- **`.plan/scratch/` is inside the vitest include set**, so `npm test` currently reports
  2 failures from other lanes' scratch probes (`probe3.test.ts`, `propagation-proof.test.ts`).
  Whatever else happens, those must be deleted or moved before anyone uses "npm test is
  green" as a gate — right now it is red for reasons unrelated to the product.

---

## D. Checked as a side-effect, all correct

- §3 "programmatic `attrs.set()` re-emits and survives a second parse byte-stable" —
  executed: gen1 === gen2 both before and after `attrs.set("data-cmp-v","4")`; source
  attribute order preserved (`data-cmp`, `data-cmp-v`, `href`).
- §9 "OPERATIONS.md has drifted" — `OPERATIONS.md:143` references
  `.omc/plans/ralplan-frontend-rewire.md`; `.omc/plans/` does not exist.
  `OPERATIONS.md:135` advises pinning to "a previous Better-Auth-based revision in git
  history"; `git log --oneline` returns exactly one line, `d9c10ad init`. Both correct.
- §2 `package.json` "Hosted multi-tenant MJML email designer" — present as a prefix of
  the `description` field, whose full value is "Hosted multi-tenant MJML email designer
  with Anthropic-API-driven Claude turns."

## E. Not checked

§0.4's three CVE identifiers (GHSA-pfq8-rq6v-vf5m, GHSA-gh4j-gqv2-49f6,
GHSA-rwvc-j5jr-mgvh) and the "may change render output" quote. These need a network
lookup against the advisory database, which was out of scope for this lane. The installed
versions are confirmed as `mjml@4.18.0`, `fast-xml-parser@4.5.6`, `ai@^4.0.0` — i.e. the
"before" side of each bump is accurate.
