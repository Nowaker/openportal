---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T06:03:46-05:00
legacy_number: 34
commits:
  attributed:
    - 94c8ced6891a
  on_main:
    - 94c8ced6891a
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# ses_xxxxxx links open same-tab; only non-openportal links open new-tab

User prompt:

> Enqueue to the end: ses_xxxxxx links should open in the same tab. Only non-openportal openable links should open in new tab.

Design notes:
- TWO markdown renderers to fix (initial commit 94c8ced only handled `MarkdownRenderer` from `lib/markdown-renderer.tsx`, used for plugin docs etc.; follow-up commit 77b40c8 also fixed `MessageMarkdown` in `routes/_app/session/$id.tsx` which is the actual chat-message renderer).
- Detection: a link is "openportal-internal" if its href starts with `/` (relative) OR if `new URL(href, window.location.origin).origin === window.location.origin`. Anchor links (`#xxx`), mailto, and `file://` are excluded.
- For internal links: render `<a href={href}>` with an `onClick` that calls `navigate({to: u.pathname + u.search + u.hash})` from tanstack router. Bail on modifier-clicks (meta/ctrl/shift/alt) so cmd+click for "open in new tab" keeps working. `e.button !== 0` also bails (non-primary buttons).
- For external links: existing `linkBehavior` setting still applies (new-tab / new-window / none).
- Rationale: documented inline as a cross-system invariant comment. Window.location.href full reload destroys SWR cache, drafts, scroll position — explicitly forbidden in portal AGENTS.md.
