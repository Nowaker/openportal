---
status: DONE
session: ses_1907e1ca3ffeDsBKgJyG6i7IU4
queued_at: 2026-05-26T23:00:59-05:00
legacy_number: 88
commits:
  attributed:
    - 789f79d2ddce
  on_main:
    - 789f79d2ddce
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Settings: sticky tab strip pinned to top of scroll container

User prompt (verbatim):

> Appearance
> Prompt
> Composer
> Chat
> Files
> Tools
> Content
> Notifications
> Performance
> Diagnostics
>
> This is from settings. These tabs should always be visible, like the title line.
>
> Git Worktree. Merge to the main branch when done.

Design notes:

- Backfill: the original sticky-tabs work shipped in `789f79d`
  (worktree `portal-sticky-settings-tabs`) but skipped its AI_TODO
  entry because AI_TODO.md was in unmerged state from a parallel
  agent's mid-flight merge at the moment. The user explicitly flagged
  this miss two turns later and ordered the safe-diff rule (see #90)
  so this kind of skip doesn't recur.
- Implementation: `apps/web/src/routes/_app/settings.tsx:1719` TabList
  becomes `position: sticky` against the route's existing scroll
  container. `bg-bg` blocks tab-panel content from bleeding through
  when scrolling underneath; `border-b border-border` restores the
  visual separator the row had been suppressing with `!border-b-0`;
  `z-20` keeps the strip above scrolling content. `-mx-4 px-4` widens
  the bg-bg band so it covers the inner container's `px-4` gutters
  too - without it the band stopped short of the scroll container
  edges and tab-panel content scrolling past would show through those
  16px strips.
- Parent `<Tabs>` switched from `overflow-x-hidden` to
  `overflow-x-clip`. Spec-wise `overflow-x: hidden` implicitly
  promotes `overflow-y` from visible to auto, making `<Tabs>` a
  vertical scrolling ancestor and binding the sticky element to it
  instead of the intended outer scroll container - sticky would then
  never trigger because TabList is already at top:0 of its parent.
  `overflow-x-clip` preserves the original "no horizontal page
  scroll" intent without creating a vertical scroll context.
- Initial landing carried a `-top-px` sub-pixel offset that's been
  superseded by `-mt-6` + `top-0` in #89.
- Verified via headless browser eval on the deployed worktree: tab
  list sits at top:0 of the scroll container at all scrollTop values
  >= the strip's natural offset; mobile-narrow (412x915) viewport
  same behaviour, no horizontal overflow.

---
