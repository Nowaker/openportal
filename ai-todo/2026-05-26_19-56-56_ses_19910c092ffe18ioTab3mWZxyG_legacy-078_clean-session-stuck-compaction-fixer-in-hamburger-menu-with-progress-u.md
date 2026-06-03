---
status: DONE
commit: ebdbc92
session: ses_19910c092ffe18ioTab3mWZxyG
queued_at: 2026-05-26T19:56:56-05:00
legacy_number: 78
---

# Clean session + stuck-compaction fixer in hamburger menu, with progress UI + auto-navigate to fork

User prompt (verbatim):

> Clean session and compaction stuck recovery tool (in ~/projekty/nowaker/opencode-tools) should both get rid of duplicate messages (e.g. repeptitive "continue", or events (e.g. compaction performed marked multiple times in a row - for sessions in compaction stuck cycle). should be incorporated into openportal into session > hamburger. these tools, since they are long running, must show progress as things happens. e.g. when creating new session, there is like a progress bar explaining everything that is going on. here, the same should happen.
> moreover, when i'm cleaning session X and as a result session Y gets created, portal should navigate to session Y when done.
>
> build on a worktree, merge to main branch and redeploy portal when done.

Design notes:

Two CLIs in `~/projekty/nowaker/opencode-tools/` get exposed through the portal session-hamburger menu, both forking the source and yielding a NEW session id that the UI must auto-navigate to. Both are long-running (15-120s typical) so they need streaming progress feedback identical to the new-session creation pattern (`setSendingStatus` with phase labels + Loader spinner + verbatim-prompt preview).

**Two-half delivery:**

A. `opencode-tools` side (separate commit on `master`):
   - Add `_lib/session-cleaner/dedup.ts` (new module) with two pure functions over `Database`:
     - `dedupConsecutiveDuplicateUserPrompts(db, sessionID)` - walks user messages, collapses runs of identical normalized text (`"continue"`, `"continue if you have next steps..."`, etc.) into the first occurrence. Drops the dup messages + their parts. Stops at compaction summary boundary so we don't touch post-compaction-tail.
     - `dedupConsecutiveFailedCompactions(db, sessionID)` - finds runs of `summary=1 finish=error` (or `summary=1 finish=stop` followed immediately by another `summary=1` with no user turn between) and keeps the LATEST in each run. Removes earlier failures + their parts. Preserves the final successful compaction.
   - Wire `dedupConsecutiveDuplicateUserPrompts` + `dedupConsecutiveFailedCompactions` into `cleanSessionInPlace()` BEFORE the existing prune logic (returns counts in `CleanStats`).
   - Wire same dedup into `stuck-compaction-fixer.ts`: run BEFORE the walk-back evaluation so the evaluator sees a deduped session.
   - Both tools emit progress events for the new dedup steps (`dedup_started`, `dedup_completed` with `duplicates_dropped` + `failed_compactions_dropped`).
   - Unit test the dedup logic against handcrafted DBs.

B. `portal` side (worktree `clean-stuck-ui` -> merge -> deploy):
   - `apps/web/src/server/lib/long-op-runner.ts` (new): subprocess registry. Spawns `bun ~/projekty/nowaker/opencode-tools/<script>.ts <sid> --progress-file /tmp/openportal-runs/<runId>.jsonl` via `Bun.spawn`. Maintains a Map<runId, { proc, progressPath, subscribers, terminated }>. Cleans up state 60s after process exit.
   - `apps/web/src/server/session-ops/clean.post.ts` (new): POST `/api/session-ops/clean` with `{ sessionId, port?, directory?, aggressive? }`. Mints runId (uuid), spawns subprocess, returns `{ runId }`. Validates session exists and the user's opencode is reachable.
   - `apps/web/src/server/session-ops/stuck-fix.post.ts` (new): POST `/api/session-ops/stuck-fix` with `{ sessionId, port?, directory?, cleanBeforeCompaction? }`. Same spawn pattern but for stuck-compaction-fixer.
   - `apps/web/src/server/session-ops/[runId]/stream.get.ts` (new): SSE endpoint. Tails the progress file, emits each JSONL line as one `data:` SSE frame. Heartbeat every 25s (Caddy idle-close defense). On subprocess exit emits a terminal `{event: "process_exited", code}` frame and closes.
   - `apps/web/src/components/long-op-dialog.tsx` (new): React-aria Modal. Props: `{ kind: "clean" | "stuck-fix", sessionId, port, directory, isOpen, onOpenChange, onForkCreated }`. POSTs the start endpoint, opens EventSource on the runId stream, maps each progress event to a human phase label (matching the new-session flow's tone), renders Loader + phase label + verbatim sessionId/title preview. Disables backdrop dismiss while busy. On `event=done success=true fork_session_id=ses_*` fires `onForkCreated(forkId)` -> caller navigates via `startTransition(() => navigate({to: "/session/$id", params: {id: forkId}}))`. On `event=done success=false` shows error + Retry.
   - `apps/web/src/components/app-sidebar-nav.tsx`: extend the session-context MenuSection with "Clean session..." + "Fix stuck compaction..." entries (icons: `SparklesIcon` + `WrenchScrewdriverIcon`). Disabled when `isArchived` because both tools refuse to touch archived sessions. data-test attributes: `portal-hamburger-clean-session`, `portal-hamburger-stuck-fix`.
   - Telemetry: `logSystemMessage("session", "success", "Session cleaned", `forkId=...`, currentSession.directory)` on success; `"error"` on failure with full error string.

**Build / merge / deploy plan:**
1. `cd ~/projekty/webapps/portal && git worktree add -b clean-stuck-ui ~/projekty/webapps/portal-clean-stuck-ui main-nowaker`.
2. Commit opencode-tools changes to `master` (separate commit) FIRST so the portal subprocess path is functional.
3. Implement portal side on the worktree. `REBUILD=1 bash scripts/run-worktree.sh 5200` for foreground smoke.
4. Manual smoke: clean a real test session via the worktree UI, verify Loader updates through phases, verify auto-navigation to fork.
5. `git -C ~/projekty/webapps/portal merge --ff-only clean-stuck-ui` on main-nowaker.
6. `bash scripts/deploy.sh` from main-nowaker (dev-first probe, then prod).
7. `git push origin main-nowaker && git push github main-nowaker`.
8. `git worktree remove ~/projekty/webapps/portal-clean-stuck-ui && git branch -d clean-stuck-ui`.

---
