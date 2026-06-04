---
status: DONE
session: ses_18572f9a8ffecB57FPahdTEZ4Y
queued_at: 2026-06-01T12:54:03-05:00
legacy_number: 154
commits:
  attributed:
    - 8d5ad5990461
  on_main:
    - 8d5ad5990461
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Revert composer contenteditable refactor: restore textarea + floating bottom-right buttons (pr-24 era)

User prompt (verbatim):

> i can't post anything into the prompt field. it's dead. when i click on it, an ugly white border around it shows up. and that's it. can't type into it.

and then, after a manual workaround attempt:

> what the fuck. even voice input is broken in this new BS prompt field.
> at this point, i don't want this shit. return to textarea. return to how it was done multiple iterations ago, where submit, mic etc would sit on the right, always scratching the bottom if textarea extends. and textarea wasn't under them. review git history. get me to the point right before i requested wrap-around like behavior.

Design notes:

- The `ComposerEditable` refactor (#152, merge `be6f1b0`, commit `11178de`) shipped a `<div contenteditable>` whose empty-state focus-management was broken: clicking the empty composer produced a white focus ring but never landed the caret inside the editable region. Voice-input append likewise failed because the contenteditable's `value` setter via `Object.defineProperty` didn't survive a re-render in some focus paths.
- Reverting all 4 user-visible files + AGENTS.md "Composer layout" section + composer-editable.tsx deletion back to `2caf0fd` (the floating-overlay + `pr-24` state). AI_TODO #152 status flipped from PENDING to REVERTED with backlink to this entry.
- This entry is the new pre-wrap-around floor. No more wrap-around attempts unless the user explicitly re-requests them with a different architectural ask (a textarea CANNOT do flow-around, and the contenteditable swap regressed core typing/STT behavior - the only thing left would be a much-bigger contenteditable rewrite with proper focus-trap + IME testing on real Android Chrome).
- Files touched in this revert:
  - `apps/web/src/components/file-mention-popover.tsx` (caret-coordinate branch removed, back to textarea-only)
  - `apps/web/src/components/slash-command-popover.tsx` (same)
  - `apps/web/src/routes/_app/session/$id.tsx` (Textarea + absolute-positioned bottom-right button overlay restored, `pr-24` restored)
  - `apps/web/src/routes/_app/session/new.tsx` (same)
  - `apps/web/src/components/ui/composer-editable.tsx` (deleted)
  - `AGENTS.md` "Composer layout" section restored to the floating-overlay description
- Deploy: `scripts/deploy.sh` builds + dev probe (5001) + prod probe (5000).
- Push to both `origin` (gitlab) and `github`.
- Worktree: NONE - working directly on `main-nowaker` per user direction ("always deploy, whether someone else's work in progress or not"). Other agents' WIP in `apps/web/src/lib/session-status.ts`, `apps/web/src/routes/_app/live-messages.tsx`, `apps/web/src/server/lib/messages-refresh.ts`, plus untracked files like `apps/web/src/server/lib/live-messages-state.ts` and `apps/web/src/server/live-messages/`, left strictly untouched in the working tree (not staged, not committed by this revert).
