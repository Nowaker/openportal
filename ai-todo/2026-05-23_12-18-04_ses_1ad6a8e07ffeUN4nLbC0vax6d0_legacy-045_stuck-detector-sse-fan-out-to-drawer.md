---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T12:18:04-05:00
legacy_number: 45
commits:
  attributed:
    - 907f22e46861
  on_main:
    - 907f22e46861
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Stuck-detector SSE fan-out to drawer

User prompt:

> yes, do the sse stuck improvement

Context (preceding user message):

> Session may be wedged - OpenCode reports busy but no streaming progress. Abort + retry / Where is this coming from? Stuck detector or some less reliable openportal heuristic? If op, then it's probably not accurate? Provide analysis in Ai requests docs thing. Add todo for me to decide later. Also stuck detector should be fully configurable from settings here.

Design notes:
- New server-side event bus `apps/web/src/server/lib/stuck-detector-events.ts` (singleton EventEmitter). Plugin clients push verdict-transition + journal-action events. Verdict dedup map per session prevents idle↔in-progress chatter from flooding the drawer; only verdicts that pass the stuck threshold get mirrored.
- SSE endpoint `apps/web/src/server/stuck-detector/events/stream.get.ts` opens an open-ended response, sends a `: ok` heartbeat, then writes JSON events as they arrive on the bus.
- Frontend hook `apps/web/src/hooks/use-stuck-detector-events.ts` per-tab EventSource subscriber. Mounted once in `_app.tsx`. Every event triggers `logSystemMessage("stuck-detector", level, msg, details, projectDirectory, sessionId)` so the drawer becomes the durable audit trail for plugin actions.
- The two `server/plugins/stuck-detector-{client,journal-client}.ts` files were updated to push to the bus. The journal client has an `initialDrainComplete` guard so opening the SSE stream at openportal startup doesn't replay every historical action into the drawer.
- Companion analysis: `ai-analysis-requests/SESSION_WEDGED_BANNER.md` traces the existing banner to a LOCAL HEURISTIC (5min wall-clock + isAssistantBusy + isServerBusy at `routes/_app/session/$id.tsx:3706-3717`), NOT the plugin. Q-deferred: 4 options for user (drop heuristic / invert priority / raise threshold / add streaming-delta probe). See [Q4] below.
