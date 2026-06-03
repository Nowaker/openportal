---
status: DONE
commit: 526410b
session: ses_18441dfc8ffeuahaGXM3HIWZma
queued_at: 2026-05-30T20:55:20-05:00
legacy_number: 143
---

# Composer draft persisted after /btw and empty /agent /model submits

User prompt (verbatim):

> draft didn't disappear after using a slash command. my hypothesis is the code expected to see the full input that included `/slash-command the input` on the output but only `the input` was found? don't know, just a guess.
>
> remember the principle - draft/prompt field value to disappear once openportal backend got the query and saved it in 'prompt history'. but not earlier, must get a confirmation it's saved. NOTE: must NOT wait for opencode! openportal backend is all.

Design notes:

- Root cause: both early-return branches in `handleSubmit` at `apps/web/src/routes/_app/session/$id.tsx` — the `/btw` branch (lines ~4806-4838) and the empty-body `/agent`/`/model` override branch (lines ~4857-4866) — short-circuited BEFORE reaching the post-success cleanup block. They visually cleared the textarea via `textareaRef.current.value = ""` only. Direct DOM assignment does NOT fire React's onChange handler, so the localStorage draft at `opencode-composer-draft:<sid>` persisted. On next mount, composer-toggle, session-switch, or page reload the on-mount restore effect re-populated the textarea with the stale draft.

- Symptom matches user hypothesis: nothing actually broke at smartPostSubmitClear (the substring comparator). The substring path simply never ran on these branches.

- Fix: both branches now explicitly call `writeDraft(sessionId, "")` + cancel any pending mobile-debounced save timer + post the `draft-submitted` BroadcastChannel message to peer tabs, mirroring exactly what the normal-success path already does. Honors the project draft contract: cleared on openportal-backend confirmation (2xx from `/api/btw` for /btw; immediate ack-on-return for /agent /model overrides which have no remote round-trip), NEVER waits for opencode.

- Worktree: `~/projekty/webapps/portal-slash-draft` on branch `fix/slash-draft-clearing`. Built + smoke-tested at `http://100.105.229.19:5201/` (bundle hash `index-CY3MERTl.js`, console clean). Fast-forward merge into `main-nowaker`. Concurrent uncommitted work on `main-nowaker` from another agent (AGENTS.md / slash-command-popover.tsx / $id.tsx / new.tsx) preserved via `git stash` + `git stash pop` around the merge.

- Cross-tab BroadcastChannel safety: receivers run through `smartPostSubmitClear` which substring-checks; on `/btw what is X?` the submitted content matches their textarea exactly when the same draft is shared, and otherwise no-ops.

Files:
- `apps/web/src/routes/_app/session/$id.tsx`
