---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T12:57:28-05:00
legacy_number: 47
commits:
  attributed:
    - 70f66523fd60
  on_main:
    - 70f66523fd60
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Slash command dup + queued sort + smart-dedup by opencode messageID

User prompts (chained, all about the same underlying class of issue):

> after that: i noticed that submitting a new session with /slash command resulted in seeing my prompt twice in chat log. first one as Queued the other one as sent to opencode. also updates didn't show up nicely. i only saw one tool call and that's it. i f5, the second dup prompt in chat log was gone, and was a ton of tool calls already.

> Thinking widget should be sorted correctly. Thinking is happening now. Submitting or queued is future. Must be AFTER thinking in the chat log. Some tool call being streamed in to the chat log, our prompt still queued? That means our queued message is BELOW thinking entry.

> Regarding dup, is there a way to make it smarter. Does opencode assign any ID to the message we send async to it? If gutting send async endpoint gets us some ID, we should associate it with our submitted prompt. Then, when we see the same id in the stream and the content is different, well, it's still our content just expanded or whatever. Id matching, not content matching.

Design notes:
- New-session form (`routes/_app/session/new.tsx`): detects leading `/` and routes via `/command` instead of `/prompt` (commit 70f6652). Without this, slash commands in new sessions double-emit (Queued virtual + real user message after slash expansion).
- Defensive dedup pass 2 in `messages.ts`: drop virtuals whose `raw_text.startsWith("/")` when ANY real user message arrived after the archive timestamp + 2s grace. Catches slash-command dups even without the ID-based pass 0.
- Queued virtuals sort AFTER in-flight thinking (commit 232109a): when a real assistant message is streaming, `effectiveCreated = max(row.ts_ms, latestRealAnyMs + 1)`. The user's queued prompt visually renders LAST instead of magically before the assistant's in-progress turn. Frontend `mergeByIdSorted` compares `time.created` ascending, so a bumped virtual ts_ms sorts to the bottom.
- Smart-dedup by opencode messageID (commit b6cc833): portal pre-generates `msg_<crypto.randomUUID().replace(/-/g, "")>`, threads it through `prompt_async.body.messageID` AND `command.body.messageID`, stores on archive row's new `opencode_message_id` column. Migration 0003 adds the column nullable (legacy rows have NULL; new archives populate it). Dedup pass 0 (NEW, runs BEFORE text-match passes): drop virtuals whose `opencode_message_id` matches a real user message's ID. Bulletproof against slash-command template expansion (where opencode's emitted user message text ≠ archived `/foo bar` string) — pure ID match, immune to text shape drift.
