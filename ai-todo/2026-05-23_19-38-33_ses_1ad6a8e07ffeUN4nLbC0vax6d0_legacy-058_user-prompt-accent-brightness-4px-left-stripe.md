---
status: DONE
commit: 0df212d
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T19:38:33-05:00
legacy_number: 58
---

# User-prompt accent brightness + 4px left stripe

User prompt:

> Enqueue to end: make user prompts in chat log much brighter accent color. Current one can be barely distinguished from ai messages.

Design notes:
- 0df212d: bumped userBgClass from bg-accent/10 → bg-accent/30 (3x light-mode tint), dark:bg-accent/8 → /25, border-accent/50 → /80.
- a1d7336: added border-l-4 + border-l-accent so each user message has the canonical chat-UI left-stripe accent (Slack/Discord pattern) on top of the brightened body.
