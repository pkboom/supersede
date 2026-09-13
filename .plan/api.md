# Server-side refactor: single-namespace → multi-brand

Scope: `src/server/**`, `src/db/**`, `src/llm/**`, `tests/**`. Design only; no source
files were modified.

Sibling lanes own the schema (`schema-designer`), the propagation algorithm
(`propagation-designer`), and the block/component model (`blocks-auditor`). This
document owns the **API surface, the service signatures, the transaction boundary,
and the test blast radius**, and defers the interior of the propagation rewrite to
that lane.

---

## 0. Corrections to the framing

Four things in the brief are wrong or half-wrong. Taking them first because two of
them change the shape of the work.

**0.1 — `settings` being a singleton is not the bug. The write-on-read is.**

The brief lumps "settings is a literal singleton row keyed id=1" in with the
single-user problem. It does not belong there. `defaultProvider` / `defaultMode` /
`defaultModel` (`src/db/schema.ts:26-32`) describe *how this deployment talks to
Anthropic* — API vs local CLI, which model, which provider. None of that is a
property of a brand. An agency does not want "Acme Corp uses Opus and Wayne
Enterprises uses Sonnet"; they want one inference configuration for the install.
Sharding this table by brand would be a straightforward mistake, and it would make
`src/server/routes/settings.ts` a per-brand route for no reason.

The actual defect in that file is different and is a real concurrency bug:

```
src/server/services/settingsService.ts:44-56   get() performs an INSERT
```

`get()` is a read method that writes. Two concurrent `GET /api/settings` (or two
concurrent `/query` calls, since `query.ts:68` calls `ss.get()` on every request)
can both miss the row and both attempt `INSERT ... id=1`, and the loser throws
`SQLITE_CONSTRAINT_PRIMARYKEY` out of a GET handler as an unhandled 500. Today
this is unreachable because there is one user issuing one request at a time. The
moment there are five people in an agency, it is reachable. **Fix during this
refactor:** seed the row in a migration, make `get()` a pure read.

**0.2 — Brand is probably not the only axis, and the *upper* axis is the expensive one to retrofit.**

An agency has clients (brands) *and* it has staff. The brief only asks for brand
scoping. If we add `brandId` and nothing else, the next ticket is "Dana shouldn't
be able to see the Wayne Enterprises brand", and that requires threading a second
identity through the exact same call sites we are touching now.

I am **not** recommending building auth now. I am recommending that `brands`
carry an `accountId` column from day one (nullable, or defaulted to a single
bootstrap account), so the join point physically exists. Adding a column to one
small table later is cheap; adding an ownership axis *above* a table that already
has rows, routes, and a UI is not. This is `schema-designer`'s call — flagging the
API consequence: if `accountId` lands now, the brand-resolution middleware in §2.4
is the single place it later gets enforced, and no route handler changes again.

**0.3 — "Components" is underspecified in a way that decides whether propagation exists at all.**

Two possible models, and the brief assumes the second without saying so:

- **Reference model** — templates store a placeholder; component MJML is resolved
  at render time. Propagation is free and instantaneous. There is nothing to
  preview, nothing to apply, no transaction, no optimistic-locking problem. Items
  3 and 4 of the brief evaporate.
- **Copy model** — component MJML is materialized into each template. Propagation
  is a real batch rewrite across N templates. This is the product the brief
  describes.

The copy model is the right choice for email specifically — the stored MJML must
be self-contained, inspectable, and hand-editable after the fact, and a designer
must be able to break from the component for one template without breaking the
component. But it should be a conscious decision, because it is the entire source
of the difficulty in §3 and §4. `propagation-designer` owns the interior; the API
in §2 assumes the copy model.

**0.4 — Two documentation artifacts are actively lying, one of them about security.**

- `package.json:5` already describes the product as *"Hosted multi-tenant MJML
  email designer"*. Every source comment says the opposite. The package manifest
  was written for the product the brief is now asking for.
- `README.md` describes a **different, older architecture that is not in this
  repo**: `src/cli.ts` (does not exist), `./workspace/` persistence, `MJMLState`,
  a websocket `/ws` proxy, `npm start` (not a script — `package.json:10-16` has
  `setup, dev, test, typecheck, db:generate, db:migrate`), and port 5173.
- Most seriously, `README.md:13` claims: *"The local server ... rejects requests
  whose `Host`/`Origin` headers don't match the bound port (DNS-rebinding / CSRF
  defence)."* **No such check exists.** `grep -rn "Origin\|Host\|csrf\|cors"
  src/server/` returns nothing, and `createWebApp.ts:44-95` mounts no such
  middleware. Any web page the user visits can currently `fetch()` against
  `127.0.0.1:5174` and read or delete every template, because there is no auth
  (by design) *and* no origin check (by accident). This is a present-tense bug,
  not a refactor artifact, and it gets worse when the database holds several
  clients' brand assets instead of one person's drafts.

**Recommendation: add the Origin check in this refactor**, in `createWebApp`, as
part of the same pass that adds brand resolution. It is ~15 lines and the README
already promises it.

---

## 1. Full inventory of single-namespace assumptions

Ordered by how load-bearing each is. "Implicit" means the assumption is in the
*shape* of the code rather than in a comment.

### 1.1 Schema and migrations

| # | Location | Assumption |
|---|---|---|
| 1 | `src/db/schema.ts:3-5` | Comment: *"one global namespace. No User entity, no per-user scoping, no auth."* |
| 2 | `src/db/schema.ts:7-21` | `templates` has no owner column at all. PK is a bare UUID; the only index is `templates_updated_idx` on `updatedAt` (`:19`) — an index that only makes sense for "list everything, newest first". |
| 3 | `src/db/schema.ts:23-25` | Comment declaring the settings singleton. |
| 4 | `src/db/schema.ts:26-32` | `settings.id` is `integer().primaryKey().default(1)` — the singleton encoded in the type. |
| 5 | `drizzle/migrations/0000_initial.sql:9-19` | Only two tables exist. There is no `brands`, `components`, or `tokens` table to scope to. |
| 6 | `drizzle/migrations/0000_initial.sql:4` | **Schema drift bug:** migration says `default_mode text DEFAULT 'api'`; `src/db/schema.ts:29` says `.default("cli")`. The migration was generated before the default flipped and never regenerated. Currently masked because `SettingsService.get()` (`settingsService.ts:47-55`) supplies the value explicitly on its seeding insert — so any *other* insert path gets the wrong default. Fix while regenerating migrations. |

### 1.2 Services

| # | Location | Assumption |
|---|---|---|
| 7 | `src/server/services/templateService.ts:30-33` | The canonical statement: *"Single-user open-source shape: no per-user scoping. Every template lives in one global pool owned by the deployer."* |
| 8 | `src/server/services/templateService.ts:35` | **Implicit.** `constructor(private readonly db: DbHandle)` — the constructor takes *only* a db handle. There is no scope object, and no method takes one either. This one line is the shape of the whole problem. |
| 9 | `src/server/services/templateService.ts:37-48` | `list()` takes no arguments and has no `WHERE`. It returns every template in the file. |
| 10 | `src/server/services/templateService.ts:50-53` | `get(id)` looks up by bare id — a UUID is treated as globally sufficient to authorize a read. |
| 11 | `src/server/services/templateService.ts:55-68` | `create()` has nothing to attach the row to; `TemplateRow` (`:8-16`) has no owner field. |
| 12 | `src/server/services/templateService.ts:86` | `.where(and(eq(templates.id, id), eq(templates.version, expectedVersion)))` — the optimistic-lock predicate is id+version with no scope term. |
| 13 | `src/server/services/templateService.ts:94-100` | The not_found/stale disambiguation SELECT is likewise unscoped. |
| 14 | `src/server/services/templateService.ts:104` | `delete(id)` — unscoped delete. Worst-case blast radius of the missing scope term. |
| 15 | `src/server/services/settingsService.ts:13` | `const SINGLETON_ID = 1`. |
| 16 | `src/server/services/settingsService.ts:37-40` | *"Always operates on the row with `id = 1`, lazily creating it on first read."* |
| 17 | `src/server/services/settingsService.ts:44-56` | `get()` writes on read — see §0.1. |
| 18 | `src/server/services/settingsService.ts:66` | `update()` calls `this.get()` purely for its insert side-effect (`// Ensure the singleton exists.`). |
| 19 | `src/server/services/settingsService.ts:58,73` | `update(patch)` takes no scope; `WHERE id = 1`. |

### 1.3 Routes

