# `src/shared/blocks/` audit — can it carry component propagation?

Read-only audit. All paths relative to repo root. Every claim below is either a
`file:line` citation or a result from an executed probe (probes ran against a
sandboxed copy of `src/shared/blocks/*.ts` with `fast-xml-parser@4.5.6` and
`mjml@4.18.0`, because this working copy has **no `node_modules`** — nothing in the
repo was modified).

## Verdict up front

The **attribute channel works**: a `data-cmp="brand/button" data-cmp-v="3"` stamp
survives parse→serialize byte-identically, and MJML strips it from rendered output.
Propagation can carry its identity in-band, which is the load-bearing question and it
answers yes.

Three things break, in descending severity:

1. **Entity double-escaping corrupts every save** (`serializer.ts:17-29`). `&amp;` →
   `&amp;amp;` → `&amp;amp;amp;`, one layer per parse→serialize cycle. Propagation
   multiplies this by (templates × propagation runs). **This must be fixed before any
   propagation ships**, independent of the design-system work.
2. **`mj-wrapper` and friends swallow whole subtrees** into an opaque string
   (`parser.ts:304-311`). A component instance inside an `mj-wrapper` is invisible to
   the tree — propagation cannot see it, cannot rewrite it, and will silently report
   "0 instances" rather than failing.
3. **There is no provenance channel** for "this attr came from the component" vs "a
   human changed it here", and the data model cannot grow one out-of-band (the MJML
   text is the only persisted artifact — `src/db/schema.ts:12`). The fix has to be
   in-band; §5 gives a concrete one.

`stampPaths.ts` is **not** node identity and cannot be reused for it (§3).

---

## 1. Custom attribute survival — VERIFIED, with four caveats

### The A-prime claim holds

`types.ts:5-20` claims one ordered Map, parser policy-free, `allowedAttrs` a UI filter
only. Confirmed in code:

- `parser.ts:212-222` — `getAttrs()` iterates **every** key of fast-xml-parser's `:@`
  object, strips the `@_` prefix (`parser.ts:217`), and `.set()`s it into a fresh Map.
  No allowlist, no name validation, no normalization.
- `serializer.ts:35-45` — `serializeAttrs()` iterates that Map in insertion order and
  emits `k="v"`. No filter.
- `registry.ts:6-9,25` — `allowedAttrs` is documented and used only as a form-render
  filter; `PropertiesForm.tsx:160-163` consumes it, and
  `PropertiesForm.tsx:167-173` counts the non-allowed attrs it is *preserving*.

**Probe (executed):** input
`<mj-button data-cmp="brand/button" data-cmp-v="3" href="#">Go</mj-button>`
→ parsed node `attrs` = `[["data-cmp","brand/button"],["data-cmp-v","3"],["href","#"]]`,
→ re-serialized identically, attr order preserved. Whitespace-normalized round-trip
equal. **Byte-identical for the attrs themselves.**

Also verified surviving intact: uppercase/mixed-case names (`DATA-Cmp`), namespaced
names (`xml:lang`), numeric-suffixed names (`data-1` — `parser.ts:205-211` explains why
the Map, not `Object.keys`, is what closes the V8 numeric-key-reordering hole), and
values containing `>` and `'`.

### Caveat 1 — entity double-escape (CRITICAL, and it is not component-specific)

`parser.ts:185` sets `processEntities: false`, so `&amp;` stays the literal five
characters `&amp;` in the Map. `serializer.ts:17-22` then escapes `&` → `&amp;`
unconditionally. There is no inverse. Same bug in text content
(`serializer.ts:24-29`, applied at `serializer.ts:66`).

**Probe — four successive parse→serialize generations of
`<mj-button href="https://x.com/?a=1&amp;b=2">A &amp; B</mj-button>`:**

