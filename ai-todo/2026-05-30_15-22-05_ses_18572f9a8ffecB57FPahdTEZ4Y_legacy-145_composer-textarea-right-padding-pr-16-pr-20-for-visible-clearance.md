---
status: DONE
commit: d592f52
session: ses_18572f9a8ffecB57FPahdTEZ4Y
queued_at: 2026-05-30T15:22:05-05:00
legacy_number: 145
---

# Composer textarea right-padding: pr-16 -> pr-20 for visible clearance

User prompt (verbatim):

> submit button inside textarea button - text goes behind the buttons. bad experience. padding right inside prompt field, to accommodate for buttons showing on the right.

(Followed by a screenshot showing text crowded against the buttons on a mobile-width viewport, with a second message: "current state: text still going behind the buttons, text should not go there. always deploy, whether someone else's work in progress or not.")

Design notes:

- #143's predecessor commit (`4fdf982`) bumped `pr-14` to `pr-16` and reported 10px clearance. Verified deployed (`_id-FuMXLLPP.js` + `new-Bx-5ZbEv.js` both contain `pr-16`). 10px reads as crowding on mobile — the technical gap exists but the visual reads as text-against-button. The user re-reported the issue after deploy.
- Fix: bump both composer textareas from `pr-16` (64px, 10px gap) to `pr-20` (80px, 26px gap from the size-12 submit, 50px from the size-6 stop). 26px is the threshold where the gap reads as deliberate whitespace rather than a tight wrap point.
- AGENTS.md "Composer layout" contract updated: example tsx line, padding minimum bullet, and the threshold rationale documenting why 10px wasn't enough.
- Files: `apps/web/src/routes/_app/session/$id.tsx` (textarea + inline rationale comment), `apps/web/src/routes/_app/session/new.tsx`, `AGENTS.md`.