| # | Location | Assumption |
|---|---|---|
| 20 | `src/server/routes/templates.ts:7-9` | **Implicit.** `TemplatesRoutesOptions { db: DbHandle }` — the route factory's entire dependency surface is a db handle. |
| 21 | `src/server/routes/templates.ts:11-14` | *"No auth — the deployer is responsible for who can reach the listener."* |
| 22 | `src/server/routes/templates.ts:16-20` | The documented route table: five flat `/api/templates` paths, no scope segment. |
| 23 | `src/server/routes/templates.ts:24` | **Implicit.** `const ts = new TemplateService(opts.db)` — one service instance is constructed **once at factory time** and closed over by every handler. There is no per-request construction seam, which is exactly the seam a scoped or transactional service needs. |
| 24 | `src/server/routes/templates.ts:26-28` | `GET /api/templates` → `ts.list()` with no filter. |
| 25 | `src/server/routes/templates.ts:51-55` | `POST` creates into the global pool. |
| 26 | `src/server/routes/templates.ts:60, 98, 105` | `c.req.param("id")` is the *only* identifier read from the request on every id-addressed route. |
| 27 | `src/server/routes/settings.ts:6-10` | **Implicit.** `SettingsRoutesOptions { db, apiKeyConfigured }` — `apiKeyConfigured` is a single boolean for the whole process. |
| 28 | `src/server/routes/settings.ts:25-33` | `GET /api/settings` fetches *the* settings row. Textbook implicit singleton fetch. |
| 29 | `src/server/routes/query.ts:36-37` | **Implicit.** Both `TemplateService` and `SettingsService` instantiated once at factory time, same problem as #23. |
| 30 | `src/server/routes/query.ts:41` | `templateId` from path param, no scope. |
| 31 | `src/server/routes/query.ts:62` | `ts.get(templateId)` — unscoped fetch feeding an LLM call. |
| 32 | `src/server/routes/query.ts:68-69` | `ss.get()` on every request — the global settings singleton is read on the hot path. |
| 33 | `src/server/routes/query.ts:81` | `buildPrompt({ mjml, query })` — the prompt has no brand context to carry. See §5. |
| 34 | `src/server/routes/query.ts:96-106, 117-127, 135-144` | The structured log record has `templateId` but no brand/account field. Multi-brand logs become unattributable. |
| 35 | `src/server/routes/query.ts:131` | `ts.update(templateId, ...)` — unscoped write. |
| 36 | `src/server/routes/render.ts:20-35` | **Implicit.** Module-level `const cache: CacheEntry[]` — one process-global render cache. Keyed on the full source string, so it is *not* a correctness leak across brands (same source ⇒ same HTML), but it is a shared, unbounded-lifetime, cross-tenant memory store with a hard cap of 32 entries. With N brands active it thrashes. |
| 37 | `src/server/routes/health.ts:10-12` | Global health, no per-brand status. Fine as-is; listed for completeness. |

### 1.4 Composition root and middleware

| # | Location | Assumption |
|---|---|---|
| 38 | `src/server/createWebApp.ts:20-26` | *"Open-source single-user composition root. No auth, no per-user scoping. The deployer owns the SQLite file and the listener."* |
| 39 | `src/server/createWebApp.ts:27-37` | **Implicit.** `CreateWebAppOptions` has no auth/identity/tenant seam. Every injected dependency (`db`, `llmAdapterFactory`, `apiKeyResolver`, `clock`, `logger`) is process-global. |
| 40 | `src/server/createWebApp.ts:48-50` | *"Public routes (no gate — the deployer controls network access)."* |
| 41 | `src/server/createWebApp.ts:53` | *"not a security gate since there's no auth."* |
| 42 | `src/server/createWebApp.ts:62-63` | Body limits bound to the literal paths `/api/templates` and `/api/templates/*`. These silently stop applying the moment the paths move. |
| 43 | `src/server/createWebApp.ts:66-72, 97-101` | Rate limit keyed on **IP only** (`query:${ipOf(c)}`). In an agency behind one NAT, every employee shares one 60/hr bucket. The `keyFn` seam exists (`rateLimit.ts:11` — its own doc comment already says *"userId, IP, etc."*), it is simply never given anything but an IP. |
| 44 | `src/server/createWebApp.ts:88` | **Implicit and a live inconsistency.** `apiKeyConfigured: opts.apiKeyResolver() !== null` is evaluated **once, at app construction**. But `main.ts:55-60` deliberately makes the resolver late-binding so a `.env` edit is picked up without restart. So `/query` sees the live key while `/api/settings` reports the boot-time value forever. Pass the resolver, not the boolean. |
| 45 | `src/server/middleware/rateLimit.ts:28` | `const hits = new Map<...>()` — process-local limiter state. Documented as fine for single-host (`:18-25`); becomes a correctness issue at horizontal scale, not at this step. |
| 46 | `src/server/types.ts:1-10` | **The most load-bearing implicit assumption.** `export interface AppVariables {}` — an empty Hono `Variables` bag, with the comment *"no `userId` since there's no User entity."* Nothing is carried per-request. Every handler must re-derive everything from path params. |
| 47 | `src/server/main.ts:51-61` | One `openDb` → one `createWebApp` → one process, one SQLite file. |
| 48 | `src/server/main.ts:66-71` | Boot-time `new SettingsService(db).get()` — fires the write-on-read insert at startup, which is the only reason §0.1's race is not already observable. |

### 1.5 LLM layer

| # | Location | Assumption |
|---|---|---|
| 49 | `src/llm/promptBuilder.ts:60-69` | `BuildPromptInput { mjml, query, registry? }` — no brand, no tokens, no component catalog. The prompt cannot express "this is Acme's brand". |
| 50 | `src/llm/promptBuilder.ts:23-47` | `SYSTEM_GUIDANCE` is a module-level `const`, shared by every request, explicitly declared frozen (*"intentionally stable"*). |
| 51 | `src/llm/promptBuilder.ts:84` | The block catalog is always `BLOCK_REGISTRY` — one global registry, no per-brand component set. |
| 52 | `src/llm/promptBuilder.ts:45` | *"Use only the block types listed in the catalog. Never introduce unmodeled tags."* — a design-system product needs the stronger rule *prefer the brand's components*, which cannot be said with the current inputs. |
| 53 | `src/llm/promptBuilder.ts:10-12` | `STARTER_MJML` read once at module load from a single file on disk. In a multi-brand product the starter should be the brand's starter. |
| 54 | `src/llm/types.ts:8-14` | `LLMAdapterInput` has four content fields and `model`. No brand field, so brand context cannot reach either adapter without a signature change. |
| 55 | `src/llm/anthropicApi.ts:33` | `system: \`${input.systemGuidance}\n\n${input.blockCatalog}\`` — the two-part system prompt is hardcoded here… |
| 56 | `src/llm/claudeCodeCli.ts:65` | …and duplicated here. Two call sites to change, and they can drift. |
| 57 | `src/llm/anthropicApi.ts:14-16` | Comment: *"Each user supplies their own apiKey"* — describes a per-user credential model that `main.ts:57` does not implement (one process-wide env var). Stale. |
| 58 | `src/llm/index.ts:19-30` | `defaultLLMAdapterFactory(provider, mode, apiKey)` — the whole credential axis is one nullable string resolved from process env. |

### 1.6 Tests and fixtures

| # | Location | Assumption |
|---|---|---|
| 59 | `tests/helpers/makeTestDb.ts:20-37` | `makeTestDb()` migrates and hands back a handle. No brand seeding, because there is nothing to seed. |
| 60 | `tests/helpers/index.ts:1-14` | **Dead placeholder.** Lists eight helpers (`makeTestApp`, `seedUser`, `seedAuthedUser`, `cookieHeader`, …) as "Phase 7", none of which were ever implemented; the file ends in `export {}`. It is a stale promise of exactly the multi-user work now being planned. Delete it or implement it — do not leave it. |
| 61 | `tests/integration/templates-routes.test.ts:6`, `settings-routes.test.ts:6`, `query-route.test.ts:7` | Three `describe` blocks literally titled `(integration, single-user)`. |
| 62 | `tests/integration/services.test.ts:23-30` | `it("get() lazily seeds the singleton with defaults")` — a test that **pins the write-on-read behavior from §0.1**. Fixing the bug requires deleting this test, not updating it. |
| 63 | `tests/unit/promptBuilder.snapshot.test.ts:43-62` | Three frozen snapshots of a brand-free prompt. |
| 64 | `tests/unit/anthropicApi.test.ts:13-19`, `claudeCodeCli.test.ts` | `baseInput` fixture with exactly the five current `LLMAdapterInput` fields. |

### 1.7 Web client (not in scope to change here, but it constrains §2)

| # | Location | Assumption |
|---|---|---|
| 65 | `web/src/api/templates.ts:27-69` | Six free functions with flat paths: `/api/templates`, `/api/templates/${id}`, `/api/templates/${id}/query`. No client-side notion of scope. |
| 66 | `web/src/App.tsx:13-19` | Router: `/templates`, `/templates/:id`, `/settings`. |
| 67 | `web/src/sidebar/SidebarShell.tsx:24` | `useMatch("/templates/:id")` — the URL shape is load-bearing for provider mounting. |
| 68 | `web/src/sidebar/TemplateList.tsx:27` | `listTemplates()` with no filter — the sidebar is "all templates everywhere". |
| 69 | `web/src/hooks/useTemplate.ts:232, 286, 342, 407` | Four call sites passing a bare `id`. |
| 70 | `web/src/hooks/useQueryRunner.ts:71` | `runQuery(id, version, trimmed, signal)`. |
| 71 | `web/src/settings/Settings.tsx:7-16` | *"Open-source single-user settings page."* |
| 72 | `web/src/ui/Toaster.tsx:5` | *"…which is the safest default for a single-user app."* |