```
gen1: href="https://x.com/?a=1&amp;amp;b=2"              text="A &amp;amp; B"
gen2: href="https://x.com/?a=1&amp;amp;amp;b=2"          text="A &amp;amp;amp; B"
gen3: href="https://x.com/?a=1&amp;amp;amp;amp;b=2"      text="A &amp;amp;amp;amp; B"
gen4: href="https://x.com/?a=1&amp;amp;amp;amp;amp;b=2"  text="A &amp;amp;amp;amp;amp; B"
```

Every URL with a query string (`?utm_source=x&utm_medium=y`) and every `&nbsp;` in
body copy degrades one level per cycle. Today the blast radius is one level per
load→edit→save (`Canvas.tsx:531-538` parses once per server-authoritative version;
`Canvas.tsx:548-552` / `1085-1089` serialize per edit). **Propagation makes this
quadratic**: N templates × M propagation runs, all unattended, with the user seeing
only a diff they will approve.

No test covers it. `blocks.passthrough.test.ts` has no entity case.

### Caveat 2 — three classes of attribute are silently destroyed

| Input | Output | Cause |
|---|---|---|
| `color="red" color="blue"` | `color="blue"` | fast-xml-parser object keys collapse; `parser.ts:216-220` |
| `disabled href="#"` (valueless) | `href="#"` — `disabled` **gone** | fxp emits no `:@` entry for valueless attrs |
| `href='#'` (single-quoted) | `href="#"` | `serializer.ts:42` always double-quotes |

The quote change is semantically harmless. The other two are data loss. None is
tested. A valueless attr disappearing is the dangerous one — if anyone ever writes a
bare `data-cmp-locked` flag it evaporates on the next save.

### Caveat 3 — MJML itself

`render.ts:60` invokes `mjml2html(source, { validationLevel: "soft" })`.

**Probe:** an `mj-button` carrying `data-cmp`, `data-cmp-v` and `not-a-real-attr`
renders **successfully** under `soft`. `result.errors` contains
`"Attributes data-cmp, data-cmp-v, not-a-real-attr are illegal"`, and `render.ts:60-63`
destructures `errors` but **never reads it** — so it is silently discarded. The
stamps do **not** appear in the rendered HTML (verified `html.includes("data-cmp")
=== false`): MJML strips unknown attributes rather than passing them through. Same
result on `mj-section`.

Under `validationLevel: "strict"` the same input **throws `ValidationError`**.

So: soft is what makes stamping viable, and nothing documents that the render path
depends on it. Flipping to `strict` — a plausible future "give the user real
validation" change — would break every stamped template at once.

### Caveat 4 — empty-string attributes are a one-way door

`PropertiesForm.tsx:175-178` calls `setAttr(node.attrs, key, value)` with whatever the
form holds, including `""`. `deleteAttr` is exported (`attrsHelpers.ts:32`) and
**never called anywhere** in `src/` or `web/` — grep confirms zero call sites. So
clearing a field in the UI writes `color=""`, verified to serialize as `color=""`
rather than removing the attr. For propagation this is a genuine ambiguity: `color=""`
is indistinguishable from "the human deliberately blanked this" and from "the human
typed and then cleared it".

---

## 2. Subtree splicing — the shape is right, the coverage is not

### The shape works

`BlockNode.children?: TreeNode[]` (`types.ts:61`) is a plain array; `reorderInDoc.ts`
already performs detach/splice/reinsert over it (`reorderInDoc.ts:158-189`) using
`structuredClone` to preserve the attr Maps (`reorderInDoc.ts:158` — note the comment
at `:9-11`, JSON round-trip would destroy the Maps). Replacing
`parentArr[i] = newSubtree` is mechanically fine. Nothing in the model prevents it.

### `CustomPassthroughNode` is the real problem

`parser.ts:304-311`: **any tag not in `MODELED_TYPES`** becomes a
`CustomPassthroughNode` holding the verbatim source slice — with no children, no attrs
Map, nothing addressable inside.

**Probe:**
`<mj-body><mj-wrapper><mj-section><mj-column><mj-button data-cmp="brand/button">…`
parses to a body of exactly **one node**: `PASSTHRU(mj-wrapper)`. The stamped button
is a substring inside `rawXml`. It round-trips perfectly and is completely invisible.

