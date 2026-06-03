---
status: DONE
commit: d8f22b3
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T12:29:29-05:00
legacy_number: 46
---

# Status badges fix + STUCK badge + docs route + STATUS_BADGES analysis

User prompts (chained):

> this may actually be good, because we have a problem here with showing 'in progress' badge. i've not seen it for many days. the yellow one. inspect the status badge system, and report what it is allegedly doing (explain all badges - and actually, introduce left dropdown -> Documentation and document all badges as they are supposed to work) then reason on whether it actually works like that. don't fix anything, present findings.

> find out why, fix, or come up with an even better solution; all is good. consider if stuck detector better conveys current status, etc. status indicators must work one way or another. they must work for ALL projects in the given opencode instance - even if another instance is processing that session. this is non-debatable. can't restart opencode-serve-tailscale instance or -serve-local, but you can spawn other instances if needed for opencode plugin testing (dev/early test -> independent dbs, final test -> can use main db)

Design notes:
- New `/docs` route + Documentation menu item in left sidebar dropdown. Documents all badge kinds (THINKING, TOOL, QUESTION, PERMISSION, ERROR, STUCK), sidebar dots (busy/retry/attention/active/done), and connection banners. Persisted as `ai-analysis-requests/STATUS_BADGES.md` (the user-requested analysis).
- ROOT CAUSE of "yellow THINKING badge never visible": `nitro.config.ts` listed 5 plugins but FOUR more on disk (`indicator-broadcaster`, `session-prefetcher`, `stuck-detector-client`, `stuck-detector-journal-client`) were NEVER loading. Nitro v3 doesn't auto-discover `server/plugins/` — plugins must be listed in the `plugins:` array. Fix: register all four. Multiple in-progress features were silently dead code as a downstream consequence.
- Status badge augmentation (a1a2f89): `pickBadge()` adds a STUCK kind (verdict==='stuck' → red badge with cause text) AND uses verdict==='in-progress' as a fallback for `busy` so THINKING fires even when opencode misses firing `message.created`. Sidebar dot `toStatus`: verdict==='stuck' → "retry", `busy || verdict==='in-progress'` → "busy". `use-indicators.ts` surfaces `stuck_verdict` / `stuck_cause` / `stuck_warnings` on the indicator state.
- Documentation expanded (a7f6203): docs route covers the new STUCK badge + the dual-signal THINKING rule so the contract is visible to future agents.
