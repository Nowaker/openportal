---
status: DONE
session: ses_1907e1ca3ffeDsBKgJyG6i7IU4
queued_at: 2026-05-27T21:07:02-05:00
legacy_number: 102
commits:
  attributed:
    - 2bd3d4dab8d1
  on_main:
    - 2bd3d4dab8d1
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Stuck-detector liveness probe: switch from /config to /health endpoint

User prompt (verbatim):

> continue. (if anything to do left)
>
> note: opencode-tools, including all plugins like stuck detector, got updated in the meantime. proceed accordingly.
> rules of the game: Create a git worktree (if you haven't yet). Develop and test there (when possible). Merge to the primary branch when done. Deploy the application and make sure it works. Push afterwards. Remember to obey project's AGENTS.md and always append to AI_TODO.md.

Design notes:

- The "future / optional" plugin-side improvement footnoted in #25's
  design notes ("opencode-tools side will add a /health endpoint that
  returns instant static data, no map/DB access...") has now landed.
  Verified via direct curl: `GET http://127.0.0.1:4098/health` returns
  `{"ok":true,"ts":"<iso>"}` — 43 bytes, smaller than /config's 704 B
  and much smaller than /verdicts' 11+ KB.
- Single-constant change in
  apps/web/src/server/stuck-detector/status.get.ts: `PROBE_PATH`
  flips from `/config` to `/health`. The rationale comment is
  expanded to document the three-step probe-path evolution
  (/verdicts → /config → /health), each step further reducing the
  work the plugin has to do to answer "are you alive?". This matches
  the existing PROBE_TIMEOUT_MS rationale block right above it.
- Defense-in-depth motivation per #25's diagnosis: even when host
  opencode is under heavy LLM/tool-call load and /config/verdicts
  handlers can't slip between blocking operations, /health's
  near-zero handler cost (no DB lookup, no map iteration, just
  returns a static literal with `Date.now()`) is the most likely
  to make it through. Keeps the stuck-detector-install banner
  correctly hidden during busy moments instead of false-positive
  firing as "plugin not loaded".
- Worktree: `~/projekty/webapps/portal-health-probe` (branch
  `health-probe`, rebased onto current main-nowaker before
  ff-merge to absorb the parallel-agent commit 38542c5 user-prompt
  bubble + 604e52b/93fc003 stuck-detector UI changes that landed
  mid-work).
- End-to-end verification on live prod after deploy: `GET
  http://100.105.229.19:5000/api/stuck-detector/status` returns
  `{"connected":true,"status":200}` — confirms portal is hitting
  /health and getting a healthy response. Direct plugin probe at
  `127.0.0.1:4098/health` confirms the 43-byte static handler is
  live.
- Deploy: scripts/deploy.sh shipped index-BphLS6lr.js to dev:5001
  + prod:5000; both remotes synced at 2bd3d4d.


## Q-DEFERRED (open questions awaiting user input)

- **Q1**: WebRTC for plugin internet access — propose an approach? (See PENDING #14)
- **Q2**: L7 `?scope=` URL-param permalinks — concrete use-case example needed before implementing. (See PENDING #15)
- **Q3**: OpenPortal as offline cache — user explicitly deferred; await reactivation. (See PENDING #16)
- **Q4**: SESSION_WEDGED_BANNER source + 4 options — analyzed in `ai-analysis-requests/SESSION_WEDGED_BANNER.md`. (See PENDING [Q4] above)

---

## ARCHITECTURE REFERENCE

Full directive lives at [`ai-analysis-requests/STUCK_DETECTION_INCORPORATION.md`](ai-analysis-requests/STUCK_DETECTION_INCORPORATION.md) (`d8d52a5`).

Architecture docs in `ai-analysis-requests/`:
- `COMPETITOR_ANALYSIS.md`
- `COST_DISCREPANCY_INVESTIGATION.md`
- `FEATURE_VALIDATION_REPORT.md`
- `MCP_STATES_AND_AUTH.md`
- `MESSAGE_ACTIONS_AUDIT.md`
- `OFFLINE_CACHE_DESIGN.md` ← the deferred offline mode design (PENDING #16)
- `OPENCODE_COMPAT_BRIDGE_DESIGN.md`
- `PROMPT_SUBMISSION_STATE_MACHINE.md`
- `SLASH_COMMANDS.md`
- `STUCK_DETECTION_INCORPORATION.md`

Plugin endpoints at `127.0.0.1:4098` (loopback, no auth):
- `GET /verdicts` — snapshot map<sessionID, Verdict>.
- `GET /verdicts/stream` — SSE deltas.
- `GET /workers` — registered opencode instances.
- `GET /config` — current stuck-detector config.
- `PUT /config` — replace config (whole document).
- `POST /unstuck/:sid` — dispatch recovery, body `{ cause? }`.
- `GET /actions?since=N&limit=N` — journal pagination.
- `GET /actions/stream?since=N` — journal SSE (LIVE on opencode-tools master `c8f181e+`).

opencode-tools master tip: `f38233b` (clean-session improvements). Recent CLIs all flattened to repo root. `move-local --target` auto-resolves project_id vs worktree path; `clean-session --project` reuses `moveLocal()`; `dump-user-messages --filter` + slash-command awareness shipped.

This session was MOVED from `ai-workspace` (project_id `dd569a167576e0b40276633d8d9ebc7eb58a6f8d`) to `webapps/portal` (project_id `e99d5e0eb7be2fe688ff7dd54f9daf04e5e8426f`) via `move-local --target ~/projekty/webapps/portal --allow-in-flight`. Snapshot tree relocated.

Worker-instance ID format: `<host>-<pid>-<port>` (e.g. `nwkr-desktop-165697-4096`). Section G subscribe-to-everything cache may need to add a mapping to portal's `serverId` (`srv-xxx`) — verify in `apps/web/src/server/plugins/session-prefetcher.ts`.

---

## CANCELLATION-ANALYSIS NOTES

A deliberate sweep for "which prompts cancel which" across all 568 found:

- **6 explicit cancellations / removals** (above). The user is clear about removals; never silent.
- **No silent supersedes detected** — when the user changes their mind, they say so explicitly. Refinements (e.g. "blur" → "scrim opacity" on image preview; "70%" → "30%" backdrop) are absorbed into the corresponding commits, not added as separate items.
- **Multi-message streams**: the user sometimes sends 3-5 quick prompts that refine a single idea (the 2026-05-21 06:35-06:49 sequence about OpenPortal API independence + offline cache is the canonical example). Treat each contiguous stream as ONE intent; the user's final wording in the stream is authoritative.
- **/ulw-loop and /ralph-loop directives** are NOT new tasks — they're "run your existing queue to completion" commands. Don't add them to the todo.
- **OMO-continuation messages** ("Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.") are NOT user prompts — they're hook-injected automation. Filtered by default in dump-user-messages.

---

## RUN-IT INSTRUCTIONS

To pick up next session:

1. `cd ~/projekty/webapps/portal && git --no-pager log --oneline -15` to confirm tip is `14a0925` (file-mention dual-trigger) or later.
2. `git --no-pager status -s` to see in-flight work.
3. Read this file. Start with PENDING.

**Suggested priority order**:
- #1, #2, #3 (Sections L/M/N) — freshest user dispatches; ALREADY queued via prompt_async `msg_e53093eda` on this session.
- #4 (file-browser scroll cap) — easy, user-visible.
- #13 (context-dial regression check) — easy if regressed; verify first.
- #11 (subagent perm cascade) — verify + fix.
- #5/6 (permalink-UX + server-permalink audit) — moderate.
- #7 (sticky-bottom on banner injections) — moderate.
- #8 (voice premature-flush residual) — investigate.
- #9/10 (recently-mentioned-files implementation + 2-section ordering) — moderate.
- #12 (externalOpencode regression smoke-test) — quick verification.
- #17/18 (LFS/branch-protect operational follow-ups) — quick verification.
- #19 (asset-load smoke-test) — quick verification.
- #20 (compaction-summary GC) — move to opencode-tools backlog.
- Q-items #14, #15, #16 — await user input.

For Section L/M backend (opencode-tools interop):
```
bun ~/projekty/nowaker/opencode-tools/move-local.ts --session <sid> --target <path-or-project-id> [--allow-in-flight] [--dry-run]
```

Library extraction into `_lib/opencode-session-transfer/` is queued separately on the opencode-tools side. For v1, execFile from the openportal backend is the path of least resistance.

---

End of comprehensive AI_TODO.md refresh.
