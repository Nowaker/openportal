---
status: DONE
session: ses_1983566f5ffemNKO0R8Bm8e1Go
queued_at: 2026-05-27T09:57:50-05:00
legacy_number: 94
commits:
  attributed:
    - ce8f404c8c4f
  on_main:
    - ce8f404c8c4f
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Mobile composer follow-up: textarea min-height must accommodate floating mic+submit column

User prompt (verbatim):

> One bug here: input field minimum height (inside) must be submit button h + space between H + mic button h. Currently, when prompt field empty, the mic button is colliding into top prompt border, and poked in half.

Design notes:

- Direct regression from #85 (`3e0dd5b`). The floating-button overlay in `apps/web/src/routes/_app/session/$id.tsx` is positioned at `absolute bottom-1.5 right-1.5` of the textarea wrapper. With the mic+stop row above the submit button, the column is 78px tall: `mic-row h-6 (24px) + gap-1.5 (6px) + submit size-12 (48px)`. Add the `bottom-1.5` offset (6px) and the column's TOP edge sits at `wrapper_height - 84`.
- Existing textarea floor was `min-h-[max(4.5rem,100%)]` = 72px. `72 - 84 = -12px` → the mic button at the column's top extends 12px ABOVE the textarea's top border, getting clipped by the wrapper's `overflow-hidden`. That's the "poked in half" the user described.
- Fix: bump the textarea's `min-h` to `min-h-[max(6rem,100%)]` = 96px floor. New math: `96 - 84 = 12px` → 12px symmetric breathing room above the column (matching the 6px from `bottom-1.5` plus 6px top inset). The user's stated formula `submit_h + space_between + mic_h = 78px` is the column height; the actual min-h needs to also account for the bottom-1.5 offset plus a matching top margin for visual symmetry.
- `apps/web/src/routes/_app/session/new.tsx` was already `min-h-[120px]` (120px > 96px) so its column has plenty of breathing room. No change there.
- Updated AGENTS.md "Composer layout (mobile-safe)" sub-section with a new bullet documenting the min-h constraint so this regression does not recur if someone shrinks the textarea floor in the future.
- Verified live at `https://portal.desktop.ts.nowaker.net:8443/` at a 390x844 mobile viewport after the deploy: empty composer renders the floating column (stop button + submit) cleanly inside the textarea with no top-border clipping.
- Entry parked in gitignored temp file at the time the fix landed (`ce8f404`) because AI_TODO.md had a parallel session's uncommitted #93 edits visible — per the AGENTS.md safe-diff fallback rule, editing then would have mangled their work. Folded into AI_TODO.md after a parallel session pushed `0e03d4d` (#95) explicitly leaving `#93` / `#94` as reserved gaps for the parallel agents whose unstaged additions reserved those numbers (that's me for #94; #93 went unused).
