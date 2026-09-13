# email-designer

A local app that launches an AI-powered email designer powered by Claude Code subagents. Edit MJML email templates via a drag-and-drop canvas or by sending natural-language queries to Claude.

## Security

This app runs the `claude` CLI with `--dangerously-skip-permissions`. Within the project-relative `./workspace/` directory, Claude can read, write, and execute shell commands without prompting.

- The `claude` subprocess runs with `--dangerously-skip-permissions` inside `./workspace/`, which **persists across runs**. Anything written there during a Claude turn — including pasted text, intermediate edits, or shell-command output — stays on disk until you delete it. This is a deliberate trade-off vs. the per-session tmpdir an earlier CLI shape used; for a personal app the persistence wins, but it means you should not paste secrets into prompts and should periodically prune `./workspace/exports/`.
- **Do not paste secrets, credentials, or API keys into prompts** — they live on disk in `./workspace/` indefinitely.
- **Do not run on untrusted prompts or shared machines.**
- The local server binds to `127.0.0.1` and rejects any request whose `Host` header names something other than a loopback host (`localhost`, `127.0.0.1`, `[::1]`), and any request carrying a non-loopback `Origin` (DNS-rebinding / CSRF defence, `src/server/middleware/originGuard.ts`). The check is on hostname, not port: the hostname is the security boundary, and the server cannot know the dialled port behind the Vite dev proxy. It applies to reads as well as writes, because exfiltrating templates over `GET` is the interesting attack.

  Two limits, stated rather than implied. A request that sends **no `Host` header at all** (HTTP/1.0) is treated as addressed to the bound address and is allowed — DNS rebinding needs a browser, and browsers always send `Host`, so this is not a rebinding path. And the whole defence assumes the `127.0.0.1` bind: if that ever changes, a `Host`-less request becomes a LAN entry point. The app still relies on the operating system's loopback isolation.

### Resetting

Because `./workspace/` persists across runs, two states can wedge a fresh `npm start`:

- **Stuck Claude session.** If `tsx watch` SIGTERMed a turn mid-flight (e.g. you saved a file in `src/` while Claude was generating), the persisted session id at `./workspace/.session/claude-session-id` may resume into a bad state on the next prompt. Reset it with: `rm -rf ./workspace/.session/`. The next `npm start` allocates a fresh session id; previous turn history in Claude's local cache is abandoned, which is intended.
- **Malformed `email.mjml` blocks startup.** `MJMLState` reads `./workspace/email.mjml` eagerly at server boot. A parse failure or a hand-edit that breaks MJML structure will crash startup before the canvas can recover it. Reset with: `rm ./workspace/email.mjml`. The next `npm start` re-seeds it from `src/templates/starter.mjml`. (You will lose your in-progress design — copy it out first if it matters.)

## Requirements

- Node.js >= 20 (LTS)
- `claude` CLI >= 2.1.119 ([install](https://claude.ai/download))

## Clone & Run

```bash
git clone <repo>
cd email-designer-claude-code
npm install
npm start
# then open http://localhost:5173/
```

`npm start` runs Vite (5173) and `tsx watch src/cli.ts` (5174) concurrently. The browser opens against Vite, which proxies `/api` and `/ws` to the local Hono server on `127.0.0.1:5174`. The persistent workspace lives at `./workspace/`.

When the server restarts mid-turn (because you saved a file in `src/`), the browser reconnects automatically and the next prompt resumes the Claude session via `--resume <uuid>` from `./workspace/.session/claude-session-id`.

Run `npm test` for Vitest and `npm run typecheck` for TypeScript checks (both server and web).

## Browser query input

The web UI includes a **Claude pane** in the left sidebar where you can type natural-language prompts directly in the browser (e.g. "Make the subject line bold"). Prompts submit via `POST /api/query` and stream back token-by-token over WebSocket — each tab sees only its own turn's tokens while MJML updates broadcast to all connected tabs.

## Component design system (experimental)

Templates can reference a shared component instead of carrying a copy of it:

```xml
<mj-component component-id="shoe-brand/primary-button" revision="1" />
```

The content lives once, in an **immutable revision**. Editing a component
publishes a new revision; templates keep pointing at the old one until their pin
is bumped, so propagation is an explicit, reviewable act rather than a side
effect of editing. Applying a bump rewrites **one attribute value** per template
and nothing else.

Per-instance overrides are attributes on the reference tag:

```xml
<mj-component component-id="shoe-brand/primary-button" revision="1"
              ov-background-color="#c0392b"
              ov-slot-headline="Custom headline" />
```

`ov-<attr>` sets an attribute on the component's root element; `ov-slot-<name>`
replaces the text of the element carrying `data-slot="<name>"`. Overrides are
literal — a revision bump never touches them.

Try it in the terminal (no UI yet):

```sh
npm run components -- demo     # publish, bump, dry-run diff, export, reachability
npm run components -- diff     # dry-run diff only
npm run components -- export   # write expanded MJML to ./workspace/expanded/
npm run components -- report   # reachability report only
```

### Measuring your own templates

Two questions gate further design-system work, and both need REAL templates —
ideally ten from one brand:

```sh
npm run measure -- ./path/to/templates        # human-readable
npm run measure -- ./path/to/templates --json # machine-readable
```

It reports:

- **Is flat root-level `ov-*` sufficient?** How many attributes differ per
  repeated block, and — the part that matters more — what share of those
  differences sit *below* the block root. Overrides reach the root and named
  text slots only, so a corpus can pass the average and still fail the design.
  If either number fails, the reference model should be reconsidered before
  more is built on it.
- **How much of a template can the parser address?** The opaque share and which
  constructs caused it. This is a migration cost, not a blocker.
- **How much body copy carries inline HTML?** Rich `mj-text` has no registry
  fix, so this bounds the addressable surface independently of components.

### Status and limits — read before relying on this

- **Experimental, and terminal-only.** There is no UI, no per-brand scoping and
  no auth. Nothing in the running server publishes revisions yet, so a template
  containing `<mj-component/>` will fail to render with HTTP 422 until a store
  is wired in. That refusal is deliberate: mjml drops an unknown element under
  soft validation and returns **200 with the content silently missing**, which
  would mean shipping a footerless email to a client's list with no signal
  anywhere.
- **Overrides reach the component root and named text slots only.** They cannot
  target something below the root — a footer's background can be overridden, its
  unsubscribe link cannot. Whether that is survivable has **not been measured**
  against real templates, so treat the override surface as provisional.
- **Some references are unreachable.** A reference inside `<mj-wrapper>`,
  `<mj-hero>`, or an `<mj-text>` containing inline HTML is swallowed into an
  opaque node by the parser. It still renders correctly — expansion works on the
  source string — but per-instance tooling cannot address it. `report` prints
  the count and the responsible construct, and never hides it.
- **Export is the escape hatch.** `export` writes every template as plain MJML
  with no references left in it, so the corpus outlives this tool.

## Notes

- **Windows support is best-effort.** SIGINT cleanup uses `taskkill /T /F /PID` on Windows; hard kills may leak the `claude` subprocess.
- The workspace at `./workspace/` is gitignored and persists across runs. See **Resetting** above when you need to wipe state.
- Min `claude` CLI version: **2.1.119**. The app checks this on startup.