The modeled set is nine tags (`types.ts:36-46`). Everything else in common MJML —
`mj-wrapper`, `mj-hero`, `mj-navbar`, `mj-table`, `mj-accordion`, `mj-carousel`,
`mj-raw`, `mj-include` — is opaque. `mj-wrapper` is not exotic; it is the standard way
to put a background on a group of sections.

**Four more demotion paths, all verified by probe, all of which swallow a stamped
node:**

| Source | Result | Code |
|---|---|---|
| `<mj-section><mj-text data-cmp="x">` (child not in `allowedChildren`) | section stays a BlockNode, the **text becomes PASSTHRU** | `parser.ts:408-421` |
| `<mj-section><mj-section data-cmp="x">…` (nested section) | inner section → PASSTHRU, its whole subtree opaque | same |
| `<mj-text data-cmp="x"><mj-raw>z</mj-raw></mj-text>` (leaf with element child) | the **whole mj-text** → PASSTHRU | `parser.ts:435-446` |
| element whose fxp parse throws or yields ≠1 root | → PASSTHRU | `parser.ts:320-346` |

The `allowedChildren` demotion (`parser.ts:408-421`) is the sneaky one: it is driven by
`registry.ts` lists that were written for a drag-and-drop palette, not for parsing
real-world MJML. `mj-section.allowedChildren = ["mj-column"]` (`registry.ts:39`), so any
hand-authored or Claude-authored section containing anything else silently loses its
whole child subtree to a string.

Asymmetry worth knowing: `mj-body`'s direct children are parsed by
`parseBodyChildren` (`parser.ts:240-291`), which does **not** apply `allowedChildren`
— probe confirms `<mj-body><mj-text data-cmp="x">` stays a real BlockNode. So the same
tag is modeled at depth 0 and demoted at depth 1.

### `UnknownNode`

Not a concern. It is produced only for comments (`parser.ts:256-266`, `:376-387`) and
stray non-element text (`parser.ts:270-283`, `:389-402`). A component instance is an
element, so it never lands in one. (`types.ts:69` claims `UnknownNode.rawXml` can
include "tag, attrs, children" — that is stale; the element path always goes to
`CustomPassthroughNode`.)

### What propagation must therefore do

Enumerating "every instance of `brand/button`" by walking `doc.body` will **undercount
silently**. There is no error, no warning, no `missing[]` — the nodes simply are not in
the tree. A dry-run diff that says "3 instances affected" when there are 5 is worse
than a crash.

Minimum mitigation: after tree-walking, also `grep` the raw source for the stamp
(`data-cmp="…"`) and assert the counts match; where they don't, refuse to propagate
into that template and tell the user why.

---

## 3. `stampPaths.ts` — not node identity, not reusable

Read in full (738 lines). It is a **render-time HTML annotator** for the canvas
click-overlay, not a tree-identity mechanism:

- `stampMjmlPaths(source, html)` (`stampPaths.ts:567`) re-parses the MJML, builds a DFS
  plan (`:79-124`), tokenizes the *rendered HTML* (`:141-241`), matches each parser
  block to a rendered element via per-type heuristics (`:357-536`), and splices
  `data-mjml-path="0/1/2"` into the HTML (`:712-719`). Called once from
  `render.ts:69`.
- The identity it assigns is a **positional index path** — `pathKey` is built as
  `parentPath === "" ? String(i) : ${parentPath}/${i}` (`stampPaths.ts:85`). Insert a
  section at the top and every path below it shifts. This is the opposite of stable
  identity.
- It is one-directional: HTML out, never back into the MJML. Nothing it writes is
  persisted.
- The matchers are **fragile heuristics against mjml 4.18's HTML shape** — e.g. a
  section is "a `<table role=presentation>` whose style contains `width:100%`"
  (`:357-362`); a divider is "a `<td>` whose first inner tag is a `<p>` with
  `border-top:`" (`:429-447`). An mjml minor upgrade can break these. Failures are
  swallowed into `missing[]` and logged once per cache miss (`render.ts:70-75`).
