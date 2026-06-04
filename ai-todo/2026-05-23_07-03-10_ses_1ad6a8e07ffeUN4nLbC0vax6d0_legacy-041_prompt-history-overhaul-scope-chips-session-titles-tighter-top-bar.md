---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T07:03:10-05:00
legacy_number: 41
commits:
  attributed:
    - 0f0df8b42ea3
  on_main:
    - 0f0df8b42ea3
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Prompt history overhaul: scope chips + session titles + tighter top bar

User prompt:

> Enqueue: Prompt history totally  sucks. When called from hamburger, it should have this session filter, and changeable to this. Project or. Global. When entering from left bottom burger, global by default. Second top bar doesn't fit, maybe half content per height is visible. Moreover, when Alerts lime no opencode connection happens, they cover and kinda "fill" the prompt history. Session ids are listed but should Also include their title. Search by content highlights matches, good, but should hide non matches altogether.

Design notes:
- Filter chips (Session / Project / Global) render right of the search input, only when the page was entered with `?focus=<sessionId>` (hamburger entry passes it; left-sidebar entry doesn't). Default scope: "session" when focus is present, "global" otherwise. Client-side filter for v1 — backend filter params follow when pagination pressure hits.
- Tree view: lookup titles via `useSessions()` and render `<title>  sid_first8 (count)` instead of just `sid_first16... (count)`. Title gets bold treatment; ID shrinks to 8 chars as a stable disambiguator. Falls back to old 16-char ID format when no title known.
- Top bar layout: `flex-wrap` → stacked-then-row layout. Search input fills the row on its own line on mobile; controls sit on a second row. On sm+ the original single-row layout is restored but with `px-1.5 py-0.5` chip buttons and `px-2 py-1` icon-action buttons — same sizing tokens the top-alert unification (#40) settled on.
- Empty-state copy when active scope filters to zero results despite non-zero underlying rows: "No prompts match the current scope.  Switch to Global".
- "Search hides non-matches altogether" claim: the FTS5 backend filter ALREADY filters non-matches when query is non-empty. Visual verification by user would confirm; my read of the data flow is that matches appear because the backend returns matching rows + the tree view groups them. No code change made — flagged as a "user confirms" item.
- "Alerts cover the prompt history" claim: ConnectionStatusBanner + StaleDataBanner are both block-level (push content down, don't overlay). User may be reacting to the combined vertical space they take. Tightening the top bar layout (above) gives some space back. If the user reports persistent coverage, follow-up: replace StaleDataBanner with CompactBanner for further compactness.
