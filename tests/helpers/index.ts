// Phase 0 placeholder. Helpers grow incrementally per the plan:
//
//   makeTestApp(opts?)        — Phase 4 (DI factory comes online with createWebApp)
//   stubLLM(scripted)         — Phase 3 (LLMAdapter test double)
//   makeFakeEmailTransport()  — Phase 7 (Resend in-memory shim)
//   seedUser / seedAuthedUser — Phase 7
//   seedTemplate              — Phase 5
//   seedCredential            — Phase 8
//   cookieHeader              — Phase 7
//   postJSON / getJSON        — Phase 5
//   testClock                 — Phase 6 (sliding-window rate limiter)
//
// Until each phase lands, importing from this file is a no-op.
export {};
