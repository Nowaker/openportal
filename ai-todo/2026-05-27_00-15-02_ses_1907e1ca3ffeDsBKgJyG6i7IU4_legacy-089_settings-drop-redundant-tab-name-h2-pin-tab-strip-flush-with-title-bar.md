---
status: DONE
commit: ae52a95
session: ses_1907e1ca3ffeDsBKgJyG6i7IU4
queued_at: 2026-05-27T00:15:02-05:00
legacy_number: 89
---

# Settings: drop redundant tab-name h2 + pin tab strip flush with title bar

User prompt (verbatim):

> When I open settings tab X in section I don't need to see section X again as h1. Remove.
>
> Also, there's a slight scroll down of the tabs before they stay in place. They should stay in place where they are, it's okay. Also the start is too far from the title line (settings and back). Make it closer.

Design notes:

- Two related polish items for /settings, plus the matching AGENTS.md
  doc update.
- (1) `<h2>{TabName}</h2>` removed across nine tab panels - the
  sticky tab strip from #88 already shows which section the user is
  in, so the in-panel h2 duplicated the tab label one row below it.
  Panels that previously carried an intro paragraph alongside the h2
  (Composer / Files / Content / Notifications / Performance) keep
  the paragraph as a stand-alone description; the redundant wrapper
  `<div>` and the `pt-1` offset (which only existed to clear the h2
  above) are dropped at the same time. Diagnostics never had an h2.
- (2) The #88 landing left a visible 24px gap between the title bar
  and the tab strip at scrollTop=0 (the inner container's `py-6`
  pushed the strip down before sticky kicked in). Replaced `-top-px`
  with `top-0` and added `-mt-6` to TabList; the negative margin
  cancels the outer `py-6` so the strip's natural document-flow
  position is already at top:0 of the scroll container, and
  `position: sticky` just nails it in place from the moment the
  page loads. No more "scroll-down 24px, then the tabs stick"
  transition; the strip sits flush against the title bar.
- AGENTS.md "Settings UI structure" updated: documents the
  no-tab-name-heading rule, names which tabs keep an intro paragraph
  (Composer / Files / Content / Notifications / Performance) and
  which skip it (Appearance / Prompt / Chat / Tools / Diagnostics),
  and explains the rationale ("the active tab in the sticky tab
  strip already shows the section name").
- Worktree: `~/projekty/webapps/portal-settings-polish` (branch
  `settings-polish`, rebased onto current main-nowaker before
  ff-merge to absorb the parallel-agent commits 3e0dd5b composer +
  ef26452 messages-cache that landed mid-work).

---
