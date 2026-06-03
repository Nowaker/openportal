---
status: DONE
commit: 2bda920
session: ses_229d7083fffem6lkaEj69adZ7H
queued_at: 2026-05-22T16:14:28-05:00
legacy_number: 9
---

# "Recently mentioned files" — implementation behind placeholder dropdown

User prompt (synthesized):

> introduce: recently opened files [...], recently mentioned files (by user or ai in prompt) - placeholder, dropdown opens at says not implemented yet; max number configurable in settings, default 20; minimum half of that number is stored forever, and guaranteed to show; e.g. current project may have old mentions from a long time ago, and newest mentions are other projects, but this project is always guaranteed its 10 mentions, even if distant; the other 10 or more are most recent mentions outside of project; totaling 20). backend sse subscription to all updates should keep a list of recently mentioned files up to date and TTLed (with limits). the infra for it is in place (e.g. last opened files, and bookmarked files)

Status: PARTIALLY DONE — `177e865` created the dropdowns with a "not implemented yet" placeholder for the mentions list. The actual implementation (SSE subscription → file-path extraction → per-project quota + TTL) is PENDING.
