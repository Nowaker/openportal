---
status: DONE
session: ses_019de0d38c6euLKwWoRhFZdgzg
queued_at: 2026-05-15T19:31:55-05:00
legacy_number: 56
commits:
  attributed:
    - 695ae79df95c
  on_main:
    - 695ae79df95c
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Permalinks preserve ?server= across navigate() + highlight more visible + spec-matching comment

User prompts (sub-items from #5/6 in PENDING):

> links in sidebar don't include server permalink. screen other places where server permalink missing.

> after clicking permalink ... must highlight very visibly the message permalinked.

> permalinks: click to copy and open... uhm, what, click to copy? click is open, not copy. right click copy, or on phone hold and copy, is how you copy. click to copy is nonsense.

Design notes:
- 695ae79: every navigate() call site that previously omitted search (cmd.tsx new-session + session-select + instances + servers, empty-state.tsx, app-sidebar.tsx home + servers + docs, app-sidebar-nav.tsx home, routes/servers.tsx 2 sites, session/new.tsx) now uses `search: (prev) => prev` to preserve ?server=. Session-palette select merges via `search: (prev) => ({ ...prev, focus: 'composer' })`.
- 667b6d5: permalink-pulse CSS keyframes bumped from peak alpha 22%/4px ring to 45%/6px at peak + held a sustained 25%/4px ring through 60% before fading. Duration 2.4s -> 3.6s. The stale block comment above MessagePermalinkTimestamp described an old "copy + open in new tab" click semantic; replaced with verbatim user-spec quote to prevent future agents from "restoring" the click-to-copy anti-pattern. Click semantics already correct in code: in-page click -> scroll + flashMessageHighlight (no nav); out-of-page click -> default <a> nav same-tab; right-click / long-press -> copy.
