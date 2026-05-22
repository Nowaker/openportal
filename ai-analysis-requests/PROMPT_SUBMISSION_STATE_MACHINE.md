# Prompt submission state machine

How openportal accepts a prompt from the browser and tracks it through
to the assistant's response. The previous version of this doc framed
the design around per-tab optimistic UI - the user rightly pointed out
that misses the architecture's actual intent. The real design is
**server-side durable storage**, with the chat log surfacing every
in-flight prompt as a first-class message regardless of which tab or
browser submitted it.

## Why server-side, not per-tab

The composer is a frontend concern; the prompt's lifecycle is not.
Once the user hits Send, the prompt belongs to **openportal**, not to
the tab that submitted it:

- Tab close mid-submission must not lose the prompt.
- Network blip between portal and opencode must not lose the prompt
  (worker retries from durable storage).
- A second browser viewing the same session must see the pending
  prompt - same status, same badge, same age - because the chat log
  reflects what openportal knows, not what one tab's local store
  remembers.
- A fresh page load on the submitting browser must show the pending
  prompt - no localStorage rehydration needed; the server tells the
  truth.

The implementation lives entirely under `apps/web/src/server/lib/`
(prompt-archive.ts, prompt-db.ts) plus the worker plugin at
`apps/web/src/server/plugins/pending-prompt-worker.ts`.

## Lifecycle stages

The `prompts` SQLite table tracks each submission with a `status`
column. Four canonical values:

| status     | meaning                                                 |
| ---------- | ------------------------------------------------------- |
| pending    | openportal has the prompt, worker hasn't dispatched yet |
| delivered  | opencode 204'd, prompt is in the session's tool queue   |
| failed     | worker exhausted retries; `last_error` carries the why  |
| sent       | a legacy/archive-only row (no worker handoff expected)  |

The frontend reads each row as a virtual user message with an
`_pending` info field carrying `{ attempts, lastAttemptAt, lastError,
archiveId, phase }`. Phase is a finer-grained UI state stamped by
the dispatch path:

| phase             | UI badge                         | who sets it                          |
| ----------------- | -------------------------------- | ------------------------------------ |
| submitting        | "Submitting" (blue)              | row insert (status=pending)          |
| opencode-accepted | "Sent to OpenCode" (darker blue) | worker after promptAsync 204         |
| (none)            | (badge gone)                     | real opencode message replaces it    |

After opencode emits its own user-role message via SSE the synthetic
row is reconciled by id - the worker marks the prompt row delivered,
the next /messages response no longer appends the synthetic, and the
opencode message stands on its own. The badge disappears because the
synthetic source is gone.

## End-to-end flow

```
[Browser] composer Send                                            t=0
   |
   | POST /api/opencode/:port/session/:id/prompt
   |   body: { text, attachments, model, agent, thinking }
   |
   v
[Portal] prompt endpoint
   | 1. validate body
   | 2. detectStuckFromRestart preflight (cheap)
   | 3. INSERT INTO prompts ... status='pending' phase='submitting'
   | 4. wakePendingPromptWorker
   | 5. return 202 { archiveId, recoveredFromRestart }       t=~10ms
   |
   v
[Browser]
   | Composer clears, cross-tab broadcast notifies other tabs
   | (their drafts clear ONLY if content matches - prevents stomping
   |  a partially-typed prompt in another tab on the same session)
   |
   | Next /messages refresh includes the row as virtual user msg
   | rendering "Submitting" badge
   |
[Portal] pending-prompt-worker plugin
   | Scans status='pending' rows
   | For each: POST opencode /session/:id/promptAsync ...
   |   on 204 -> UPDATE status='delivered', stamp phase='opencode-accepted'
   |   on err -> UPDATE last_error, retry on next scan (exp backoff)
   |
   v
[Browser] /messages now shows phase='opencode-accepted'
   | Badge flips to "Sent to OpenCode"
   |
[Opencode]
   | Picks up the prompt from its own session DB
   | Emits message.created (role=user) via SSE - REAL user message
   | Emits message.created (role=assistant) - the response in flight
   | Emits assistant parts (text/tool/reasoning) as it generates
   |
[Portal] indicator stream + /messages
   | Synthetic row stops being appended (the real one is there now)
   | Badge disappears
   | "Thinking..." indicator (server-side state, /api/indicators/stream)
   | renders below the now-completed user message
   |
[Opencode] message.updated with info.time.completed set
   | Stream finalizes the assistant message
   |
[Browser] indicator stream flips busy=false; the assistant message
   | renders fully; user can submit the next prompt
```

## Cross-browser visibility

Because the `prompts` SQLite table is the source of truth, any browser
hitting GET /api/opencode/:port/session/:id/messages?... receives the
same pending rows. There is NO per-tab pending state on the server
side - one tab POSTing the prompt, another tab refreshing the session,
both see the same "Submitting" badge until the worker dispatches and
the real message takes over.

This was the original spec for the feature ("if I submit a prompt from
browser 1 to this session and it's gone to 2 and completed it,
loading session in browser 2 has to show that prompt with the correct
badge in the chat log too" - user, May 2026), and it's how the
implementation behaves.

## Source map

- Storage: `apps/web/src/server/lib/prompt-archive.ts`,
  `apps/web/src/server/lib/prompt-db.ts`
- Async worker: `apps/web/src/server/plugins/pending-prompt-worker.ts`
- Endpoint: `apps/web/src/server/opencode/[port]/session/[id]/prompt.ts`
- /messages merge: `apps/web/src/server/opencode/[port]/session/[id]/messages.ts`
  (function `toVirtualUserMessage` at line ~182,
  pending-merge at line ~178)
- Frontend badge: `apps/web/src/routes/_app/session/$id.tsx`
  (uses `info._pending.phase`, line ~2542)
- Optimistic-display (per-tab safety net, not the source of truth):
  same file, `addOptimisticMessage` at line ~4293

## Open questions

The user's spec mentioned more granular intermediate states:

- "opencode picked it up for processing"
- "opencode thinks"
- "opencode posts response, tool calls, etc"

These are NOT carried as `phase` values today because they're already
observable via the existing primitives:

- "picked up" + "thinking" -> indicator stream's `busy` flag for the
  session, rendered as the "Thinking..." line below the last message.
- "posts response, tool calls" -> the actual stream of assistant
  parts arrives via SSE and renders incrementally.

Adding them as `_pending.phase` values would be redundant - the
synthetic row is GONE by the time opencode starts producing its
response. The badge progression
"Submitting" -> "Sent to OpenCode" -> (badge gone, indicator takes
over) is the complete observable lifecycle from the user's POV.

If we want a sticky in-place badge during the assistant-generation
phase, it should be a property of the assistant message (not the
user prompt) and surface as e.g. "Generating..." next to the
assistant message's avatar. That's a future enhancement, separate
from the prompt-submission state machine.
