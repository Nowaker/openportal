---
status: DONE
session: ses_19acecfc9ffeLwGYd7kS56G7wf
queued_at: 2026-05-26T14:57:12-05:00
legacy_number: 72
commits:
  attributed:
    - 55898443283d
  on_main:
    - 55898443283d
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Prompt history page: slow cold load; render openportal data immediately + spinner per opencode-dependent field

User prompt (verbatim):

> enqueue at the end: burger > prompt history takes LONG to load. it is almost entirely openportal only data. so why is that? remember the rule: when something is loading, show an indication. but the entire screen isn't even changing to prompt history window for 15-30 seconds. if there is any specific opencode api that prompt history needs, well, it should spinner that piece of data, and show everything else that's known right away. this is the base rule of this project, if unclear update agents.md.

Design notes:
- `/prompts` route loads from openportal SQLite (FTS5 prompt archive). That's 100% local data; should render instantly. The 15-30s delay implies a blocking opencode call in the page load path — likely `useSessions()` to materialize session titles, or providers/agents for filter chips.
- Fix per the existing Loading-feedback rule (portal AGENTS.md): render the prompts list IMMEDIATELY from the archive endpoint; per-row session-title hydration uses an inline `<Loader />` until the per-session lookup resolves. NEVER block the route render on opencode-data-dependent fields.
- Audit `/api/prompts/...` server-side: if the handler calls into the opencode SDK at all, defer those calls to background fill rather than blocking the response.
- Portal AGENTS.md `Loading feedback` rule already says "keep the previous data visible during silent refresh (keepPreviousData: true) so the spinner only appears on cold load, not on every revalidation" and "Lists MUST show a spinner row (or skeleton placeholders) until the response lands". Reinforce that the rule applies AT ROUTE-LOAD TIME too: a route MUST render its own data within one paint, opencode-dependent enrichment fields render with their own per-cell spinners.
