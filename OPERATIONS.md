# Operations runbook

> Open-source single-user MJML email designer. The deployer owns the SQLite
> file and (via network access) every template inside it. No accounts, no
> auth — `localhost` by default.

## Boot prerequisites

| Variable | Required | Format | Example |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | only in `api` mode | Anthropic API key | `sk-ant-…` |
| `EMAIL_DESIGNER_DB_PATH` | no (default `/var/lib/email-designer/data.db`) | absolute filesystem path | `./data/dev.db` |
| `PORT` / `EMAIL_DESIGNER_PORT` | no (default `5174`) | integer 0-65535 | `5174` |

`/query` supports two modes, picked via `Settings → Mode` and persisted to the
singleton settings row:

- **`api` mode** (default) — the server reads `ANTHROPIC_API_KEY` from its
  env. With the var unset, `POST /api/templates/:id/query` returns **HTTP
  412** `{"error":"ANTHROPIC_API_KEY env var is not set on the server"}`.
- **`cli` mode** — the server shells out to the local `claude` binary in
  one-shot mode (`claude -p --output-format json --json-schema …`). Auth is
  whatever the binary itself uses: typically the OS keychain populated by
  `claude auth login` (Pro/Max/Team subscription). No env var required. The
  `claude` binary must be on the server process's `PATH`.

```bash
npm run dev   # vite (web @ 5173) + tsx watch src/server/main.ts (api @ 5174)
              # with EMAIL_DESIGNER_DB_PATH=./data/dev.db
```

`npm run dev` reads `./.env` at boot (stdlib loader in
`src/server/main.ts`, no `dotenv` dependency). Shell env wins over `.env`
when both define the same key.

### First-time bootstrap

```bash
npm run setup
```

The interactive setup script:

1. Runs `npm install` and applies Drizzle migrations to `./data/dev.db`.
2. Prompts for the mode (API key | Claude CLI).
3. For **API key** mode, prompts for `ANTHROPIC_API_KEY` and writes it to
   `./.env` (chmod 600). If the key is already in the shell env or `.env`,
   it's reused.
4. For **Claude CLI** mode, probes `claude --version` and warns if the
   binary or `claude auth login` is missing.
5. Persists the chosen mode into the singleton `settings` row so the app
   uses it on first boot.

Re-running is idempotent (migrations no-op, mode is updated in place).

## Schema migrations

Migrations live in `drizzle/migrations/*.sql`. They're idempotent — running
`npm run db:migrate` twice is safe.

```bash
EMAIL_DESIGNER_DB_PATH=./data/dev.db npm run db:migrate
```

After editing `src/db/schema.ts`, regenerate with `npm run db:generate`
(this writes the next `NNNN_*.sql` file). Commit both schema and SQL.

## Backups

The DB file is a single SQLite file. WAL mode is enabled at boot, so
hot-copies require care:

```bash
sqlite3 /var/lib/email-designer/data.db ".backup '/var/backups/email-designer/$(date +%Y%m%dT%H%M%S).db'"
```

## Observability

Each Claude turn emits one structured log line:

```json
{
  "event": "claude-turn",
  "templateId": "<uuid>",
  "model": "claude-opus-4-7",
  "promptBytes": 3051,
  "exitOk": true,
  "durationMs": 4231,
  "mjmlBytesIn": 1024,
  "mjmlBytesOut": 1156
}
```

Greppable from `journalctl -u email-designer` or `docker logs`. No PII
(prompt body, MJML body) is emitted.

Failures append `error: "<errorClass>"` and `exitOk: false`. Common values:
`LLMAuthError`, `LLMSchemaError`, `LLMError`, `malformed-mjml`.

## Rate limit

| Endpoint | Limit | Key |
|---|---|---|
| `POST /api/templates/:id/query` | 60 / hour | per IP |

State is process-local — horizontal scale would require Redis (out of scope
for this single-user shape).

## API surface

