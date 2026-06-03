---
status: DONE
commit: a829a24
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T04:15:53-05:00
legacy_number: 30
---

# Section M follow-up: --allow-in-flight -> --abort flow

User prompt:

> FOLLOW-UP for Section M (move-session feature).
>
> The opencode-tools backend just shipped smarter in-flight handling for move-local. See commit https://gitlab.com/Nowaker/opencode-tools/-/commit/25af6fb on master.
>
> WHAT CHANGED:
>
> Before:
>   move-local refused ANY in-flight session with "Re-run with --allow-in-flight".
>   No distinction between live runners and dead subagents whose DB messages
>   just LOOK in-flight (no completion timestamp from when their runner died).
>
> Now (default behavior, no flag needed):
>   For each in-flight candidate session, move-local queries the stuck-detector
>   plugin at http://127.0.0.1:4098/verdicts/<sid>. Falls back to in-process DB
>   classification (detect() from _lib/stuck-detector/db-detector) when plugin
>   is unreachable.
>
>   - Session classified as STUCK (no-runner / stale-stream / etc.): auto-skip
>     the in-flight check, move proceeds silently. Common case for dead
>     @explore subagents.
>   - Session classified as LIVE (opencode_runtime_busy=true): refuse with a
>     clean error message naming the live session(s) and hinting that any
>     stuck siblings would have been auto-skipped:
>
>       move-local failed: refusing to move 1 actively-running session(s):
>         ses_229d7083... (2 stuck subagent(s) would have been auto-skipped).
>         Re-run with --abort to abort live runners first, or
>         --allow-in-flight to bypass safety entirely.
>
> NEW FLAGS:
>
>   --abort               POST /session/<sid>/abort to the owner opencode
>                         instance for each LIVE runner, then move. Use this
>                         for the common scenario: parent is busy, dead
>                         subagents are auto-skipped, --abort handles the
>                         parent.
>   --plugin-url URL      Override stuck-detector endpoint (default 127.0.0.1:4098).
>   --opencode-url URL    Override opencode HTTP endpoint for --abort fallback
>                         when plugin verdict has no owner_instance_url
>                         (defaults to OPENCODE_URL env or 127.0.0.1:4096).
>
> EXISTING FLAGS:
>
>   --allow-in-flight     Legacy escape hatch. Bypasses ALL classification.
>                         Use only when stuck-detector is unreachable AND
>                         you know the runner is wedged. DO NOT expose this
>                         in the portal UI - it's a CLI-only debug knob.
>
> PORTAL SECTION M UI IMPLICATIONS:
>
> For the "Move to project..." right-hamburger action you're building, the
> backend calls move-local. The UI should expose these states:
>
>   1. Default click: backend invokes move-local with no special flags.
>      - If all in-flight sessions are stuck: succeeds silently.
>      - If any session has a live runner: backend returns the structured
>        error. UI shows a confirmation dialog: "This session has a live
>        runner. Abort and move?" with Abort+Move / Cancel buttons.
>      - On Abort+Move: backend re-invokes with --abort.
>
>   2. NEVER expose --allow-in-flight in the UI. It exists only at the CLI
>      level for debug / recovery scenarios. The default behavior already
>      handles the legitimate cases.
>
> BACKEND WIRING:
>
>   apps/web/src/server/lib/move-session.ts (or wherever you place the
>   call): shell out to move-local via execFile:
>
>     const args = [
>       '/home/nowaker/projekty/nowaker/opencode-tools/move-local.ts',
>       '--session', sessionId,
>       '--target', targetPath,
>     ];
>     if (opts.abort) args.push('--abort');
>     // do NOT add --allow-in-flight from the API; user can pass it via CLI
>
>     const { stdout, stderr, exitCode } = await execFile('bun', args);
>
>     if (exitCode === 0) return { ok: true, ... };
>
>     // Parse stderr for "actively-running session(s)" - that's the
>     // signal to surface the "Abort + Move?" confirmation in the UI.
>     const liveMatch = stderr.match(/refusing to move (\d+) actively-running session\(s\): ([^.]+)/);
>     if (liveMatch) {
>       return {
>         ok: false,
>         reason: 'live-runner',
>         liveSessionIds: liveMatch[2].split(', ').map(s => s.trim()),
>         message: stderr.trim(),
>       };
>     }
>
>     return { ok: false, reason: 'other', message: stderr.trim() };
>
> DRY-RUN: move-local supports --dry-run; the backend should call it on the
> pre-flight check that drives the "Will move N sessions" preview in the UI
> before the real move.
>
> DEFERRED:
>
> The proper library extraction (calling moveLocal() from openportal directly
> rather than execFile) is still queued at opencode-tools side. The
> execFile approach is fine for v1 and avoids the workspace-linkage work.
>
> This is an ENQUEUE - add to the end of your work queue. Continue what
> you're currently working on first.

Design notes:
- Backend route `apps/web/src/server/opencode/[port]/session/[id]/move-to-project.post.ts`: drop `allowInFlight` body param, accept `abort` instead. Parse move-local stderr for `refusing to move N actively-running session(s): ses_A, ses_B` regex; on match return HTTP 409 with `{liveRunner: true, liveSessionIds: string[]}`. Non-live-runner errors → HTTP 500. Library extraction (moveLocal() import) deferred to opencode-tools side; execFile stays for v1.
- Frontend `apps/web/src/components/app-sidebar-nav.tsx`: rename state `moveInFlightPrompt` → `moveLiveRunnerPrompt` (carries `liveSessionIds: string[]`). Replace "Override (allow in-flight)" confirm button with "Abort and move" (still danger tone). New dialog lists the offending session IDs in a `<ul>` of monospace text + the underlying CLI error in a `<pre>`. Click → `callMoveLocal(targetPath, {abort: true})` → CLI re-invoked with `--abort`.
- `--allow-in-flight` is intentionally NOT exposed in the portal UI per the opencode-tools maintainer note — it's a CLI-only debug knob.
