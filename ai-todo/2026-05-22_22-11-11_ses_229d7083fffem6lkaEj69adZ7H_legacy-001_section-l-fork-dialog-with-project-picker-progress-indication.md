---
status: DONE
commit: 
session: ses_229d7083fffem6lkaEj69adZ7H
queued_at: 2026-05-22T22:11:11-05:00
legacy_number: 1
---

# Section L — Fork dialog with project picker + progress indication

User prompt (from current session, dispatched via prompt_async on the moved session — msg_e53093eda001lP62KebXqWBQSM):

> i also want openportal to have a feature clicking fork opens a dialog menu and you select to this directory (because for some reason 'this project' may not be actually THIS project... i don't understand why but this session ses_229d7083fffem6lkaEj69adZ7H when forked, landed in ~/projekty and not in ~/projekty/ai-workspace), or to a different project, and then use the same nice directory browser we have under 'open directory' that is keyboard use friendly.
>
> current issue with forking in portal: click gives no indication anything is going on. violation of rule from portal project's agents.md. wait for something to happen? indicate it. maybe a similar approach as with new session handling. it shows some statuses/progresses. reuse that architecture (but don't show init commands list, obviously; also does fork call get you a target session id immediately or very fast, without waiting for full fork to complete? if so, we can show a fake session view, with chat log pending, but since we have session id, we can let user start writing prompt and draft will be saved in the right place.)

Design notes:
- Replace immediate Fork action with a dialog: "Fork to this directory" (current session's `directory`, radio default) | "Fork to a different project" (radio) + "Cancel" / "Fork" buttons.
- Different-project option opens the hybrid filter+navigate picker shared with Section M.
- Multi-phase status text per portal AGENTS.md async-action-feedback rules: "Asking opencode to fork session..." → "Session forked. Cloning N messages..." → "Done. Opening the new session..."
- Placeholder session view opens immediately on opencode returning the new session ID; draft prompts persist keyed to that ID.
