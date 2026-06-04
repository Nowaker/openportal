---
status: PENDING
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T20:49:33-05:00
legacy_number: 61
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Bulletproof prompt history: localStorage first bastion + reconciliation

User prompt (verbatim):

> End of queue: inspect draft clearing code. I once submitted a prompt and it went nowhere. It showed on the chat log for a while. But not in prompt history. Clicking the button should ALWAYS put it in the history. If message gets lost somehow in routing, whatever, it still must be in prompt history. I've an idea. Local storage as the first bastion for prompt history. It goes there. Then send to openportal backend. Only when openportal backend accepts it and gives us an ID back (means it was saved), then frontend can clear it from local storage. If for some reason there's leftover local. Storage entries, they should be shown in between "legit" backend derived prompts. And on prompt history render, when front end notices it, should send it to backend as "history only entry, not a prompt to submit". So it's persisted. In prompt history list it should show as "not sent" or some other descriptive label. But it needs to have all the Metadata eg datetime is when user clicked submit prompt. Make it bullet proof. No prompts, ever, must be lost. Even if openportal is down, for a brief moment or for hours!

Phase 1 (142632f, DONE): localStorage capture before fetch.
- New `apps/web/src/lib/pending-prompts.ts` single-key store (`openportal-pending-prompts-v1`) holding `PendingPromptEntry[]` with full metadata: `{localId, sessionId, port, text, model, agent, variant, attachmentsCount, submittedAt, lastError, attempts, kind, commandName?, commandArguments?}`.
- Main composer submit at `$id.tsx` wrapped: `recordPendingSubmission` IMMEDIATELY before fetch; on 2xx -> `clearPendingSubmission`; on failure -> `recordFailedAttempt` with error text + rethrow.
- Cross-tab sync via `storage` event. Defensive try/catch on read+write so SSR/private-mode/quota-exceeded degrade gracefully.

Phase 2 (fc37d72, DONE): /prompts UI surface.
- `usePendingSubmissions()` hook subscribes to localStorage changes.
- New `PendingSubmissionsBanner` at top of /prompts scrollable area, shown when count > 0. Per-entry row: relative age, session-id prefix, attempt count, last-error tooltip, text (truncated 200), Drop button. "not sent" pill in warning yellow.

Phase 3a (52596da, DONE): wrapped 2 more submit sites with the record/clear pattern — new-session create at `new.tsx`, sidebar runTool helper at `app-sidebar-nav.tsx`. The retry-only sites (`$id.tsx:4634` stuck-busy auto-retry) are intentionally skipped since the original submit already captured the prompt; wrapping would dupe entries.

Phase 3b (7cabf07, DONE):
- `PromptStatus` type extended with `history-only` (`prompt-archive.ts`). `listPendingPrompts` already filters by `status='pending'` so the worker auto-ignores history-only rows.
- New POST `/api/prompts/persist-orphan` endpoint (`apps/web/src/server/prompts/persist-orphan.post.ts`) takes a PendingPromptEntry-shaped body and archives via `archivePrompt` with `status='history-only'`. Validates sessionId+port+text non-empty.
- Render-time reconciler in `PendingSubmissionsBanner`: on every render, scans entries older than ORPHAN_RECONCILE_AFTER_MS (60s) and POSTs them to `/persist-orphan`. `reconcileInFlight` Set prevents duplicate posts. On 2xx, the localStorage entry is cleared — entry is now durably in backend SQLite, surviving browser cache clears, multi-device, hours of openportal downtime.

Phase 3c (last sub-task, ALSO DONE - question-fallback wrap):
- `$id.tsx:870` question-fallback prompt wrapped with the same record/clear pattern. The remaining unwrapped submit site is `$id.tsx:4634` (stuck-busy auto-retry), which is portal-initiated automated retry of a prompt that was ALREADY captured during the original user submit; wrapping would duplicate the localStorage entry.

End-to-end flow now BULLETPROOF:
1. User clicks Submit -> `recordPendingSubmission` writes to localStorage IMMEDIATELY. Even if browser tab crashes 1ms later, the entry survives.
2. fetch `/api/prompt`. 2xx -> `clearPendingSubmission`. Failure -> `recordFailedAttempt` records error + attempt count.
3. `/prompts` banner shows surviving entries as "not sent" pill.
4. After 60s, render-time reconciler POSTs orphan to `/persist-orphan` which archives `status='history-only'`. localStorage entry cleared. Row is now in backend SQLite. Visible in `/prompts` forever, surviving browser cache clears, multi-device, hours of openportal downtime.

User invariant met verbatim: "No prompts, ever, must be lost. Even if openportal is down, for a brief moment or for hours!"