- `mj-social` in `mode="vertical"` is a documented known gap (`:510-519`).

**There is one reusable idea in it**, and it is the sentinel pattern:
`PASSTHROUGH_SENTINEL_RE = /\bdata-mjml-passthrough\s*=\s*["']true["']/i`
(`stampPaths.ts:532`), with `buildStampPlan` skipping passthroughs that lack it
(`:93-94`). That is exactly the in-band-marker precedent the component stamp should
follow, and it proves the team already accepted a `data-*` sentinel that survives the
`mj-raw` round trip.

But: a passthrough carrying a component stamp would need `data-mjml-passthrough="true"`
*too* to be overlay-selectable, and the sentinel only works because `mj-raw` passes its
inner HTML through to the rendered output. It will not work for a stamp on a real
`mj-button`, where MJML drops unknown attrs (§1, caveat 3). **A component instance will
be invisible in the rendered HTML.** If you want to highlight instances on the canvas,
you need a new mechanism — most likely extending `stampPaths` to emit
`data-mjml-cmp="brand/button"` alongside `data-mjml-path`, read from the parser node
rather than from the HTML (the splice point at `:716` makes that a small change).

**`stampPaths` does not give you stable node identity. Nothing in this codebase does.**

---

## 4. Round-trip fidelity — weaker than advertised

### What is actually guaranteed

`roundTrip.ts:69-80` — `assertRoundTrip` compares
`normalizeWhitespace(source) === normalizeWhitespace(serializeMjml(parseMjml(source)))`.
So the guarantee is **equal-modulo-whitespace, never byte-equal**, and
`normalizeWhitespace` (`roundTrip.ts:27-63`) is aggressive: it strips all inter-tag
whitespace (`:49`) and collapses all remaining runs to one space (`:50`), outside of
`mj-text`/`mj-button` bodies.

`types.ts:11-12` says "source-byte-equal output (modulo whitespace)", which is a
contradiction in terms; the honest statement is the normalized one.

### The property test does not exist

`assertRoundTrip` has **zero call sites**. Grep for it across the repo returns only its
own definition (`roundTrip.ts:69`). Its own header comment says it is "used by property
tests" (`roundTrip.ts:5-7`) — those property tests were never written, or were deleted.
`fast-check` is a devDependency and is used in exactly two files —
`blocks.headEdit.test.ts:14` and `blocks.attrsHelpers.test.ts:15` — **neither of which
touches the parser or the serializer**.

The entire parse/serialize fidelity story rests on `blocks.passthrough.test.ts`: **six
hand-written examples** (`:45-122`), all single-line, none containing an entity, a
single quote, a duplicate attr, a valueless attr, a URL, or a multi-line document.

There is **no** `blocks.parser.test.ts`, `blocks.serializer.test.ts`,
`blocks.stampPaths.test.ts`, `blocks.roundTrip.test.ts`, `blocks.validate.test.ts`, or
`blocks.reorderInDoc.test.ts`. The four `blocks.*` test files are attrsHelpers,
headEdit, mjAttributes and passthrough.

### Known failure cases (all reproduced)

| Case | Round-trip |
|---|---|
| `&amp;` / `&nbsp;` in attr value or text | **CORRUPTS**, compounds per cycle |
| duplicate attribute | **LOSES** all but last |
| valueless attribute (`disabled`) | **DROPS** it |
| single-quoted attr | rewritten to double quotes (harmless) |
| `<mj-text />` | becomes `<mj-text></mj-text>` (harmless) |
| `<mj-social-element name="fb" />` | becomes `<mj-social-element name="fb"></mj-social-element>` (harmless — `text` is `""`, not `undefined`, so `serializer.ts:65` takes the text branch) |
| all indentation | **rewritten** to 2-space (`serializer.ts:31-33`) |
| passthrough inner indentation | preserved as-is, only line 1 indented (`serializer.ts:75,84`) — mixed indentation results |
| raw HTML inside `mj-text` (`<b>bold</b>`) | preserved |