---

## 2. New API surface

### 2.1 Decision: brand scoping goes in the **path**

`/api/brands/:brandId/templates/...`, not a header and not a query param.

**The decisive argument is two tabs.** An agency designer's actual workflow is
Acme open in one tab and Wayne open in the next, copying an idea across. A
header-based "current brand" has to be sourced from somewhere ambient — a React
context, a module global, a cookie. All three are *per-browser*, not per-tab. The
moment the user switches brand in tab B, tab A's next autosave `PATCH` carries the
wrong brand. A header-scoped design is a singleton with extra steps: we would be
deleting the ambient global in `templateService.ts:35` and reintroducing it in the
client.

**It also survives contact with the existing client, where a header would not.**
`web/src/api/templates.ts:27-69` are pure functions that take their identifiers as
arguments. Adding a `brandId` parameter is a mechanical change the compiler finds
for us — every call site in `useTemplate.ts:232,286,342,407`,
`useQueryRunner.ts:71`, and `TemplateList.tsx:27,48,64` breaks loudly and gets
fixed. A header requires an interceptor in `web/src/api/client.ts:26`, which reads
brand from somewhere the pure functions cannot see, and **every one of those call
sites keeps compiling while being silently wrong**. The client's existing
architecture is explicitly interceptor-free (`client.ts:2-4`: *"No axios, no
interceptors, no library"*). Path scoping works with that grain; a header fights it.

Supporting reasons: the URL the user sees (`/brands/:brandId/templates/:id`)
mirrors the URL the API is called with, so a bookmark, a shared link, and a
back-button all carry scope; server logs (`query.ts:96`) become attributable
without a new field; and a mis-scoped request 404s at the router instead of
succeeding against the wrong brand.

**The redundancy objection, answered.** Template ids are UUIDs
(`templateService.ts:59`), so `:brandId` in `/api/brands/:brandId/templates/:id`
is technically redundant. Keep it anyway: it makes scope a *precondition checked
once in middleware* rather than a term each of the ~12 handlers must remember to
include. Assumption #14 — `delete(id)` with no scope term — is the kind of thing
that happens when scope is optional to mention.

**Mis-scoped requests return 404, never 403.** Existence of another brand's
template id is not something to confirm.

### 2.2 Route table

Global — deployment-level, deliberately unscoped (§0.1):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | unchanged |
| POST | `/api/render` | unchanged; stateless compile |
| GET | `/api/settings` | unchanged shape; `apiKeyConfigured` becomes live (fix #44) |
| PATCH | `/api/settings` | unchanged |

Brands:

| Method | Path | Codes |
|---|---|---|
| GET | `/api/brands` | 200 `BrandSummary[]` |
| POST | `/api/brands` | 201 · 400 · 409 (slug taken) |
| GET | `/api/brands/:brandId` | 200 · 404 |
| PATCH | `/api/brands/:brandId` | 200 · 400 · 404 · 409 (stale) |
| DELETE | `/api/brands/:brandId` | 204 · 404 · 409 (non-empty, see below) |

Tokens — **one versioned document per brand, not individually addressable rows**:

| Method | Path | Codes |
|---|---|---|
| GET | `/api/brands/:brandId/tokens` | 200 `{ tokens, version }` · 404 |
| PUT | `/api/brands/:brandId/tokens` | 200 · 400 · 404 · 409 (stale) — whole-set replace |
| PATCH | `/api/brands/:brandId/tokens` | 200 · 400 · 404 · 409 — shallow merge |

Rationale for the document shape: the UI edits a token set as a unit, and
per-token endpoints would mean per-token versions, which makes "preview the
propagation of this change" incoherent — you would be previewing against a set
that has no single version to pin. One version per set keeps §3 tractable.

Components:

| Method | Path | Codes |
|---|---|---|
| GET | `/api/brands/:brandId/components` | 200 · 404 |
| POST | `/api/brands/:brandId/components` | 201 · 400 · 404 · 422 (malformed mjml) |
| GET | `/api/brands/:brandId/components/:componentId` | 200 · 404 |
| PATCH | `/api/brands/:brandId/components/:componentId` | 200 · 400 · 404 · 409 · 422 |
| DELETE | `/api/brands/:brandId/components/:componentId` | 204 · 404 · 409 (in use — see §2.5) |

Templates:

| Method | Path | Codes |
|---|---|---|
| GET | `/api/brands/:brandId/templates` | 200 · 404 |
| POST | `/api/brands/:brandId/templates` | 201 · 400 · 404 · 422 |
| GET | `/api/brands/:brandId/templates/:templateId` | 200 · 404 |
| PATCH | `/api/brands/:brandId/templates/:templateId` | 200 · 400 · 404 · 409 · 422 |
| DELETE | `/api/brands/:brandId/templates/:templateId` | 204 · 404 |
| POST | `/api/brands/:brandId/templates/:templateId/query` | 200 · 400 · 404 · 409 · 412 · 413 · 429 · 502 · 503 |

Component **versions** — immutable, append-only (added per `ui-designer`; see §9.2):

| Method | Path | Codes |
|---|---|---|
| GET | `/api/brands/:brandId/components/:componentId/versions` | 200 · 404 |
| GET | `/api/brands/:brandId/components/:componentId/versions/:n` | 200 · 404 |

Propagation — **plan-persisted** (revised; see §9.1):

| Method | Path | Codes |
|---|---|---|
| POST | `/api/brands/:brandId/plans` | 201 plan (no `afterMjml`) · 400 · 404 · 422 |
| GET | `/api/brands/:brandId/plans/:planId` | 200 · 404 · 410 (superseded) |
| GET | `/api/brands/:brandId/plans/:planId/templates/:templateId` | 200 `{before, canonicalBefore, after}` · 404 |
| POST | `/api/brands/:brandId/plans/:planId/apply` | 200 `PropagationResult` · 404 · 409 · 410 · 422 |
| GET | `/api/brands/:brandId/runs/:runId` | 200 · 404 |
| POST | `/api/brands/:brandId/runs/:runId/undo` | 200 `PropagationResult` · 404 · 409 |

Drift / health (added per `ui-designer`; see §9.3):

| Method | Path | Codes |
|---|---|---|
| GET | `/api/brands/:brandId/components/:componentId/drift` | 200 `DriftReport` · 404 |

Building a plan is a POST because it **creates a durable, addressable resource** —
not merely because the body is large. That is the whole of the §9.1 correction in
one line.

### 2.3 Propagation payloads — persist the plan, stream it lazily

**This section previously specified apply-by-re-derivation and was wrong. See §9.1
for the argument that overturned it.** What follows is the corrected design, which
matches `propagation.md` §3.

The payload problem is real: returning N rewritten templates at 200 × the 256 KB
cap (`createWebApp.ts:15`) is a 50 MB response. But the fix is not to avoid
*storing* the corpus — it is to avoid *shipping* it:

- `POST .../plans` computes the full `PropagationPlan` including every
  `TemplatePlan.afterMjml`, **persists it**, and returns the plan with
  `afterMjml` stripped. The client gets the summary, the per-template status, and
  the per-instance `AttrChange[]` rows — all small.
- `GET .../plans/:planId/templates/:templateId` returns one template's
  `{ before, canonicalBefore, after }` on demand, when the user opens that row.
- `POST .../plans/:planId/apply` writes **the stored `afterMjml`, byte for byte**.
  Apply performs no merging.

So the wire cost is the same lazy shape either way, and the correctness property
that re-derivation gave up — *the bytes validated at plan time are the bytes
written* — is retained. `propagation.md` §4 leans on exactly that: the plan phase
proves every `afterMjml` parses and compiles, which is what reduces the residual
apply-time failure set to just a stale `templates.version` and a DB error.

**Plan lifecycle.** A persisted plan is only valid against the state it was
computed from, so it needs an expiry rule rather than living forever:

- A plan is **superseded** when a new version of its component is published, or
  when its brand's token set version moves. `GET`/`apply` on a superseded plan
  returns **410 Gone** with the successor's id if one exists — not 409, because
  nothing about the request conflicts; the resource itself is no longer current.
- Per-template staleness is *not* supersession. A template edited since planning
  is one item failing `failed-stale` at apply (`propagation.md` §4), reported per
  item, not a reason to invalidate the whole plan.
- Plans are garbage-collectable: they hold a full copy of the corpus, so a
  retention rule (drop superseded plans older than N days, keep any referenced by
  a run) belongs in the schema lane's remit.

**Why supersession must be a server-side check and not a client courtesy:** the
user's diff screen is a photograph of a corpus that keeps moving. Without 410,
someone leaves the tab open over lunch, a colleague publishes v8, and Apply writes
a v7 merge over it with full confidence and a green checkmark.

### 2.4 Brand resolution: middleware, matching the existing mounting style

The codebase's convention is that each router declares **full paths** and is
mounted at `/` (`createWebApp.ts:49-89`; `templates.ts:26` declares
`/api/templates` and is mounted at `"/"`). Keep that — do not introduce Hono
`basePath`-with-param mounting, which is new mechanics for no gain:

```ts
// createWebApp.ts
app.use("/api/brands/:brandId/*", requireBrand(opts.db));
app.route("/", createBrandsRoutes({ db: opts.db }));
app.route("/", createTemplatesRoutes({ db: opts.db }));      // now brand-scoped paths
app.route("/", createComponentsRoutes({ db: opts.db }));
app.route("/", createTokensRoutes({ db: opts.db }));
app.route("/", createPropagationRoutes({ db: opts.db }));
```

`requireBrand` resolves the brand **once** and 404s unknown ids, so every handler
below it can assume existence. This is what replaces the empty `AppVariables` at
`src/server/types.ts:6`:

```ts
// src/server/types.ts
export interface AppVariables {}                     // health, render, settings, /api/brands
export interface AppEnv { Variables: AppVariables }

export interface BrandVariables extends AppVariables {
  brand: BrandRow;                                   // set by requireBrand; always present
}
export interface BrandEnv { Variables: BrandVariables }
```

Two Env types rather than one optional field: a `brand?: BrandRow` would force
every brand-scoped handler to null-check something the middleware guarantees, and
the first person to skip the check writes an unscoped query — which is precisely
assumption #14 returning. Brand routers are `Hono<BrandEnv>`; the unscoped ones
stay `Hono<AppEnv>`.

```ts
export function requireBrand(db: DbHandle): MiddlewareHandler<BrandEnv> {
  return async (c, next) => {
    const brand = new BrandService(db).get(c.req.param("brandId")!);
    if (!brand) return c.json({ error: "Brand not found" }, 404);
    c.set("brand", brand);
    await next();
  };
}
```

**Also move with the paths** (these break silently otherwise):

- `createWebApp.ts:62-63` — body limits are bound to literal `/api/templates`
  paths. Rebind to `/api/brands/:brandId/templates*`. Add a larger cap for
  `/api/brands/:brandId/plans*` (the plan-creation body is just the component
  key and target version; the corpus is never uploaded — §2.3).
- `createWebApp.ts:69` — rate-limit key. Change `keyFn` to
  `` (c) => `query:${c.get("brand").id}:${ipOf(c)}` `` so one client's burst
  cannot starve another's. The seam already exists (`rateLimit.ts:11`); it has
  simply never been used for anything but an IP (#43).
- `query.ts:96-144` — add `brandId` to all three log records (#34).

### 2.5 Two destructive operations that need explicit brakes

`src/db/index.ts:22` sets `foreign_keys = ON`, so an `ON DELETE CASCADE` on
`templates.brand_id` **will** fire. `DELETE /api/brands/:brandId` would then
silently destroy a client's entire template corpus behind a one-line `fetch`.
`TemplateList.tsx:61` shows the current UI's idea of a delete guard is
`window.confirm`.

- `DELETE /api/brands/:brandId` → **409 by default** if the brand has any
  templates or components, with the counts in the body. Cascade only on an
  explicit `?cascade=true`.
- `DELETE .../components/:componentId` → **409 if any template references it**,
  with the referencing template ids. Deleting a component that has been copied
  into 40 templates leaves 40 orphaned copies with no way back; the user must
  choose (detach-and-keep vs. propagate-a-removal) rather than have one picked
  for them.

### 2.6 No compatibility shims for `/api/templates*`

The client is in-repo and updates atomically; the server binds `127.0.0.1`
(`main.ts:67`) and there is no published contract. A 308-redirect shim would have
to redirect to *some* default brand — reintroducing the ambient-default-brand
concept this refactor exists to delete. Hard cut.

---

## 3. Concurrency and optimistic locking

### 3.1 How the existing mechanism works

`templateService.update()` (`templateService.ts:70-101`) is genuinely correct and
should be preserved, not redesigned:

1. `UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?`
   (`:77, :86`) — the version bump is `sql\`${templates.version} + 1\`` computed
   **in SQL**, not read-then-written in JS, so there is no lost-update window.
2. `.returning().all()` (`:87-88`) — one statement decides and reports.
3. Zero rows back ⇒ disambiguating SELECT (`:94-100`) to distinguish `not_found`
   from `stale`. The three-kind union `TemplateUpdateResult` (`:25-28`) is what
   lets `templates.ts:99-100` and `query.ts:132-133` return 404 vs 409 correctly.

`tests/integration/query-route.test.ts:231-257` already proves the property: two
concurrent same-version writes ⇒ exactly `[200, 409]`, final version 2.

**Keep all of this. Add the brand term to the predicate** (`:86`, `:97`, `:104`,
`:51`) and nothing else changes.

### 3.2 What propagation does to it

Propagation is a batch of exactly these conditional updates. The interesting
question is not the mechanism but the policy, and the brief's tab scenario is the
right one to design against.

**The scenario.** Dana is editing template T in a tab. Autosave is debounced 1 s
(`useTemplate.ts:195`). Meanwhile Sam applies a token propagation that touches T.
T's version goes 7 → 8. Dana's next autosave `PATCH` carries version 7 and gets a
409. `useTemplate.ts:306-312` dispatches `PATCH_409`, refetches, and — per the
comment at `:308` — **"pending edit was dropped"**. Dana's unsaved work is gone,
and `reducer` case `PATCH_409` (`:141-142`) sets `pendingPatch: null` confirming it.

This data-loss path exists today. It is currently near-unreachable because the
only writer is the user's own two tabs. Propagation makes a *third party* a
writer, so it becomes routine. **This is the single largest risk in the refactor,
and it is a client-side bug that a server-side change turns from theoretical into
frequent.** It must be on the list even though the fix is partly outside this lane.

**Server-side mitigations that are in this lane:**

1. **Tell the client *why* it lost.** The 409 body today is
   `{ error: "Stale version" }` (`templates.ts:100`, `query.ts:133`) — the UI
   cannot distinguish "your other tab" from "a brand-wide propagation you did not
   initiate", and those deserve different words and different recovery. Extend to:

   ```ts
   { error: "Stale version",
     reason: "concurrent_edit" | "propagation",
     currentVersion: number }
   ```

   `reason` requires knowing what performed the last write — a
   `last_write_source` column on `templates` (`schema-designer`'s call), written
   by the propagation path. Without it, `reason` is a guess.

2. **Return `currentVersion` in the 409** so the client can refetch-and-rebase in
   one round trip instead of the current blind `doRefetch()` (`useTemplate.ts:340`).

3. **Prefer token propagation that does not touch template bodies at all.** MJML
   already has the right primitive: `<mj-attributes>` in `<mj-head>`, and this
   repo already has a surgical editor for it — `src/shared/blocks/mjAttributes.ts`
   (`setMjAttribute(headRaw, element, attr, value)`). A token change routed
   through the head touches a few dozen bytes of `rawXml` and leaves every body
   block byte-identical. It still bumps `version` and still 409s Dana, but the
   *merge* is trivial and a future rebase can be automatic. Component propagation
   has to touch bodies; token propagation mostly does not. This is the highest-
   leverage design choice available and it is `propagation-designer`'s to make —
   flagging it because it decides how bad §3.2 is in practice.

**Conflict policy for the batch itself** — revised to `propagation.md` §4; see
§8.3 for why my original all-or-nothing position was wrong:

- **Per-template atomic, batch non-atomic.** A stale pin on template #17 makes
  that one item `failed-stale` and the run continues. Each template is
  independently coherent before and after, so 39-of-40 is a work queue, not an
  incoherent corpus — *provided* the run is durably recorded and the failures are
  named, which `PropagationResult.items` does.
- **Systemic failures abort the whole run**: DB unavailable, component definition
  unloadable, or more than a configurable fraction of items failing (default 25%
  — if a quarter of writes fail, the premise of the run is wrong).
- **Undo is what makes partial application acceptable**, and it is the reason the
  per-item write must pair the template update with its `prevMjml` record
  atomically (§8.3).

A template deleted since planning is `failed-stale` with `currentVersion: null`,
reported per item — never a silent skip.

---

## 4. Transactions

### 4.1 Today: none. Zero uses.

`grep -rn "transaction" src/ tests/` returns **no hits in server or db code** (the
only matches are `EMAIL_DESIGNER_BEGIN_EDIT` postMessage strings in
`web/src/canvas/`). Every write in the codebase is a single autocommitted
statement — which is why nothing has needed one yet, and `templateService.update`
is atomic purely because it is one statement.

The support is present and unused: `drizzle-orm@0.45.2` with
`drizzle-orm/better-sqlite3` exposes
`transaction<T>(cb: (tx) => T, config?: SQLiteTransactionConfig): T` — verified in
`node_modules/drizzle-orm/better-sqlite3/session.d.ts:28`.

### 4.2 The API to use

The propagation case is **one small transaction per item**, not one around the
batch — §8.3 has the worked example and the argument. Brand delete with cascade
(§2.5) is the genuinely all-or-nothing case:

```ts
import type { DbHandle } from "../../db/index.js";

db.transaction(
  (tx) => {
    const ts = new TemplateService(tx);   // stateless — cheap to re-instantiate on tx
    new ComponentService(tx).deleteAllForBrand(brandId);
    ts.deleteAllForBrand(brandId);
    new BrandService(tx).delete(brandId, expectedVersion);
  },
  { behavior: "immediate" },
);
```

Three things that are not optional here, at either granularity:

**(a) The callback is synchronous. There is no `await` inside it.** better-sqlite3
is a synchronous driver; drizzle types this as `Result<'sync', T> = T`. An `async`
callback would return a Promise *from inside* the transaction and the transaction
would commit before any awaited work ran — a classic silent corruption. So
**every LLM call, and any other async step, must happen before the transaction
opens.** Propagation as designed is fine: `fast-xml-parser` parsing and the
string-slicers in `headEdit.ts` / `mjAttributes.ts` are all synchronous and pure.
If propagation ever grows an LLM-assisted rewrite, the structure becomes
*compute-all-rewrites-async → then open the sync transaction to write*, and this
must be enforced by code shape, not by a comment.

**(b) `{ behavior: "immediate" }` is required, not a nicety.** `src/db/index.ts:21`
sets `journal_mode = WAL`. SQLite's default `deferred` transaction acquires a read
lock first and upgrades to a write lock on the first write; if another connection
took the write lock in between, the upgrade fails with `SQLITE_BUSY` and — because
the upgrade failure happens mid-transaction — it **cannot be retried by waiting**.
`immediate` takes the write lock up front and is subject to the normal busy
timeout. Propagation is a long multi-statement write, so it is exactly the case
that hits this.

**(c) Services must be able to run inside a transaction.** Today they cannot:
`templateService.ts:35` takes `DbHandle`, and route factories construct one
instance at startup (`templates.ts:24`, `query.ts:36-37`), closing over the
non-transactional handle. Widen the constructor parameter with a type derived from
drizzle's own signature — no internal drizzle imports:

```ts
// src/db/index.ts
export type DbHandle = ReturnType<typeof drizzle<typeof schema>>;
export type DbTx = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
export type DbExecutor = DbHandle | DbTx;
```

Then every service takes `DbExecutor`. Normal routes keep constructing once at
factory time as they do now; only propagation constructs inside the callback.
Services are stateless, so this costs nothing.

**(d) Set a busy timeout.** `src/db/index.ts:20-23` sets three pragmas but not
`busy_timeout`, which defaults to 0 — a concurrent writer fails instantly rather
than waiting. Add `client.pragma("busy_timeout = 5000")`. One line, and without it
`immediate` in (b) buys much less than it should.

**Also worth wrapping, beyond propagation:** brand delete with cascade (§2.5) —
so a failure partway through does not leave a brand row deleted with orphaned
children, or vice versa.

---

## 5. The LLM layer

### 5.1 What changes

The AI should know the brand's tokens and component catalog; otherwise it will
cheerfully emit `#1f6feb` (the `BLOCK_REGISTRY` default at `registry.ts` for
`mj-button`) into a brand whose primary is something else, and the user's first
impression of the "design system" is the assistant ignoring it.

```ts
// src/llm/promptBuilder.ts
export interface BrandContext {
  name: string;
  tokens: Record<string, string>;                  // "color.primary" → "#0b7"
  components: Array<{ name: string; description: string | null; mjml: string }>;
}

export interface BuildPromptInput {
  mjml: string;
  query: string;
  registry?: Readonly<Record<string, BlockDef>>;
  brand?: BrandContext;                            // ← OPTIONAL, deliberately
}

export interface BuiltPrompt {
  systemGuidance: string;
  blockCatalog: string;
  brandContext: string;                            // "" when no brand
  mjml: string;
  query: string;
}
```

`brand` is **optional** on purpose: it keeps the brand-free path alive and
testable, and it means the eleven existing assertions in
`tests/unit/promptBuilder.test.ts` keep passing untouched, which is a real signal
that the catalog logic did not regress while the brand logic was added.

`brandContext` is a **separate field, not concatenated into `blockCatalog`**, for
three reasons: the promptBytes accounting at `query.ts:82-83` sums the fields
individually and would otherwise silently undercount; the two adapters assemble
the system prompt differently (`anthropicApi.ts:33`, `claudeCodeCli.ts:65`) and a
named field keeps them honest; and it can be ordered independently for caching
(below).

**Ordering inside the system prompt — most-stable-first, for prompt caching:**

```
SYSTEM_GUIDANCE   (process-constant)
blockCatalog      (process-constant)
brandContext      (constant per brand, across every turn for that brand)
```

Then the cacheable prefix grows with each brand's traffic instead of being
invalidated per request. Getting this order wrong costs nothing functionally and
everything in latency and spend.

**`SYSTEM_GUIDANCE` (`promptBuilder.ts:23-47`) needs one new rule.** Line 45 says
*"Use only the block types listed in the catalog."* A design-system product needs
the stronger, ordered rule — roughly: *when a brand component covers what the user
asked for, use the component's markup verbatim rather than composing raw blocks;
use brand token values rather than inventing colors, fonts, or spacing.* Without
it, supplying `brandContext` is decorative: the model has the tokens in context
and no instruction preferring them.

**`STARTER_MJML` (`promptBuilder.ts:10-12`)** is read once at module load from a
single file. The empty-body branch (`:102-104`) injects it for every brand. Should
become the brand's starter when one exists, falling back to the file. Small, but
it is the first thing a user sees on a new template.

**Propagate the field through the adapter contract:**

```ts
// src/llm/types.ts:8-14
export interface LLMAdapterInput {
  systemGuidance: string;
  blockCatalog: string;
  brandContext: string;      // ← new
  mjml: string;
  query: string;
  model: string;
}
```

…and assemble it in both adapters (`anthropicApi.ts:33`, `claudeCodeCli.ts:65`).
Those two lines are duplicated logic today (#55/#56); this is a good moment to
extract a shared `composeSystemPrompt(input)` so the two cannot drift.

`query.ts:81-83` must also add `built.brandContext.length` to `promptBytes`.

### 5.2 The snapshot test will break. That is the test working.

`tests/unit/promptBuilder.snapshot.test.ts` holds three snapshots
(`frozen-non-empty-catalog`, `frozen-empty-body-catalog`, `system-guidance`) in
`tests/unit/__snapshots__/promptBuilder.snapshot.test.ts.snap`. Its own header
says: *"If this snapshot ever drifts, every Claude turn's prompt is changing too.
Review the diff carefully before regenerating."*

Every Claude turn's prompt **is** changing. This is intentional drift and the
detector firing is correct behavior.

- **Keep the test.** Do not delete it and do not weaken it to `toContain`. It is
  the only thing standing between the prompt and unreviewed edits.
- Regenerate with `vitest -u` **after** reading the diff, as the header instructs.
- **All three snapshots change.** (This corrects an earlier draft of this
  section, which guessed the two catalog snapshots might survive byte-identical.
  They do not: §8.2 adds an identity-attribute section to `blockCatalog`, and the
  component-preference and preserve-identity rules both land in
  `SYSTEM_GUIDANCE`.)
- **Add a fourth case** with a frozen `BrandContext` fixture, in the same
  style as the frozen registry at `:13-38`, so brand rendering is byte-pinned too
  — including the ordering of `Object.keys(tokens).sort()`, without which the
  prompt is nondeterministic across runs and both the snapshot and prompt caching
  break intermittently. The existing code is careful about exactly this
  (`promptBuilder.ts:85-87, 121`); the brand serializer must be equally careful.

---

## 6. What breaks

### 6.1 Server tests

| File | Verdict | Why |
|---|---|---|
| `tests/integration/templates-routes.test.ts` | **Update** (all 8 cases) | Every URL moves under `/api/brands/:brandId/`. Assertions are all still correct and worth keeping — needs a brand fixture in `beforeEach` and path rewrites. Mechanical. |
| `tests/integration/query-route.test.ts` | **Update** (all 11 cases) | Same path rewrites. `:68-70` (model + catalog assertions) survive as-is. Add a case asserting `brandContext` reaches the adapter via `stub.calls[0]`. |
| `tests/integration/services.test.ts` — `TemplateService` block (`:53-113`) | **Update** (7 cases) | Every call gains a leading `brandId`. Assertions unchanged. |
| `tests/integration/services.test.ts:23-30` — *"get() lazily seeds the singleton"* | **DELETE** | It pins the write-on-read bug (§0.1). Replace with a test that `get()` performs **no** write and that the migration seeded the row. This is the one test where "update" is the wrong answer. |
| `tests/integration/services.test.ts:32-37` — *"get() is idempotent"* | **Keep**, meaning inverts | Still passes, and after the fix it means something stronger. |
| `tests/integration/settings-routes.test.ts` | **Keep** (7 cases) | Settings stays global (§0.1), so every case still holds. Only the stale `describe` title at `:6` changes. **That this file survives untouched is the evidence for §0.1.** Add one case for the `apiKeyConfigured`-goes-live fix (#44). |
| `tests/integration/createWebApp.test.ts` | **Mostly keep** | health (`:24`), render (`:34`, `:51`), unknown-route-404 (`:63`) all unaffected. Add: unknown brand ⇒ 404 from `requireBrand`; and an Origin-rejection case if §0.4 is taken. |
| `tests/unit/promptBuilder.snapshot.test.ts` | **Update + regenerate** | §5.2. Expected. |
| `tests/unit/promptBuilder.test.ts` | **Keep all 11** | `brand` optional ⇒ untouched. Add ~3 brand cases. |
| `tests/unit/anthropicApi.test.ts` | **Keep**, extend | `baseInput` (`:13-19`) gains `brandContext`. Add a case asserting it lands in `system`. |
| `tests/unit/claudeCodeCli.test.ts` | **Keep**, extend | Same, for `--system-prompt`. |
| `tests/unit/blocks.*.test.ts` (5 files, 612 lines) | **Untouched** | Pure functions over MJML strings. Propagation will lean on `mjAttributes.ts` heavily — its 201-line test file becomes more load-bearing, not less. |
| `tests/helpers/makeTestDb.ts` | **Extend** | Add `seedBrand(db, overrides?)`. Every integration test needs it. |
| `tests/helpers/index.ts` | **DELETE** | Dead placeholder promising eight never-built helpers (#60). Deleting it is part of the work, not incidental to it. |

### 6.2 Web tests

Not this lane's implementation, but they are in the blast radius and someone must
own them:

| File | Verdict |
|---|---|
| `tests/unit/web.useTemplate.spec.tsx` (346 lines) | **Update** — largest single test cost in the repo; mocks `getTemplate`/`patchTemplate` whose signatures gain `brandId`. |
| `tests/unit/web.useQueryRunner.spec.tsx` (205) | **Update** — `runQuery` signature. |
| `tests/unit/web.TemplateList.spec.tsx` (98) | **Update** — `listTemplates`/`createTemplate`/`deleteTemplate`. |
| `tests/unit/web.TemplateRoute.spec.tsx` (80) | **Update** — route params. |
| `tests/unit/web.SidebarShell.spec.tsx` (69) | **Update** — `useMatch("/templates/:id")` (`SidebarShell.tsx:24`) becomes brand-scoped. |
| `tests/unit/web.Settings.spec.tsx` (111), `web.useSettings.spec.tsx` (95) | **Keep** — settings stays global. |
| `tests/unit/web.api-client.spec.ts` (123) | **Keep** — tests the generic `request()` primitive, which does not change (and would have had to, under a header design — another point for §2.1). |
| `web.DeviceToggle` / `IconRail` / `SelectionToolbar` (169) | **Keep** — no API coupling. |
| `web.PropertiesPanel` / `web.RightPanel` (254) | **Keep — from this lane.** No API coupling, so nothing here forces a change. The UI lane *does* modify both components, with new props designed optional so these assertions still pass. "Keep" means "this refactor does not break them", not "nobody touches them". |

**Net:** of 26 test files, ~6 keep, ~13 update mechanically, **1 deletes**
(`tests/helpers/index.ts`), **1 test case deletes** (`services.test.ts:23-30`),
1 regenerates by design.

---

## 7. Effort, blunt

| Area | Effort | Honest assessment |
|---|---|---|
| Schema + migration (brands, components, tokens, `brand_id` FK, backfill) | **S–M** | Small on a fresh DB, and any existing DB has one deployer's data — a backfill into one bootstrap brand. Also regenerate to fix the `default_mode` drift (#6). Owned by `schema-designer`. |
| Service scoping (`TemplateService`, new `BrandService`/`ComponentService`/`TokenService`) | **S** | The genuinely easy part. `templateService.ts` is 107 lines; adding a brand term to four predicates is an afternoon, and the compiler finds every call site. |
| `SettingsService` write-on-read fix | **S** | Migration seed + pure read + delete one test. Under an hour and it removes a real race. |
| Route re-pathing + `requireBrand` + `BrandEnv` split | **M** | Mostly mechanical. The fiddly parts are the ones that fail *silently*: body limits bound to literal paths (#42), the rate-limit key (#43), and the `apiKeyConfigured` staleness (#44). None break a test when missed. |
| Brands / components / tokens CRUD routes | **M** | Three more routers in the established shape of `templates.ts`. Volume, not difficulty. |
| Transactions (`DbExecutor`, `immediate`, `busy_timeout`) | **S** | ~20 lines. Small *provided* the sync constraint in §4.2(a) is respected. If anyone later puts an `await` in that callback it becomes a silent-corruption bug that no current test would catch — worth a comment at the call site and, better, a `DbTx`-typed parameter that makes the async version not typecheck. |
| Propagation preview + apply (this lane: the API and the transaction) | **M** | The endpoints and the conflict protocol are tractable. |
| Propagation **rewrite algorithm** (other lane) | **L** | The real work and the real risk: identifying component instances inside arbitrary user-edited MJML, handling instances the user has since hand-modified, and staying deterministic (§2.3). Every hard question in this refactor lives here. |
| LLM brand-awareness | **S–M** | The plumbing is small. Composing a `brandContext` that is deterministic (sorted keys), token-budgeted, and actually improves output is prompt work with a feedback loop, and that is where the time goes — not in the types. |
| Web client update | **M–L** | ~20 call sites plus router restructuring plus a brand switcher UI. The 346-line `useTemplate` test is the single largest item. |
| Test updates | **M** | ~13 files, mechanical, high volume. |
| **The 409-drops-unsaved-work path** (`useTemplate.ts:306-312`) | **M, and non-optional** | Not a refactor task — a pre-existing bug that this refactor promotes from theoretical to routine (§3.2). Shipping propagation without addressing it means shipping a feature that silently eats designers' work, and the first bug report will not say "propagation", it will say "the editor lost my changes". |
| README correction + Origin check (§0.4) | **S** | ~15 lines of middleware plus a README rewrite. The README currently documents a security control that does not exist; that is worth fixing on its own merits, independent of this refactor. |

**Sequencing that keeps the tree green:** schema+backfill → services → routes+middleware
→ tests → LLM → propagation → web. The LLM change is independent of everything else
and can run in parallel from day one.

**If something has to be cut:** cut per-brand LLM *components* from the prompt
(keep tokens — they are small, high-signal, and cheap). Do not cut the transaction,
the 409 `reason`/`currentVersion` fields, or the brand term in the `delete`
predicate (#14).

---

## 8. Addendum — verified findings folded in

Everything below was reproduced in this working copy rather than taken on report.
Two items change the plan materially: §8.1 moves to the front of the sequencing,
and §8.2 adds a new prompt section that revises §5.2.

### 8.1 Step 0 — the migration baseline is broken, and it blocks *authoring* this refactor

**Verified.** `.gitignore:19-20` ignores `drizzle/migrations/meta/`, with a comment
asserting the SQL files are committed and the metadata deliberately is not.
`git ls-files drizzle` returns exactly one path — `drizzle/migrations/0000_initial.sql`.
The `meta/_journal.json` present on disk is timestamped 14:41 against 14:24 for
every tracked file: it was reconstructed locally, not cloned.

Reproduced the clean-clone failure directly, with a control. Same folder, same
`0000_initial.sql`, the only variable being the presence of `meta/`:

```
folder contains 0000_initial.sql, no meta/   →  MIGRATION FAILED: Can't find meta/_journal.json file
same folder + meta/_journal.json             →  MIGRATION OK
```

So `makeTestDb` (`tests/helpers/makeTestDb.ts:23`) dies for every DB-touching
test, and `npm run db:migrate` fails identically for any new deployer. The
`.gitignore:19` comment is simply wrong — drizzle's journal is what defines
migration order and applied-state, and it belongs in VCS.

**The part that was not reported, and that matters more for this lane.** Restoring
`_journal.json` alone is *not* sufficient. The meta directory also needs the
per-migration **snapshot** (`0000_snapshot.json`), which is what `drizzle-kit
generate` diffs the current `schema.ts` against. It is absent. I ran generate
against a baseline containing the SQL and the journal but no snapshot:

```
$ npx drizzle-kit generate --dialect sqlite --schema ./src/db/schema.ts --out <tmp>
2 tables
settings   5 columns 0 indexes 0 fks
templates  7 columns 1 indexes 0 fks
[✓] Your SQL migration file ➜ 0001_worthless_sabretooth.sql
```

…and `0001_worthless_sabretooth.sql` is a **verbatim re-creation of both existing
tables** — `CREATE TABLE settings`, `CREATE TABLE templates`, `CREATE INDEX
templates_updated_idx`. With no snapshot, drizzle diffs against an empty baseline
and emits the whole schema again. Applied to an existing database that migration
fails with *table already exists*.

This refactor's first real task is a migration adding `brands`, `components`,
`tokens`, and `templates.brand_id`. **That migration cannot be generated correctly
until the snapshot baseline is restored.** This is not only "the suite doesn't
run" — it is "the central artifact of this lane cannot be authored."

Incidental confirmation from the same run: the emitted file contains
`default_mode text DEFAULT 'cli'`, against `'api'` in the committed
`0000_initial.sql:4`. That is inventory item #6 reproduced, and it establishes
`schema.ts` as the newer truth.

**Fix (step 0, one commit, before anything else):**

1. Delete `.gitignore:19-20`.
2. Regenerate the baseline: drop `0000_initial.sql`, run `drizzle-kit generate`
   against current `schema.ts` to emit a fresh `0000_*.sql` **plus**
   `meta/_journal.json` and `meta/0000_snapshot.json`. This produces a correct
   snapshot baseline and fixes the `default_mode` drift in the same move.
3. Commit `drizzle/migrations/meta/` in full.
4. Verify: `rm -rf node_modules && npm ci && npm test` from a clean clone.

**The condition under which step 2 is safe, stated explicitly:** regenerating the
baseline discards migration history, which is fine *only* if no deployed database
holds data. Everything points that way — `data/` is gitignored (`.gitignore:17`),
the server binds `127.0.0.1` (`main.ts:67`), and the product is pre-pivot. But
this is the lead's call, not mine. If any real database exists, step 2 becomes
"hand-write `0000_snapshot.json` to match the deployed schema", which is fiddly
and worth doing carefully rather than quickly.

**Also worth pinning:** `.nvmrc` says `20`, this machine is on `v26.0.0`, and the
suite has evidently never been run from a clean install here. Add a CI job that
does `npm ci && npm test` on the `.nvmrc` version — otherwise "it passes locally"
keeps meaning nothing.

**Revised sequencing:** **step 0 (migration baseline + CI)** → schema+backfill →
services → routes+middleware → tests → LLM → propagation → web.

### 8.2 Component identity attributes and the LLM

**The answer: all three mechanisms, layered — but not by putting identity into
`allowedAttrs`, and the post-turn restore is the only one that carries the
guarantee.**

**First, a constraint that outranks the question, from the peer's own scratch proof.**
`.plan/scratch/propagation-proof.test.ts` passes PROOF 1, 2, 4 and 5 — simple
stamps like `data-cmp="shoe-brand/hero"` and `data-cmp-v="7"` survive parse and
serialize, hold insertion order (`data-*` first stays first), are byte-stable
across ten cycles, and `mjml2html` tolerates them. But **PROOF 3 fails**, and its
failure is the interesting one:

```
data-cmp-lock  '{"attrs":["color","font-size"]}'  →  '{&quot;attrs&quot;:[&quot;color&quot;,...]}'
data-cmp-hash  "a&amp;b&lt;c"                     →  "a&amp;amp;b&amp;lt;c"
```

The second line is **cumulative double-escaping**: each parse/serialize cycle
re-escapes the ampersand, so the value grows and corrupts a little more on every
save. (`.plan/scratch/probe3.test.ts` is evidently a proposed serializer fix for
this, and it is also failing — so treat the escaping bug as open.)

**Therefore: identity attribute values must be restricted to `[A-Za-z0-9._/-]`** —
a slug and an integer, nothing else. No JSON, no `&`, no quotes, no `<`. This
sidesteps the serializer bug entirely rather than depending on it being fixed
first. Concretely, `data-cmp-lock='{"attrs":[...]}'` is **not viable as an
attribute**; per-instance lock state belongs in a DB column keyed by
`(templateId, cmpPath)`, not in the MJML. Worth stating as a hard rule in the
component model, because the failure is silent and compounding.

**Now the three mechanisms.**

**(a) `allowedAttrs` should NOT gain the identity attrs.** Two reasons:

- **It has a second consumer.** `registry.ts:5-9` is explicit that `allowedAttrs`
  is *"a UI-form view filter consumed by `PropertiesForm.tsx` at form-render
  time"*. Adding `data-cmp` there makes component identity an **editable text
  input in the properties panel**. A designer could retype the component id of an
  instance by hand. That is strictly worse than the problem being solved.
- **Identity is universal, not per-block.** Any block can be a component root, so
  identity would have to be duplicated into all twelve registry entries and kept
  in sync by discipline.

Instead, add one catalog-level section in `promptBuilder`, adjacent to the
per-block lines — no `BlockDef` change, no registry churn, no effect on
`PropertiesForm.tsx`:

```ts
const IDENTITY_ATTRS_NOTE = `Identity attributes — these may appear on any block:
  data-cmp, data-cmp-v, data-cmp-i, data-cmp-h
Copy them through verbatim on every block that has them. Never add, edit, remove,
or move them to a different block. They are not styling and have no visual effect.`;
```

**Correction to the stamp set.** An earlier draft of this section guessed at
`data-cmp-slot`. The real stamp, per `propagation.md` §1, is four attributes:
`data-cmp` (`brandSlug/componentSlug`), `data-cmp-v` (integer merge base),
`data-cmp-i` (8-char instance id), `data-cmp-h` (8-char override tripwire hash).
All four fall inside the `[A-Za-z0-9._/-]` restriction this section derives from
the PROOF 3 double-escaping failure — a slug, an integer, and two hex-ish
identifiers. **The constraint and the stamp design are compatible as they stand**,
which is worth recording explicitly, because the constraint is the thing that
stays true only for as long as nobody adds a fifth, richer attribute.

**(b) The prompt rule is necessary and insufficient.** It goes in
`SYSTEM_GUIDANCE` alongside the component-preference rule from §5.1. But
`promptBuilder.ts:41` asks the model for *"the COMPLETE updated MJML source"* on
every turn, so every attribute is re-emitted from scratch every time, and a
soft instruction against a stochastic rewrite will eventually lose. Worse, the
loss is **silent in every existing check**: `query.ts:116` validates only
`isParsableMjml`, and a de-stamped document parses fine, renders fine, and looks
correct. The instance simply detaches, and nobody finds out until a propagation
mysteriously skips that template.

**(c) The post-turn restore is the actual guarantee, and this codebase already
has the addressing mechanism for it.** `src/shared/blocks/stampPaths.ts` computes
structural paths for blocks (`data-mjml-path`, used today to anchor the iframe
overlay). Reuse that addressing:

```ts
export interface IdentityStamp {
  path: string;                                  // structural path, stampPaths-style
  type: BlockType;
  attrs: ReadonlyMap<string, string>;            // data-cmp, data-cmp-v, data-cmp-i, data-cmp-h
}

/** Pre-turn: harvest stamps from the document the user is editing. */
export function harvestIdentity(mjml: string): IdentityStamp[];

/** Post-turn: re-apply stamps to blocks that still resolve at the same path AND type. */
export function restoreIdentity(
  mjml: string,
  stamps: readonly IdentityStamp[],
): { mjml: string; restored: number; detached: IdentityStamp[] };
```

Wired into `query.ts` around the adapter call — both walks are synchronous and
cheap, and they happen after the `isParsableMjml` check at `:116` and before
`ts.update` at `:131`.

**Match conservatively: on `(path, type)`, and drop the stamp when either moved.**
The asymmetry is the whole design. A lost stamp means propagation skips one
template — visible, recoverable, the user re-attaches. A *wrongly restored* stamp
means propagation overwrites content that was never an instance — invisible and
destructive. So prefer false negatives, always. And a block the model genuinely
restructured arguably *should* lose its identity; that is a correct answer, not a
consolation.

**Then make the residue loud.** `restoreIdentity` returns `detached` — stamps that
could not be re-placed. Surface that in the `/query` response so the UI can say
*"Claude restructured the hero section; it is no longer linked to the Hero
component"*, and log it (`query.ts:135-144`) so the rate of detachment is
measurable. Silent detachment is the failure being designed against; converting it
into a message is most of the fix, and it is the part that fails safe if the
matching heuristic is imperfect.

**Why keep the stamps visible to the model at all**, rather than stripping them
pre-turn and restoring after (which would make dropping them impossible)? Because
§5.1 wants the model brand-aware, and a model that cannot see component boundaries
cannot honor them — it will cheerfully restructure the interior of a component
instance. Stripping trades a silent-detachment problem for a silent-divergence
problem. Better to show the model the boundaries, tell it the rule, and keep the
deterministic restore as the backstop.

**Snapshot impact:** `blockCatalog` gains the identity section and
`SYSTEM_GUIDANCE` gains two rules, so **all three snapshots in
`promptBuilder.snapshot.test.ts` change** — including the two catalog ones. §5.2
has been corrected accordingly. The guidance in §5.2 stands: read the diff, then
`vitest -u`; do not weaken the assertions. Add a fourth case pinning the identity
section, and a `promptBuilder.test.ts` case asserting the identity attrs are
*absent* from every per-block `attrs=[...]` list — that is the regression guard
for someone later "helpfully" adding them to `allowedAttrs`.

### 8.3 Batch atomicity — superseded by §9.1; the transaction narrows, it does not vanish

**This section argued that one transaction around the whole batch is what prevents
the half-apply worst case. `propagation.md` §4 rebuts it and is right; see §9.1.**
The short version: I claimed a half-applied brand change leaves "a state no one
chose". That is false here. Each template is independently coherent before and
after, so 39-of-40 is not an incoherent corpus, it is a work queue — provided the
run is *recorded* and the remaining one is *named*, which their design does.

What survives, and is a narrower requirement rather than a retreat:

**Each item's two writes must be atomic together.** Applying one template writes
the template row *and* the run-item record carrying its `prevMjml`. If those can
diverge, undo is corrupted in one of two directions: a stored `prevMjml` for a
write that never landed, or a landed write with no undo record. `propagation.md`
§4 rests undo on `prevMjml` being durable per item, so this pairing is load-bearing
for it.

```ts
for (const item of plan.templates) {
  const outcome = db.transaction((tx) => {
    const r = new TemplateService(tx).update(brandId, item.templateId,
                                             item.templateVersion, { mjml: item.afterMjml! });
    if (r.kind !== "ok") return { outcome: "failed-stale" as const, ... };
    new RunService(tx).recordItem(runId, { templateId: item.templateId,
                                           prevMjml, outcome: "applied", ... });
    return { outcome: "applied" as const, toVersion: r.row.version };
  }, { behavior: "immediate" });
  results.push(outcome);
}
```

N small transactions, not one large one. Everything in §4.2 still applies and
matters *more* at this granularity, not less:

- **(a) the callback is synchronous** — unchanged, and now inside a loop, so an
  `async` callback would commit N times before its awaited work ran;
- **(b) `behavior: "immediate"`** under WAL — unchanged;
- **(d) `busy_timeout`** — *more* important now: N sequential write transactions
  against a concurrently-edited database is precisely the contention case a
  zero busy-timeout turns into instant failure.

And the other transaction site in §4 is untouched: brand delete with cascade
(§2.5) is genuinely all-or-nothing and still wants one.

**The client-side half is unchanged and still unowned.** Dana's 1000 ms-debounced
save losing its pending edit to a 409 (`useTemplate.ts:306-312`, whose own comment
reads *"pending edit was dropped"*) is untouched by any of this. Per-item atomicity
does not help her; §3.2's `reason` + `currentVersion` in the 409 body is the
server's contribution, and the client-side rebase needs an owner.

### 8.4 Baseline: what actually passes today

Ran the suite in this working copy (where `meta/_journal.json` happens to exist):

```
Test Files  2 failed | 28 passed (30)
     Tests  2 failed | 222 passed (224)
```

**Both failures are in `.plan/scratch/` — peer scratch probes, not the repo's
suite.** All 26 files under `tests/` pass, including all 41 integration tests. So
the numbers reported to me (42 failed / 167 passed) describe the *clean-clone*
state, and both are true of different environments: from a clean clone the meta
directory is absent and everything DB-touching dies; with it reconstructed, the
suite is green.

Two consequences. First, the §6 blast-radius counts are measured against a
genuinely green baseline, so post-refactor failures will be attributable to the
refactor. Second — `vitest.config.ts` has no `include` restriction, so it picks up
`.plan/scratch/*.test.ts` as part of the run. Those scratch files should be
deleted or promoted before this lands; leaving them means a red suite that
everyone learns to ignore, which is how a real failure gets waved through.

---

## 9. Reconciliation with `propagation.md` and `ui.md`

### 9.1 Apply mechanics — conceded. Persist the plan; apply by `planId`.

`propagation.md` §3 wins. My §2.3 re-derivation design is withdrawn and the
section has been rewritten. The argument I lost to, and one reason neither lane
stated that is stronger than both:

**My case was that re-derivation is deterministic, so preview and write agree by
construction.** Determinism does survive the D1 non-idempotence finding —
`f(x)=y` holds even where `f(y)≠y` — so that part of my reasoning was not wrong.

**It fails for a different reason, and the failure is not small.** The merge in
`propagation.md` §2 is not a function of `{change, templateMjml}`. It is a
three-way merge whose inputs include the `ComponentDef` at the instance's
`data-cmp-v` (the merge base), the `ComponentDef` at the target version, and the
component's declared ownership/`locked` policy. My `pins` pinned only
`templates.version`. **They do not pin the component definition state at all.**
Publish a new component version, or edit a `locked` list, between preview and
apply, and re-derivation silently produces a different result than the one the
user approved — the exact failure my own §2.3 warned about, arriving through a
door I had not noticed. Closing it properly would mean pinning the target
version, every distinct base version in the corpus, and the ownership policy;
at which point I am reconstructing the plan, badly, and persisting it is simpler
and strictly safer.

**The second loss is one I should have caught from their §4.** "Validate
everything before writing anything" — plan-phase `isParsableMjml` plus
`mjml2html` on every `afterMjml` — is only a guarantee if *the validated bytes
are the written bytes*. Under re-derivation you validate one artifact and write a
recomputed one. Even when they agree, the guarantee is gone, and with it their
reduction of apply-time failures to "stale version or DB error". I would have
reintroduced "the recomputed MJML does not compile" as a post-Apply surprise.

**And `ui-designer` is right that their §3 already dissolves my payload
objection.** I conflated *don't ship the corpus over the wire* (correct) with
*don't store the corpus* (not required, and wrong). Persist the plan, return it
without `afterMjml`, fetch one pair on demand: same lazy wire shape, none of the
cost. My objection was answered before I raised it.

**What I add rather than merely accept** — plan **supersession**, now specified in
§2.3. A persisted plan is a photograph of a moving corpus. `GET`/`apply` on a plan
whose component has been re-published, or whose brand token-set version has moved,
must return **410 Gone** with the successor id. Without that, someone leaves the
diff screen open over lunch, a colleague ships v8, and Apply writes a v7 merge
over it with a green checkmark. Per-template staleness stays what
`propagation.md` §4 makes it — one item's `failed-stale`, not a whole-plan
invalidation.

### 9.2 Component version reads — added

Agreed and added to §2.2. The properties panel resolves ownership against the
`ComponentDef` at the instance's `data-cmp-v`, which `propagation.md` §1 is
explicit is the **merge base, not a current-version marker**. Addressing
components by `componentId` alone, as my original table did, cannot express that
read at all.

```
GET /api/brands/:brandId/components/:componentId/versions      → version list
GET /api/brands/:brandId/components/:componentId/versions/:n   → one immutable version
```

Because versions are immutable and append-only, `/versions/:n` should send
`Cache-Control: public, max-age=31536000, immutable`. The list endpoint must not:
it grows on every publish.

This also reinforces §9.1 — component versions being immutable is *why* pinning a
plan by `planId` is coherent, and why re-derivation looked plausible right up
until you notice which version it resolves against.

### 9.3 Drift endpoint — added

Agreed and added to §2.2, wrapping `propagation.md` §5's `scanDrift(db,
componentKey) → DriftReport`:

```
GET /api/brands/:brandId/components/:componentId/drift  → DriftReport
```

Their §3 calls `summary.unreachable` *"a headline figure, never a footnote:
under-reporting it is how the engine lies."* A run reporting "38 updated" while
six opaque instances sit on the old brand colour is the product's most damaging
failure — it is confidently wrong, and it is wrong in the direction the user
cannot see. An endpoint that surfaces it outside the context of a propagation run
is the right defence, and the UI lane having built a per-component health view on
it (`ui.md` §3.5) settles it.

**Synchronous GET is fine at current scale, with a stated ceiling.** `bench.test.ts`
in `propagation.md` §6 measures a full-corpus parse at ~1s for 480 templates
(12 brands × 40), and a drift scan is the same walk without the merge. It must
*not* run `mjml2html` (14.6 ms each — 7s across the corpus, past any synchronous
budget). Above their stated trigger (plan phase >3s, or >500 templates) this
endpoint moves to a cached report with a `reindex` operation, on the same schedule
as their denormalized `component_keys` column — same trigger, same mechanism,
should be built at the same time rather than discovered separately.

### 9.4 Net effect on this document

| Section | Change |
|---|---|
| §2.2 route table | Propagation routes replaced with plan/run resources; component-version and drift routes added |
| §2.3 | Rewritten — re-derivation withdrawn in favour of persisted plans |
| §6.2 | `PropertiesPanel`/`RightPanel` verdict clarified: "keep" is from this lane only |
| §8.2 | Stamp set corrected to the real four attrs; charset constraint confirmed compatible |
| §8.3 | Batch-atomicity argument withdrawn; narrowed to per-item template+run-record atomicity |
| §7 effort | Unchanged. Plan persistence shifts work from the propagation lane to the schema lane (a `plans` table with a retention rule), but does not add to the total. |

Unaffected and still standing: §0 (framing corrections), §1 (the 72-entry
inventory), §2.1 (path-scoped brands — independently reached by `ui.md`), §3
(optimistic locking), §4 (transaction mechanics, at narrowed scope), §5 (LLM
brand-awareness), §8.1 (the migration-baseline blocker, which gates all three
lanes and is still step 0).
