---
status: DONE
commit: 93c176e
session: ses_199f15fddffe7G0y5uvGMM578L
queued_at: 2026-05-26T15:51:35-05:00
legacy_number: 75
---

# New-session composer drafts persist per directory + sidebar indicator

User prompt (verbatim):

> going to new session eg https://portal.desktop.ts.nowaker.net:8443/session/new?server=srv-2dy1srwz&directory=%2Fhome%2Fnowaker%2Fprojekty%2Fwebapps%2Fportal
> then going to settings
> then going back
> does not preserve my input field.
> new session drafts must be preserved too, per project/directory they are about to be created it.
> if a given project/directory has a new session draft, an indicator must show that on the project/directory level. and when i click + it must be restored.
> mechanism equally the same as for drafts for existing session. don't code duplicate, reuse.ping

Follow-up user prompt (verbatim):

> fix on a worktree. merge to master when done.

Design notes:
- Existing per-session composer drafts live in `localStorage["opencode-composer-draft:<sid>"]` with helpers `getDraftKey/readDraft/writeDraft` privately defined in `routes/_app/session/$id.tsx` (lines 3329-3424) and `sessionHasDraft` (publicly) in `lib/session-indicators.tsx`. The DRAFT_KEY_PREFIX constant is duplicated across both files - mild existing tech debt, this entry consolidates it.
- Plan: synthetic "session ID" of `new:<directory>` for the new-session composer. The full localStorage key becomes `opencode-composer-draft:new:<directory>` - reusing the existing readDraft/writeDraft/sessionHasDraft functions verbatim by passing the synthetic key. Zero new storage helpers needed.
- Step 1: move `getDraftKey/readDraft/writeDraft/DRAFT_MIN_BYTES` from `$id.tsx` into `lib/session-indicators.tsx` (single source of truth alongside the existing `sessionHasDraft`); add `newSessionDraftKey(directory)` returning `"new:" + directory`. `$id.tsx` switches to imports - no behavior change.
- Step 2: `routes/_app/session/new.tsx` adds a `useEffect([draftKey])` that loads on mount/directory-change and persists on cleanup. Save semantics mirror $id.tsx: desktop = on every keystroke (immediate); mobile = 5s debounce; `DRAFT_MIN_BYTES=10` clobber-guard for cross-tab safety. Submit success path calls `writeDraft(draftKey, "")` to clear. Also marks `hasUserEditedRef.current = true` after a restored draft so the composedAutoPrompt effect doesn't override the user's content.
- Step 3: sidebar indicators - `components/app-sidebar.tsx` ProjectGroup aggDraft (line ~257) and `aggregateNodeStatus` (line ~1066) also check `sessionHasDraft(newSessionDraftKey(directory))`. New-session draft indicator must show even when the project is EXPANDED (no session row represents it, so cascading-suppression on expand doesn't apply). `components/sidebar-rail-layout.tsx` aggregateBinSignals (line ~208) gets the same check for `bin.dir`.
- Skip BroadcastChannel cross-tab sync for new-session drafts in v1 - the controlled-textarea pattern in new.tsx fights the existing `smartPostSubmitClear` mutation path. v1 just clears via setText("") after submit in the same tab. Other-tab clearance is a v2 if it becomes a friction point.
- Worktree: branched off `main-nowaker` as `new-session-drafts` at `~/projekty/webapps/portal-new-session-drafts`. After verification, merge to `main-nowaker` and deploy via `scripts/deploy.sh`.

---
