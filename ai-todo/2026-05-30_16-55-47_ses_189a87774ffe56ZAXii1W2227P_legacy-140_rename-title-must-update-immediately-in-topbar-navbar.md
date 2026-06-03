---
status: DONE
commit: 7f8097a
session: ses_189a87774ffe56ZAXii1W2227P
queued_at: 2026-05-30T16:55:47-05:00
legacy_number: 140
---

# Rename title must update immediately in topbar + navbar

User prompt (verbatim):

> after i click <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" data-slot="icon" class="size-4"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"></path></svg> in title bar, modify title, submit, it doesn't immediately show me the new title there or in the navbar. takes time. must be immediate.

Design notes:

- Root cause hypothesis: title edit submit in `app-sidebar-nav.tsx` waits for PATCH response before calling `mutateSessions()`. The overlay is staged server-side immediately, but the client does not re-fetch `/sessions` until after the slow request returns.
- Fix approach: apply an immediate local SWR mutation for the target session (`_pendingTitle`) before awaiting the network response, so both topbar title and sidebar list render the new title on the same paint.
- Follow-up hardening: ensure pinned rows in `app-sidebar.tsx` also read `effectiveTitle(...)` instead of raw `session.title`, so every navbar surface honors `_pendingTitle` consistently.
