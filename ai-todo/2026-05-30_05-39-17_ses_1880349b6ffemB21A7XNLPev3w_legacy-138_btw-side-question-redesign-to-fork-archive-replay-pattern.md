---
status: DONE
session: ses_1880349b6ffemB21A7XNLPev3w
queued_at: 2026-05-30T05:39:17-05:00
legacy_number: 138
commits:
  attributed:
    - 0b9786e7336a
  on_main:
    - 0b9786e7336a
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# /btw (side question) - redesign to fork-archive-replay pattern

User prompt (verbatim):

> btw is not implemented correctly.
> this should work like this:
> 0. post a synthethic user message here - one that will not be sent to the AI, but will be sent to user in chat log
> 1. create a fork in background; don't show it as an active session in navbar; give it a session name with prefix eg [btw#NO] where #NO is btw number in this session
> 2. gather the final response
> 3. archive btw session
> 4. post the second synthetic message with the ai's response:
>
> formatting: question is like user prompt - green, but starts with /btw and here goes what user asked.
> answer is half way between user prompt background color and chat log background color.
>
> --- /btw as imoplemented in claude code
>
> Side questions with /btw
> Use /btw to ask a quick question about your current work without adding to the conversation history. This is useful when you want a fast answer but don't want to clutter the main context or derail Claude from a long-running task.
> /btw what was the name of that config file again?
> Side questions have full visibility into the current conversation, so you can ask about code Claude has already read, decisions it made earlier, or anything else from the session. The question and answer are ephemeral: they appear in a dismissible overlay and never enter the conversation history.
> Available while Claude is working: you can run /btw even while Claude is processing a response. The side question runs independently and does not interrupt the main turn.
> No tool access: side questions answer only from what is already in context. Claude cannot read files, run commands, or search when answering a side question.
> Single response: there are no follow-up turns in the overlay. To continue the thread, fork it into its own session with f.
> Low cost: the side question reuses the parent conversation's prompt cache, so the additional cost is minimal.
> Once the answer appears, the overlay accepts these keys. Earlier side questions from the same session appear as a dimmed list above the current answer; they stay out of the conversation history but remain visible in the overlay until you clear them.

Design notes:

- Current implementation (verified live just now): /btw injects a system-reminder into the SAME session - "[BTW: side question - answer briefly in ONE response, do not call any tools, do not promise follow-up actions]" - which DOES enter the conversation history. That's the opposite of what /btw should do.
- Desired flow (per user spec above):
  0. Synthetic user message in PARENT chat log only. Visible to user, NOT delivered to opencode. Counter-prefixed `[btw#N]` where N increments per parent session.
  1. Background fork off the parent session. Fork's title = `[btw#N] <first 60 chars of question>`. Fork is HIDDEN from sidebar/navbar (new visibility flag, similar to archived but stronger - never surface even under "Show archived").
  2. Fork runs the question with full parent context (opencode `/session/<sid>/fork` already preserves history). Gather the final assistant response.
  3. On completion: archive the fork session (sets archive flag in openportal state). Fork stays hidden because of the new hidden-from-sidebar flag, but archive ensures it doesn't keep accumulating activity.
  4. Render the assistant's response as a SECOND synthetic message in the parent chat log, NOT delivered to opencode. Half-way color between user-prompt bg and chat-log bg.
- Tool access restriction: side questions get answered using only context already in scope. Either (a) pin opencode to a "no tools" mode on the fork's prompt call, or (b) trust opencode/agent settings + system reminder. The Claude Code spec says "Claude cannot read files, run commands, or search" - so we need an enforceable no-tool guarantee, not just a hint.
- Availability while parent is busy: /btw must work even mid-turn. The parent's in-flight assistant turn continues uninterrupted; the fork has its own runner. Confirms the fork-based design - injecting into the same session would block on the parent's turn.
- Synthetic message infrastructure: this is NEW. Today every chat-log entry is backed by either (a) an opencode message or (b) a virtual prompt from openportal's prompt-archive that's awaiting opencode delivery. The /btw entries are neither - they're openportal-only, never sent to opencode. Likely needs a new `synthetic_messages` table or extension of prompt-archive with a `synthetic_only` flag. Visual rendering treats them as first-class chat entries but routing must skip them.
- Multi-session counter: `#N` is per-parent-session. Track via openportal-state.json or a column on the parent session row. Persists across openportal restart so the counter doesn't reset.
- Visibility flag: new `hidden_from_sidebar: boolean` column on session metadata (or workspace-state). Stronger than `archived`. Always-filtered-out in `useSessions()`, `useArchivedSessions()`, AND in the sidebar tree builders. Only surfaced via an explicit `?include_hidden=1` debug query.
- Files likely to touch:
  - `apps/web/src/components/slash-command-popover.tsx` (the user's current dirty edit area)
  - `apps/web/src/server/lib/prompt-archive.ts` (extend for synthetic-only entries)
  - `apps/web/src/server/opencode/[port]/session/[id]/fork.post.ts` (the fork mechanism portal already wraps)
  - `apps/web/src/stores/sessions-store.ts` + sidebar filter chain (hidden_from_sidebar)
  - `apps/web/src/routes/_app/session/$id.tsx` (synthetic message rendering + counter)
  - Possibly a new server route `/api/btw` that orchestrates fork+archive+synthetic-write
- Open question: parent session might already be at the latest tip; forking at HEAD vs at last-user-message matters for "full context visibility". Claude Code's spec says "Side questions have full visibility into the current conversation" - so fork at HEAD (which includes the latest assistant turn) seems right.
- Open question: when the parent's in-flight assistant finishes WHILE the /btw fork is still running, the user sees both updates. Order in chat log = `time.created` ordering. Synthetic-message timestamps need to come from openportal (now()), not opencode (which doesn't know about them).
- Worktree: TBD when work starts.

Follow-up commits:
- 68a3103 - btw v2: fix wrong-answer bug (inherited-completion got picked as the answer) + inline thinking indicator (pending row via migration 0006 + _pending sentinel) + drop the success toast + hermetic e2e test (Bun.serve mock, no real opencode/LLM).
- ab2308e - btw styling: /btw#N pill on both question + answer rows, mid-bg (bg-primary/[0.06]) on the answer so it reads as half-way between user-prompt bg and chat-log bg. Tooltips explain the ephemeral nature. Hooks on info._synthetic + info._btw_index from the messages.ts wrapper; existing stuck-detector-plugin synthetic path untouched.
