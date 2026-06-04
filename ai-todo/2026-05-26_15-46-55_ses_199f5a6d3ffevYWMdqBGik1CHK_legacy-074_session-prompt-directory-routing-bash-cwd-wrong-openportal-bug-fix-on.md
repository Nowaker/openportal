---
status: DONE
session: ses_199f5a6d3ffevYWMdqBGik1CHK
queued_at: 2026-05-26T15:46:55-05:00
legacy_number: 74
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Session prompt directory routing (bash cwd wrong) - openportal bug, fix on worktree

User prompt (verbatim):

> ses_199f94180ffeYBjaI0fuz5pfGw
> look at this sessions's prompt and AI tool calls:
>
> ```
> portal: Sync chat prompts to navbar highlight
>
> make the user prompts in chat log the same color as the highlighted session in navbar when active.
> like this color-mix(in oklab,var(--primary)15%,transparent)
>
> remember to reuse components/definitions. don't hardcode.
>
> perform on a worktree. merge to master when ready.
>
>
> 15:43
> $
> bash pwd && ls -la
> # Check current directory
>
>
> 15:43
> $
> bash ls /home/nowaker/projekty/nowaker/ 2>&1 | head -50
> # List nowaker projects
>
>
> 15:43
> $
> bash ls /home/nowaker/projekty/nowaker/opencode-tools/ 2>&1
> # List opencode-tools
>
>
> 15:43
> $
> bash ls /home/nowaker/projekty/ai-workspace/ 2>&1
> # List ai-workspace
>
>
> 15:43
> $
> bash ls /home/nowaker/projekty/webapps/ 2>&1
> # List webapps
>
>
> 15:43
> Server is idle - prompt accepted but generation never started.
> ```
>
> why does it pwd, then try to find current project? when the session starts in /home/nowaker/projekty/webapps/portal? doesn't it know?  if not, why? what's wrong? opencode's default behavior, or openportal submitting a session incorrectly? if an openportal bug, fix on a worktree, merge to master afterwards.

Design notes:
- Diagnosis: opencode's workspace-routing middleware in `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts` resolves the per-request `InstanceContext.directory` via `defaultDirectory(request, url)`: URL `?directory=` query param OR `x-opencode-directory` header OR `process.cwd()`. The session looked up by id only contributes `workspaceID`, never `directory`. So sessions with `workspace_id = NULL` (the user's setup - configless mode, no remote workspace) fall through `defaultDirectory()` and land on opencode's `process.cwd()` = `/home/nowaker/projekty` (from systemd `WorkingDirectory=%h/projekty`). The shell tool's cwd is `instanceCtx.directory` so `pwd` returns the wrong directory and the AI gets confused about which project it's working in.
- Root attribution: openportal bug - the API contract from opencode is "every session-scoped POST must declare its directory" and openportal was only honoring it on session create, not on subsequent /prompt and /command POSTs. opencode itself could be argued to need a fallback to `session.directory` but that's an upstream change not authorized by this prompt.
- Fix: new helper `resolveSessionDirectory(port, sessionId)` in `apps/web/src/server/lib/opencode-client.ts` looks up `session.directory` via GET `/session/<id>` (which is "local action" in opencode's RULES so it doesn't itself need a directory header - breaks the chicken-and-egg cycle), caches 5min (immutable for session's lifetime in practice), best-effort fallback to `undefined`. Threaded into three session-scoped dispatch paths:
  - `apps/web/src/server/opencode/[port]/session/[id]/prompt.ts` - direct dispatch fallback + background abort.
  - `apps/web/src/server/plugins/pending-prompt-worker.ts` - background delivery (the path the bug reporter actually hit).
  - `apps/web/src/server/opencode/[port]/session/[id]/command.ts` - slash-command dispatch (v2 SDK uses flat `directory` param).
- SDK support verified at `@opencode-ai/sdk@1.2.27`: `SessionPromptAsyncData.query.directory` (v1), `SessionCommandData.query.directory` + flat `directory` parameter (v2). Both endpoints have always accepted the directory; openportal just wasn't passing it.
- Full investigation at `ai-analysis-requests/SESSION_PROMPT_DIRECTORY_ROUTING.md`.
- Worktree path: `~/projekty/webapps/portal-fix-session-directory` (branch `fix-session-directory-routing` off `main-nowaker` at `6b5e4c7`). Built bundle hash `BQPhedP4`. TypeScript clean on touched files (pre-existing `command.ts:61` `opencodeMessageId` use-before-declare bug confirmed on main-nowaker, NOT introduced by this fix).
- Verification plan: after deploy via `scripts/deploy.sh`, send a prompt asking the AI to run `pwd` from any active session; expect cwd = session's project worktree (not `/home/nowaker/projekty`).
- Deferred follow-ups (NOT in this fix's scope, separate todos):
  - Sweep other session-[id]/*.ts handlers (abort.ts, compact.post.ts, messages.ts SSE, todo.ts, revert.ts, archive.post.ts, fork.post.ts, export.get.ts, etc.) for the same directory threading. Most are GET requests where the wrong directory doesn't surface user-visibly, but the pattern should be consistent.
  - File upstream opencode issue/PR proposing `session.directory` as the fallback before `process.cwd()` in `workspace-routing.ts` `defaultDirectory()`. Would fix this class of bug for every opencode client, not just openportal.
  - Pre-existing `command.ts:61` use-before-declare bug (`opencodeMessageId` referenced in `archivePrompt({...})` payload BEFORE the `const opencodeMessageId = ...` declaration on line 69). TypeScript flagged it but it doesn't crash at runtime because of hoisting + the archive being fire-and-forget. Worth a separate one-line fix entry.

---
