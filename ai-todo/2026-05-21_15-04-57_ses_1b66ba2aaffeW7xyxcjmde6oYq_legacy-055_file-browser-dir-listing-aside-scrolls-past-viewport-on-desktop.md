---
status: DONE
commit: 2bbc71a
session: ses_1b66ba2aaffeW7xyxcjmde6oYq
queued_at: 2026-05-21T15:04:57-05:00
legacy_number: 55
---

# File browser dir listing aside scrolls past viewport on desktop

User prompt:

> file browser: I only see directories up to letter j, scroll past it...

Design notes:
- Root cause: aside had max-h-[50vh] for mobile + md:max-h-none for desktop. On desktop the cap was removed but no fallback height was set, so the aside took its CONTENT's natural height (= all entries stacked). Its own overflow-auto never triggered. Parent's overflow-hidden clipped the bottom of the aside.
- Fix: add md:h-full so aside takes parent's full height (limited by parent's overflow-hidden), then its overflow-y-auto kicks in when content exceeds.
