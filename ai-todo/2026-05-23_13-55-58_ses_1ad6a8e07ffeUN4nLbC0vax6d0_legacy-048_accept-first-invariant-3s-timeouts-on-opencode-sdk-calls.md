---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T13:55:58-05:00
legacy_number: 48
commits:
  attributed:
    - 60ac234acb31
  on_main:
    - 60ac234acb31
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Accept-first invariant: 3s timeouts on opencode SDK calls

User prompt:

> While at it. Reminder: openportal must accept the prompt. Period. Opencode up or down, whatever. First, openportal to accept it. Convey the message it's openportal accepted. Then openportal submits to opencode, when it succeeds, it conveys that message. I don't want to see draft in prompt field only because openportal accepted the request but it's still trying to talk to opencode.

User reinforcement:

> When opencode down, and I refresh openportal I want too see all pending backlog openportal is trying to send in chat log. That is independent of waiting for response from opencode. MUST SEND CONTENT TO OP FRONTEND, WHATEVER THE SOURCE, ASAP.

Design notes:
- Three critical-path SDK call sites in /prompt + /messages now race against `setTimeout(3000)`:
  - `getSessionMeta()` in `prompt-archive.ts` — 3s timeout via Promise.race. On timeout, archive insert proceeds with `null` opencode-side metadata.
  - `detectStuckFromRestart()` — 2s outer timeout via Promise.race wrapping the inner detector. On timeout, returns `false` (no recovery action) so the /prompt critical path is never blocked. Inner moved to fire-and-forget AFTER `archivePrompt + 202` in `/prompt.ts` so the recovery-triggering toast is sacrificed but the user's prompt is accepted instantly.
  - `fetchAndCache()` in `messages.ts` — 3s Promise.race against `client.session.messages`. On timeout, falls through to `getStaleMessages` + virtuals. Satisfies "MUST SEND CONTENT TO OP FRONTEND, WHATEVER THE SOURCE, ASAP" — page refresh with opencode down still surfaces the user's pending backlog from the SQLite archive instead of spinning forever.