### The `TODO(serializer)` in types.ts — closed

`types.ts:28-31` asks the serializer to skip the `__synthetic` sentinel and emit a head
iff `head` is present. `serializer.ts:104-108` does exactly that: it emits
`doc.head.rawXml` and never touches `__synthetic`, which lives on the wrapper object
(`types.ts:103`) and so cannot leak. Covered by `blocks.headEdit.test.ts:81-103`,
which asserts `out).not.toContain("__synthetic")` and that a re-parse recovers a real
head. **The comment is stale, not a live bug. It does not bite propagation.**

(Related but unfixed: `parser.ts:549-550` captures `mj-head` wherever it appears and
`serializer.ts:104` always emits it *before* the body, so a document with `mj-head`
after `mj-body` gets reordered. Legal MJML requires head-first, so this is theoretical.)

### The trap for the dry-run diff

Because the serializer re-indents everything and normalizes quotes, **the first
propagation run against any hand-authored or Claude-authored template produces a
whole-file diff**, not a component-scoped one. Probe: a one-line input comes back fully
re-indented across 9 lines. The "edit one component, see a small diff" promise fails on
run 1 for every template.

Mitigations, pick one: (a) normalize every template through parse→serialize once, as an
explicit one-time migration with its own review; (b) diff
`serializeMjml(parseMjml(original))` against `serializeMjml(propagated)` so the
reformat is factored out of the displayed diff — this shows the true semantic change
while still *writing* a reformatted file; (c) make the serializer preserve source
indentation, which is a much larger job.

Option (b) is the cheap one and I'd take it.

---

## 5. Component-owned vs human-overridden — no channel today; the fix must be in-band

### Current state

`BlockNode.attrs` is `Map<string,string>` (`types.ts:59`). A value and nothing else.
There is **no** origin, no default marker, no layering. `mj-attributes` head defaults
do not help either — probe confirms the parser does **not** merge them into the node:

```
<mj-attributes><mj-button background-color="#111" /></mj-attributes>
  <mj-button href="#">A</mj-button>              → attrs = [["href","#"]]
  <mj-button href="#" background-color="#f00">B  → attrs = [["href","#"],["background-color","#f00"]]
```

So "attribute absent" and "attribute inherited from head defaults" are the same state,
and `mjAttributes.ts` only slices the head's raw string — it never reaches the body.
Answer to the question as asked: **no, nothing in the current data model distinguishes
component-authored from human-authored.**

### Why an out-of-band field will not work

The obvious move — add `attrOrigin?: Map<string, "component" | "local">` to
`BlockNode` — **fails**, and it is worth being explicit about why so nobody builds it:

`src/db/schema.ts:7-21` persists a template as one column, `mjml text`. The block tree
is reconstructed from that text on every load (`Canvas.tsx:531-538`) and thrown away on
every save. Any field that is not expressible as MJML text **does not survive a single
round trip**. A sidecar table would have to key the provenance by *something*, and the
only candidates are the positional index path (unstable — §3) or `BlockNode.id`, which
is a monotonic counter regenerated per parse (`parser.ts:37-41`, and `types.ts:49`
explicitly says "Local-only id … Not serialized"). Both give you the split-join failure
where the sidecar and the template drift apart with no symptom.

### The minimal change that works: extend the stamp, not the model

§1 proved arbitrary `data-*` attributes survive byte-identically and are stripped by
MJML at render. Use that. Carry provenance **in the instance stamp**:

```xml
<mj-button
  data-cmp="brand/button"
  data-cmp-v="3"
  data-cmp-own="href,background-color,color,border-radius"
  data-cmp-h="a3f19c"
  href="#" background-color="#1f6feb" color="#ffffff" border-radius="4px">Shop now</mj-button>
```

- `data-cmp` / `data-cmp-v` — which component, which version this instance was last
  synced to. `data-cmp-v` is what lets the diff know *from* what.
