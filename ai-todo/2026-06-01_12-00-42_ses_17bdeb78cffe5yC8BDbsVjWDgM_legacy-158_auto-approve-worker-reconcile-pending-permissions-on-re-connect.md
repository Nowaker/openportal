---
status: DONE
session: ses_17bdeb78cffe5yC8BDbsVjWDgM
queued_at: 2026-06-01T12:00:42-05:00
legacy_number: 158
commits:
  attributed:
    - b6016079097d
  on_main:
    - b6016079097d
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Auto-approve worker: reconcile pending permissions on (re)connect

User prompt (verbatim):

> this session is stuck because openportal doesn't show permission request, or doesn't auto reply yes (autoapprove is enabledd)
>
> something is utterly broken. fix it.
>
> once fixed, validate that ses_188220dadffeb8GepIK8xraEoj goes through since it has auto approve on!

Design notes:

- Root cause: `auto-approve-worker.ts` only fired on NEW `permission.asked` SSE frames. The `/event` stream is "events from now on" — any permission asked BEFORE openportal connects (process restart, network drop, opencode restart) leaves a stale pending request in opencode that the worker never sees, so the session hangs forever until the user manually clicks Allow in opencode UI.
- Fix: added `reconcilePendingPermissions(serverId, port, dedup)` that runs immediately after every successful SSE connect. It calls `permission.list()`, filters to requests whose session has `getEffectiveAutoApprove(sessionId) === true`, and fires `replyToPermission` with `auto: true` for each — recording each request id in a per-connection-cycle dedup set shared with `processStream` so a race-window double fire (request present in both list snapshot and SSE buffer) only sends one reply.
- Dedup set is reset on every new connection cycle (after retry / reconnect), so a permission still pending across a reconnect gets one fresh attempt — never an indefinite suppression.
- Pre-existing fetch-URL bug for `srv-9myqtdk1` (host `192.168.10.10` not currently reachable) surfaces in logs as `fetch() URL is invalid`. Out of scope for this fix; the secondary server's broken loop does not block the active one.
- Files touched: `apps/web/src/server/plugins/auto-approve-worker.ts`.
- Branch: `fix/auto-approve-reconcile-on-connect` at `~/projekty/webapps/portal-auto-approve-reconcile`; cherry-picked file onto `main-nowaker` as `b601607`. Deployed via `scripts/deploy.sh`.
- Validation: at 12:25:47 prod restart, log shows `[auto-approve-worker] reconcile snapshot read 0 pending for server=srv-2dy1srwz` — reconcile path executed. `ses_188220dadffeb8GepIK8xraEoj` had its pre-restart permission manually approved by the user; subsequent dispatches went through. Future restarts will drain any pending permissions for auto-approve-enabled sessions on the spot.
- The padding-only approach (pr-14 → pr-24) cannot satisfy "text flows around buttons, not under them" because the buttons live in an absolute overlay over the textarea. With ANY pr-XX, text technically wraps before the buttons but visually reads as adjacent / behind. Even pr-24 (42px gap) was rejected on mobile.
- True text-flow-around (CSS `float` + `shape-outside`) requires a contenteditable div, not a `<textarea>` — a heavy refactor with mobile risk (STT, draft persistence, paste, slash-command, file-mention all depend on textarea semantics).
- Chosen fix: lift buttons OUT of the textarea entirely. Textarea on top (flex-1), button row below (shrink-0), both inside the existing `relative min-w-0 flex-1 min-h-0 flex flex-col overflow-hidden` wrapper. Mic, stop, submit are inline siblings in the same horizontal row, right-aligned. Text simply cannot reach the buttons because they are below, not beside.
- AGENTS.md "Composer layout" section rewritten: marked floating-button overlay as a forbidden regression alongside the old flex-row regression. Documented why the flex-COL approach doesn't trip the flex-ROW mobile bugs (main-axis layout, no items-stretch cross-axis interaction).
- Both composers updated:
  - `apps/web/src/routes/_app/session/$id.tsx`: textarea className becomes `flex-1 min-h-[96px]` (was `min-h-[max(6rem,100%)] pr-24`); overlay div becomes `shrink-0 flex justify-end items-center gap-1.5 px-1.5 py-1.5`; conditional wrapper around mic+stop flattened; `pointer-events-auto` removed from buttons.
  - `apps/web/src/routes/_app/session/new.tsx`: same treatment, textarea className becomes `flex-1 min-h-[120px]` (was `min-h-[120px] pr-24`); overlay restructure same shape.
- Files: `apps/web/src/routes/_app/session/$id.tsx`, `apps/web/src/routes/_app/session/new.tsx`, `AGENTS.md` "Composer layout" section.