```
GET    /api/health                          → { ok, version, ts }
POST   /api/render                          → { html }   (MJML compile, used by canvas iframe)

GET    /api/templates                       → [{ id, name, description, updatedAt }]
POST   /api/templates                       → 201 { id, ..., mjml, version, ... }
GET    /api/templates/:id                   → 200 row | 404
PATCH  /api/templates/:id                   → 200 row | 400 | 404 | 409 stale | 422 malformed mjml
DELETE /api/templates/:id                   → 204 | 404
POST   /api/templates/:id/query             → 200 { mjml, reply, version } | 400 | 404 | 409 | 412 no-api-key | 429 | 502 | 503

GET    /api/settings                        → { defaultProvider, defaultMode, defaultModel, apiKeyConfigured }
PATCH  /api/settings                        → 200 row | 400 (rejected model)
```

## Hosting recommendations

The default boot binds `127.0.0.1`. Do NOT expose to the public internet
without a reverse proxy + an authentication layer in front (this codebase
ships none). Common deployments:

- **Personal laptop**: `npm run dev` and visit `http://localhost:5173`.
- **Self-hosted on a private network**: same, behind a VPN or trusted LAN.
- **Shared / public hosted**: not recommended in this shape — fork and add
  auth (or pin yourself to a previous Better-Auth-based revision in git
  history if you want a starting point).

## Open follow-up work

### Frontend rewire — DONE (browser sign-off pending)

The full v2 frontend rewire landed (consensus plan
`.omc/plans/ralplan-frontend-rewire.md`, 8 phases, 175 server-side tests
green, `vite build` clean). Outstanding: the developer's manual browser
sign-off — see `tests/manual/E2E.md` for the 10-item binary checklist.

Key shape:
- Routes: `/templates` (sidebar empty state) → `/templates/:id` (canvas) →
  `/settings` (model picker + API-key banner). No login, no AuthGate.
- `useTemplate(id)` owns the load + 1000ms-debounced save + 409
  conflict-refetch + 412/429/5xx surfacing + `cancelPendingSave()`. Single
  source of truth for the route's data.
- `useQueryRunner(id)` owns the synchronous `/query` POST; calls
  `cancelPendingSave()` before the POST so there is no in-flight save to
  race against (per ralplan §7.2 — the v1 `pendingDropRef` /
  `claudeMidEditToast` are deleted, not ported).
- Two Contexts (`TemplateDataContext` + `TemplateActionsContext`) keep the
  ~300-form RightPanel from re-rendering on every keystroke (per ralplan §4).
- `IframePreview` keys on a content-derived djb2 token instead of the
  monotonic version, so self-PATCH 200s don't trigger spurious re-renders
  (per ralplan §7.4 / pre-mortem 4).

### Test coverage gaps

- The block-primitive fixture-based tests (`blocks.{parser,serializer,roundtrip}.test.ts`
  and the property-test grammar generator) were removed because their
  fixture dir was destroyed in a Phase 10 cleanup. The block primitives in
  `src/shared/blocks/` are still functional and indirectly tested via the
  `promptBuilder` catalog walks and the route integration tests, but **the
  explicit round-trip invariant is no longer formally asserted at the unit
  layer**. A follow-up should rewrite the property-based generator and a
  small hand-curated fixture set to restore that gate.

### Pre-1.0 dep bumps

- `mjml` ^4.18.0 → ^5.x (transitive `html-minifier` ReDoS, GHSA-pfq8-rq6v-vf5m)
- `ai` ^4.0.0 → ^5.0.52+ (whitelist bypass advisory, GHSA-rwvc-j5jr-mgvh)
- `fast-xml-parser` ^4.5.6 → ^5.7.0 (XML comment/CDATA injection, GHSA-gh4j-gqv2-49f6)

Each bump requires re-running the full integration suite; `mjml` v5 may
change render output and warrants visual inspection of `/api/render`.

