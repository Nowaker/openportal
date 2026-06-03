---
status: PENDING
commit: 
session: ses_18572f9a8ffecB57FPahdTEZ4Y
queued_at: 2026-06-02T00:23:21-05:00
legacy_number: 162
---

# Composer textarea padding: compact symmetric inset around floating buttons (DONE - this commit) [loser-bump: originally #160; bumped to #162 because OMO wrapper unwrapping (#160) and OMO fenced-code (#161) landed on origin/main-nowaker concurrently with this work]

User prompt (verbatim):

> Too much space wasted. Margin/padding  between submit button and text should be  minimal, similar to the distance from textarea border to the   button.
>
> Also, padding left on the textarea is too big. Must be Same as. Between submit button and fight border. Same goes for top and bottom.
>
> Please address this message and continue with your tasks.

Design notes:

- Keep the restored textarea + floating bottom-right button overlay. Do not reintroduce the rejected contenteditable or row-below layouts.
- The overlay keeps `right-1.5 bottom-1.5` (6px). Composer textarea call sites now override the base field padding with `px-1.5 py-1.5` so left/top/bottom internal padding match that same 6px inset.
- Submit button is `size-12` (48px) and sits 6px from the right border, so the text needs 48px + 6px + 6px = 60px of right padding: button width + border-to-button inset + matching text-to-button gap. `pr-[60px]` replaces `pr-24` to remove the old 42px extra whitespace while preventing text from going under the floating button column.
- Files: `apps/web/src/routes/_app/session/$id.tsx`, `apps/web/src/routes/_app/session/new.tsx`.
