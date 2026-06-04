---
status: DONE
session: ses_unknown
queued_at: 2024-01-01T00:02:29-05:00
legacy_number: 149
commits:
  attributed:
    - 46450b728bc5
  on_main:
    - 46450b728bc5
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Composer textarea right-padding: pr-20 -> pr-24 (further bump for visible clearance)

User prompt (verbatim, second iteration on the same complaint after #145 deployed):

> still wrong

(Screenshot showed text wrapping right next to the mic + submit cluster. Earlier iterations: #145 bumped pr-16 -> pr-20, deployed cleanly to prod with `_id-DofPU_y7.js` / `new-DMwEdA0E.js` serving `pr-20`, but the user still reads the visual as crowding even with 26px clearance from the size-12 submit / 50px from the size-6 stop.)

Design notes:

- Bump `pr-20` -> `pr-24` (80px -> 96px), giving a 42px gap from the submit's left edge and 66px from the stop button. 42px reads as unambiguous whitespace — text never visually neighbours the button.
- Updated AGENTS.md "Composer layout" contract + the inline rationale comment in `apps/web/src/routes/_app/session/$id.tsx` to document the 42px threshold so future shrinks are intentional.
- The `pr-20` -> `pr-16` -> `pr-14` history is preserved in the rationale so reviewers can see why 26px wasn't sufficient.
- Files: `apps/web/src/routes/_app/session/$id.tsx`, `apps/web/src/routes/_app/session/new.tsx`, `AGENTS.md` "Composer layout" section.
