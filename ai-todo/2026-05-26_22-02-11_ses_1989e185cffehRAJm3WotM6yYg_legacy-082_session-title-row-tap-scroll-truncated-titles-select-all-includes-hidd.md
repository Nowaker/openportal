---
status: DONE
session: ses_1989e185cffehRAJm3WotM6yYg
queued_at: 2026-05-26T22:02:11-05:00
legacy_number: 82
commits:
  attributed:
    - fdd807184029
  on_main:
    - fdd807184029
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Session title row: tap-scroll truncated titles + select-all includes hidden chars

User prompt (verbatim):

> Session title row on mobile: [navbar icon] portal: opencode in progress status not showing... [icons] 
> When the title doesn't fully fit, tap scrolling on the title left/right should scroll the text for full readability. When using "select all" or selecting text, the hidden text should be selected for a complete - ^C ^V. This isn't very likely to happen on desktop but the same behavior is okay there too.

Design notes:

- One-line CSS fix in `apps/web/src/components/app-sidebar-nav.tsx:694` on the non-edit-mode session-title span. Swapped `truncate` (= `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`) for `overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`. Same scrollbar-hide pattern as the pinbar at lines 1576/1588 in the same file.
- Effect: long titles still render as a single line inside the flex parent (`min-w-0` preserved), but the off-screen tail is now reachable via native touch swipe on mobile (and shift+wheel / drag-select on desktop) and is fully selectable / copyable. The scrollbar is suppressed on both Firefox (`scrollbar-width: none`) and WebKit (`::-webkit-scrollbar { display: none }`) so the title-bar height stays unchanged.
- Tradeoff: the `...` ellipsis is gone. The visual cue becomes "text runs to the edge with no padding" - same indicator the pinbar already relies on; user explicitly accepted parity on desktop.
- The title-row siblings (SessionStatusBadge, edit/compact/export buttons) remain at their natural sizes after the title span; flex shrinking still squeezes the title first when the row overflows.
- Inner buttons (project label, parent-session link in subagent rendering) stay clickable while the parent span is scrollable - touch drag scrolls, tap clicks; native browser behavior.

---
