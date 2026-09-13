# email-designer

A local app that launches an AI-powered email designer powered by Claude Code subagents. Edit MJML email templates via a drag-and-drop canvas or by sending natural-language queries to Claude.

## Security

This app runs the `claude` CLI with `--dangerously-skip-permissions`. Within the project-relative `./workspace/` directory, Claude can read, write, and execute shell commands without prompting.

- The `claude` subprocess runs with `--dangerously-skip-permissions` inside `./workspace/`, which **persists across runs**. Anything written there during a Claude turn — including pasted text, intermediate edits, or shell-command output — stays on disk until you delete it. This is a deliberate trade-off vs. the per-session tmpdir an earlier CLI shape used; for a personal app the persistence wins, but it means you should not paste secrets into prompts and should periodically prune `./workspace/exports/`.
- **Do not paste secrets, credentials, or API keys into prompts** — they live on disk in `./workspace/` indefinitely.
- **Do not run on untrusted prompts or shared machines.**
- The local server binds to `127.0.0.1` and rejects any request whose `Host` header is not a loopback name (`localhost`, `127.0.0.1`, `[::1]`), and any request carrying a non-loopback `Origin` (DNS-rebinding / CSRF defence, `src/server/middleware/originGuard.ts`). The check is on hostname, not port: the hostname is the security boundary, and the server cannot know the dialled port when it sits behind the Vite dev proxy. It applies to reads as well as writes, because exfiltrating templates over `GET` is the interesting attack. It still relies on the operating system's loopback isolation.

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

The web UI includes a **Claude pane** on the right side where you can type natural-language prompts directly in the browser (e.g. "Make the subject line bold"). Prompts submit via `POST /api/query` and stream back token-by-token over WebSocket — each tab sees only its own turn's tokens while MJML updates broadcast to all connected tabs.

## Notes

- **Windows support is best-effort.** SIGINT cleanup uses `taskkill /T /F /PID` on Windows; hard kills may leak the `claude` subprocess.
- The workspace at `./workspace/` is gitignored and persists across runs. See **Resetting** above when you need to wipe state.
- Min `claude` CLI version: **2.1.119**. The app checks this on startup.