- `data-cmp-own` — the attrs the component claims. An attr **not** in this list is
  human-added; propagation never touches it. This one field removes the whole
  "did a human add `padding`?" ambiguity.
- `data-cmp-h` — hash of the component-owned attr values as stamped. On propagation,
  recompute it from the instance's current values: **equal ⇒ untouched since sync,
  rewrite freely; different ⇒ a human edited a component-owned attr, surface it in the
  dry-run as a conflict and default to keeping the local value.** The hash means you do
  not have to store or look up the old component version to detect an override.

Per-attr resolution, then, is three cases and no guessing:

| attr | in `data-cmp-own`? | `data-cmp-h` matches? | action |
|---|---|---|---|
| any | no | — | human-added — leave alone |
| any | yes | yes | component-owned, clean — rewrite |
| any | yes | no | **conflict** — show in diff, keep local by default |

The hash is coarse (any single local change marks the whole instance dirty). If that
turns out to be too blunt, the per-attr refinement is `data-cmp-h` → a compact
`name:hash` list; same mechanism, more bytes. Start coarse.

Two more things the stamp needs:

- **Text content.** `mj-button`/`mj-text` carry `node.text` (`types.ts:63`), which is
  almost always instance-specific ("Shop now", "Read more") while the styling is
  component-owned. Add an explicit slot declaration — `data-cmp-slots="text"` meaning
  "the text is a local slot, never propagate it". Without this the first propagation
  overwrites every button label in the brand with the component's placeholder.
- **Multi-node components.** A component that is a section-with-columns needs the stamp
  on its root node only; propagation replaces `root.children` wholesale and resolves
  attrs on the root. The `children: TreeNode[]` shape (`types.ts:61`) supports this as
  is. But nested instances (a stamped button inside a stamped hero) need a documented
  rule — propagating the hero must not clobber the button's own stamp. Simplest rule
  that works: when replacing a subtree, first harvest every descendant `data-cmp`
  stamp, and re-apply those nodes into the new subtree by stamp identity before
  writing. If you don't decide this now, it will be decided accidentally.

### The one change the block model *does* need

Not for provenance — for reach. Either:

- **(a)** add the container-shaped unmodeled tags to `BLOCK_REGISTRY` (`mj-wrapper`,
  `mj-hero`, `mj-navbar` at minimum) with correct `allowedChildren`, so their subtrees
  are modeled and walkable; or
- **(b)** give `CustomPassthroughNode` (`types.ts:80-85`) an optional
  `children?: TreeNode[]`, populated when the tag is container-shaped, with `rawXml`
  used for re-emission **only when `children` is absent** — the serializer at
  `serializer.ts:78-85` would branch on that.

(a) is less code and less risk; (b) generalizes. Either way, **also loosen
`allowedChildren`**: it is a drag-and-drop palette rule being used as a parse gate
(`parser.ts:408-421`), and it is why `<mj-section><mj-text>` loses its subtree.

---

## 6. Blockers, pessimistically

Ranked by how much damage they do before anyone notices.

1. **Entity double-escape corrupts data on every save cycle** (`serializer.ts:17-29`,
   `parser.ts:185`). Silent, compounding, unbounded. Propagation turns a slow leak into
   a fleet-wide one. *Fix before anything else; it is independent of this feature and
   is a bug today.* Watch out: the fix is not "escape less" — `parser.ts:185`
   (`processEntities: false`) and `serializer.ts:17` must be made inverses of each
   other, and `headEdit.ts:59-61` deliberately double-escapes form input (asserted at
   `blocks.headEdit.test.ts:70`), which is *correct for its input class* and must not
   be "fixed" along with it. Two different contracts, same-looking code.

2. **`mj-wrapper` (and every unmodeled container) hides instances with no signal.**
   `parser.ts:304-311`, probe-confirmed. Propagation undercounts and reports success.
   No error path exists to hang a warning on. Add a raw-source stamp-count
   cross-check and hard-fail the template.

