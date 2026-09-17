# Frontend E2E checklist

> Browser tests are human-only per project CLAUDE.md. Server-side gates
> (`npm run typecheck`, `npm test`, `npx vite build`) are clean — this is the
> last gate before shipping the rewire.
>
> Setup: `npm run dev` from the project root. Open `http://localhost:5173`.

## Sign-off — 7 binary items

```
[ ] `npm run dev`; visit http://localhost:5173 → redirects to /templates;
    sidebar lists templates from `data/dev.db`.

[ ] Create new template; appears in sidebar; clicking it loads the
    canvas; URL changes to /templates/<uuid>.

[ ] DnD an mj-text block from the icon rail. Indicator timing:
    SaveStatusIndicator chip shows "Saving…" within 1100ms of drop;
    chip shows "Saved" within 1500ms of drop. Wait for "Saved" before
    refresh; refresh → block persists at the dropped slot.

[ ] DnD a block — observe iframe re-renders exactly ONCE; no blink at
    +1s after the PATCH lands (Architect §pre-mortem 4 manual repro).

[ ] Inline-edit the mj-text (double-click); type new text; click outside.
    Wait for SaveStatusIndicator to show "Saved"; refresh → new text
    persists. (Refreshing before "Saved" loses the edit; that is
    expected v2 behavior.)

[ ] Open the same template in two tabs; edit in tab A and wait for
    "Saved"; edit in tab B and wait — tab B sees a conflict toast;
    refreshes; tab A's edit is preserved.

[ ] DevTools → Network → WS panel: zero WebSocket connections opened
    during the entire session.

[ ] Delete a template; sidebar updates; navigating to the dead URL
    shows the empty state (404 → Navigate to /templates).
```

## If any item fails

- **iframe blink** — content-derived `revToken` mitigation is in `Canvas.tsx`.
  If still blinking after a save, conditionally wire `AbortController` into
  `IframePreview.tsx`'s `/api/render` fetch (ralplan §7.4 / Phase 7
  conditional task).
- **Conflict toast missing** — verify `useTemplate.refetch()` is called inside
  the 409 branch of `flushNow` (`web/src/hooks/useTemplate.ts`).
- **Save status indicator stuck** — `data.status` is server-driven via the
  reducer; check the `useReducer` actions match `SAVE_START`/`PATCH_OK`/etc.
- **Sidebar remounts on `:id` swap** — `<SidebarShell/>` must be a parent
  route (sibling layout), not nested inside the template route. See
  `web.SidebarShell.spec.tsx`.
