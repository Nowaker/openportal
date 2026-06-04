---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T07:29:20-05:00
legacy_number: 39
commits:
  attributed:
    - 68d9ede38328
  on_main:
    - 68d9ede38328
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Archived overlay: trim "Controls below..." junk + auto-hide icon when overlay short

User prompt:

> Enqueue m:
>
> Session archived
> Controls below stay visible for reference. Unarchive to continue.
>
> This is too big, and cropped.
> If height doesn't allow for icon to fit, dynamically hide the icon. "Controls below stay visible for reference." is junk, delete.

Design notes:
- Drop the "Controls below stay visible for reference. Unarchive to continue." secondary copy entirely.
- Shrink chrome: `size-7 → size-5` icon, `px-5 py-4 → px-3 py-2` card padding, `text-sm font-semibold → text-xs font-medium` title, "Unarchive session" → "Unarchive" button label.
- `ResizeObserver` on the overlay's root measures rendered height; hides the icon when container is under 120px so title + button always stay fully visible. Threshold matches the height at which icon + title + button start to crop under the test viewport.
- Rationale for ResizeObserver over media query: documented inline as a non-obvious "why not media query" comment. The composer area this overlay covers shrinks based on parent layout, not viewport size — media queries would miss the actual cropping case.