3. **`allowedChildren` silently demotes legal MJML.** `parser.ts:408-421` +
   `registry.ts:39,47-54`. `<mj-section><mj-text>` loses the text to a string.
   Anything Claude generates that doesn't match the palette's idea of structure is
   unreachable by propagation. Inconsistently applied — body-level children skip the
   gate entirely (`parser.ts:240-291`).

4. **Zero test coverage on the two files propagation depends on most.**
   `assertRoundTrip` has no callers; `fast-check` is present but never pointed at the
   parser; six single-line examples in `blocks.passthrough.test.ts` are the whole
   fidelity suite. You are about to build a feature whose core loop is
   parse→mutate→serialize across every template at once, on top of an untested
   parse→serialize. **Write the property test first** — it is cheap (`assertRoundTrip`
   is already written and waiting) and it will find items 1 and 5 immediately.

5. **Valueless and duplicate attributes are destroyed.** Probe-confirmed. Rules out
   ever using a bare-flag stamp (`data-cmp-locked`); every stamp must be `k="v"`.

6. **`validationLevel: "soft"` is load-bearing and undocumented.** `render.ts:60`. Under
   `strict`, every stamped template throws. `result.errors` is destructured and
   discarded (`render.ts:60-63`), so the "illegal attribute" errors MJML *is* reporting
   for every stamp are invisible — including any real errors mixed in with them. If
   error surfacing is ever added, it will drown in `data-cmp` noise unless it filters.

7. **The first propagation diff is a whole-file reformat.** §4. Undermines the core UX
   promise ("dry-run diff shown first") on run 1 for every template. Diff
   normalized-vs-normalized to factor it out.

8. **No stable node identity anywhere.** `BlockNode.id` is a per-parse counter
   (`parser.ts:37-41`, `types.ts:49`); `stampPaths` pathKeys are positional
   (`stampPaths.ts:85`). Everything durable must live in the MJML text. Corollary: two
   instances of the same component in one template are distinguishable only by
   position, so "the user rejected propagation for *that* instance" cannot be recorded
   out-of-band either — it needs an in-band instance id (`data-cmp-i="…"`) if you want
   per-instance opt-out. Decide early; retrofitting ids across existing templates is a
   migration.

9. **`PropertiesForm` mutates the doc in place.** `PropertiesForm.tsx:175-177` calls
   `setAttr(node.attrs, …)` on the live node and then serializes the same `doc` object
   — no clone (contrast `reorderInDoc.ts:158` and `Canvas.tsx:1079-1084`, which do
   clone). For propagation this matters directly: a dry-run that needs before/after
   trees cannot get "before" from the store once any form edit has landed. Any
   propagation preview must re-parse from source, not reuse the in-memory doc.

10. **Clearing a form field writes `attr=""` instead of removing the attr.**
    `PropertiesForm.tsx:175-178`; `deleteAttr` (`attrsHelpers.ts:32`) has no call sites.
    Creates a third state between "component value" and "human override" that the
    resolution table in §5 has to treat as an override — meaning an accidental
    click-and-clear permanently pins that attr against propagation.

11. **`stampPaths` matchers are heuristics over mjml 4.18's HTML** (`:357-536`), failing
    into `missing[]` with a `console.warn` (`render.ts:70-75`). Not a propagation
    blocker on its own, but if you extend it to highlight component instances on the
    canvas, that highlighting inherits the fragility — and an mjml upgrade will make
    instances appear to vanish from the UI while the underlying data is fine.

---

## Could not determine from the code

- Whether the `TODO(serializer)` at `types.ts:28-31` was left deliberately as
  documentation-of-contract or simply forgotten after being satisfied. The code and the
  test both satisfy it; only the comment is stale.
- Whether `assertRoundTrip`'s property tests were deleted or never written — there is no
  deleted-test trace in the working tree, and I did not inspect git history.
- Real-world attr-order stability across fast-xml-parser versions: `parser.ts:205-211`
  documents the V8 numeric-key hazard and closes it with the Map, but I only probed
  `data-1`; I did not probe a purely numeric attribute name (`1="x"`), which is invalid
  XML anyway.
