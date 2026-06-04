---
status: PENDING
session: ses_199f94180ffeYBjaI0fuz5pfGw
queued_at: 2026-05-27T21:06:25-05:00
legacy_number: 101
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Drop thick primary left bar on user prompt bubble; keep just top/bottom borders (DONE - 38542c5) [loser-bump: this work originally claimed #100 in a parallel-agent race; #100 went to the google-calendar-mcp entry above]

User prompt (verbatim):

> continue.
>
> ALSO: i don't want that bright green bold border on the left. just top and bottom borders. as they are now. no change there.
>
> note: opencode-tools, including all plugins like stuck detector, got updated in the meantime. proceed accordingly.
> rules of the game: Create a git worktree (if you haven't yet). Develop and test there (when possible). Merge to the primary branch when done. Deploy the application and make sure it works. Push afterwards. Remember to obey project's AGENTS.md and always append to AI_TODO.md.

Design notes:

- Follow-up on #95 (chat user-prompt bubble color swap accent → primary). The 4px `border-l-4 border-l-primary` accent bar that carried over from the original accent-styled bubble overpowers the new primary tone visually. The user's active theme variant resolves `--primary` to oklab with negative `b*` (verified `oklab(0.627 -0.167 0.099 / 0.15)` via chrome-devtools), which renders as a saturated green at full opacity on the 4px bar. Dropping the left bar leaves the top/bottom 1px borders + bg-primary/15 tint as sole framing.
- Single-line change at [apps/web/src/routes/_app/session/$id.tsx:2912](file:///home/nowaker/projekty/webapps/portal/apps/web/src/routes/_app/session/$id.tsx#L2912):
  - OLD: `"bg-primary/15 border-t border-b border-l-4 border-primary/30 border-l-primary [[data-role=user]+&]:border-t-0"`
  - NEW: `"bg-primary/15 border-t border-b border-primary/30 [[data-role=user]+&]:border-t-0"`
- Synthetic-marker branch on line 2911 (`bg-muted/30` for stuck-detector / compaction-fixer rows) unchanged — those aren't user prompts.
- Performed on worktree `~/projekty/webapps/portal-drop-leftbar` off `main-nowaker`. Code commit `38542c5` landed cleanly on both `origin` (gitlab) and `github` `main-nowaker` (`604e52b..38542c5`). Local main-nowaker FF'd via `git pull --ff-only`.
- Deploy ran cleanly via `bash scripts/deploy.sh` from main checkout (WT was clean of source modifications, only untracked docs). New bundle `index-Ddk0BcQP.js` served on dev (`:5001`) and prod (`:5000`) per the dev-first sequence in AGENTS.md.
- Verified live on prod via chrome-devtools-mcp on `[data-role="user"]` element: `borderLeftWidth: 0px` ✓ (left bar gone), `borderTopWidth/BottomWidth: 1px solid oklab(... / 0.3)` ✓ (top/bottom borders preserved at primary/30), `backgroundColor: oklab(... / 0.15)` ✓ (bg-primary/15 unchanged).
- AI_TODO race: original #100 sync (sha f218517) lost to `c838a7f` (google-calendar-mcp entry) on `origin` (canonical gitlab). Per AGENTS.md "loser bumps to N+1" rule, this entry is renumbered to #101 in a fresh commit on top of c838a7f. `github` `main-nowaker` momentarily accepted the f218517 push (it FF'd ahead of origin) and now sits diverged at f218517 carrying the old #100; force-push to main-nowaker is forbidden by AGENTS.md so github reconciliation is deferred to the user (likely a merge or one-time `--force-with-lease` from an operator session). The code change at 38542c5 is on both remotes and serving in prod — only the AI_TODO bookkeeping is split.
