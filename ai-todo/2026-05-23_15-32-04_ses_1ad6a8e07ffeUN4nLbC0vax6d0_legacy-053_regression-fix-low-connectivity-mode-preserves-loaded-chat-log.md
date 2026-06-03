---
status: DONE
commit: bfbef87
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T15:32:04-05:00
legacy_number: 53
---

# Regression fix: low-connectivity mode preserves loaded chat log

User prompt:

> regression: now in low connectivity mode (super slow / high latency opencode) a legit chat log gets cleared with 'no messages yet'
> you must not clear any loaded content when opencode connection sucks.

Design notes:
- Root cause: 3s `Promise.race` timeout in `fetchAndCache` (added in #48 / commit 60ac234). On timeout, server fell back to `getStaleMessages(id) ?? []` and responded 200 + `[]` when stale cache was also empty (openportal restarted or LRU evicted). SWR's `keepPreviousData: true` only preserves data across KEY transitions, not same-key empty refetch — so the loaded chat log got overwritten with `[]` and the "No messages yet" empty-state gate fired.
- Fix: new tagged `FetchTimeoutError` thrown ONLY by the 3s race reject path. New `MessagesUnavailableError` thrown by `loadFullMessages` when `real === null` AND `visible.length === 0` AND `opencodeTimedOut === true`. Outer handler catches → 503 + `X-OpenPortal-OpenCode-Down: true`. Client fetcher throws on `!response.ok` → SWR's default error-retains-data path preserves the loaded log; the user sees nothing flash. Next successful poll refreshes normally.
- Scoping narrow: 404 / SDK schema rejection / 5xx from the raw fetchOpencode fallback still throw plain `Error` → still return `[]` (legacy behavior for nonexistent sessions). Only true network timeouts trip the 503 path.
