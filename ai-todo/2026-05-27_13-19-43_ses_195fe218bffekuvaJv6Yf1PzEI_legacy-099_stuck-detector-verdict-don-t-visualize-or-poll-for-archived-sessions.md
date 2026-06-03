---
status: DONE
commit: 93fc003
session: ses_195fe218bffekuvaJv6Yf1PzEI
queued_at: 2026-05-27T13:19:43-05:00
legacy_number: 99
---

# Stuck-detector verdict: don't visualize or poll for archived sessions

User prompt (verbatim):

> after done:
> also make openportal not visualize/ask stuck detector verdicts when session is archived.

Design notes:

- Stuck-detector verdicts are meaningless for archived sessions: no runner can be wedged, no unstuck action makes sense, and polling the plugin's `/verdicts/<sid>` endpoint every 15s per modal mount is pure waste.
- "Visualize" sites gated on archived state: [SessionStatusBadge](file:///home/nowaker/projekty/webapps/portal/apps/web/src/components/session-status-badge.tsx) (title-bar badge with click-to-unstuck affordance) returns null when archived. [Session-info modal](file:///home/nowaker/projekty/webapps/portal/apps/web/src/components/session-info-modal.tsx) renders `n/a (archived)` for both Owner instance and Verdict fields.
- "Ask" site gated on archived state: [useSessionVerdict](file:///home/nowaker/projekty/webapps/portal/apps/web/src/hooks/use-session-verdict.ts) accepts a new `options.enabled` flag. When false, the SWR key is `null` so no fetch happens; the hook returns nulled-out state. session-info modal computes `isArchived` from `session.time.archived` and passes `enabled: !isArchived`.
- SSE indicator stream (which feeds `useIndicator` / the badge's in-memory state) is left unchanged — it's a single global subscription, not per-session, so filtering per archived state would be a backend change. Indicator state still flows in; the badge just hides itself. Acceptable for now since the badge render is the visible surface.
- [app-sidebar-nav.tsx](file:///home/nowaker/projekty/webapps/portal/apps/web/src/components/app-sidebar-nav.tsx) already has `isArchived` computed at line 372 from `currentSession.time.archived`; passes through to the badge component.
