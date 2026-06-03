---
status: DONE
commit: 2e8f5cb
session: ses_19873d970ffeUuFp3U2eNgwzrG
queued_at: 2026-05-26T22:48:18-05:00
legacy_number: 83
---

# New-session topbar: show "{projectLabel}: New session" instead of "opencode"

User prompt (verbatim):

> In new session view https://portal.desktop.ts.nowaker.net:8443/session/new?server=srv-2dy1srwz&directory=%2Fhome%2Fnowaker%2Fprojekty%2Fwebapps%2Fportal
>
> The project name is missing. Instead it just says "opencode" in title line. Actual sessions have project name then session name. Must reuse the same concept and ideally code too. Here, show project name: New session or alike.
>
> Create on a work tree, merge to main branch after.

Design notes:

- The topbar text in `apps/web/src/components/app-sidebar-nav.tsx` falls through to `instance?.name ?? "OpenPortal"` for any route that's neither `/_app/session/$id` (existing session) nor a registered `pageTitle` consumer (settings/docs/diff). For the new-session route there's no `sessionMatch` and no `pageTitle`, so it renders "opencode" - the user's instance name.
- Existing sessions render `{projectLabel}: {sessionTitle}` via a code path keyed on `currentSession?.directory` (where `projectLabel = projectLabelFromDirectory(directory)` takes the basename of the path).
- Fix: add a second `useMatch({ from: "/_app/session/new" })` alongside the existing one. When that matches, read `directory` from URL search params (fallback to `useVirtualSessionStore`), synthesize `sessionTitle = "New session"` and `directoryForLabel = newSessionDirectory`. The existing JSX render path picks both up automatically because we swapped `currentSession?.directory` for `directoryForLabel` in the two conditional checks.
- Subagent / parent / status-badge / rename / compact / export buttons all gate on `sessionId` (the existing-session match's `params.id`), so they stay hidden on the new-session route. Same with the hamburger session-info modal trigger - it requires `sessionId`.
- Side effect: browser tab title flips from "OpenPortal" to "OP: New session" on the new-session route, which is consistent with the in-app topbar.
- Worktree: `~/projekty/webapps/portal-new-session-titlebar` (branch `new-session-titlebar`). Merged into `main-nowaker` after dev sandbox verification.

---
