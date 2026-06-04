---
status: DONE
session: ses_17bdd4bacffeMBK2mBDNa7fN3g
queued_at: 2026-06-01T12:02:12-05:00
legacy_number: 153
commits:
  attributed:
    - 9265f874580d
  on_main:
    - 9265f874580d
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# New-session sending banner: drop max-h-32 overflow-y-auto from prompt preview

User prompt (verbatim):

> H: Prompt accepted. Opening the session...
>
> Hang tight - OpenCode is processing this server-side. The chat view will open as soon as the session is ready.
>
> this "window" sort of has vertical scrollbar... for what? just occupy all the space you need. vertical scrollbar needed only when no more space in the chat log container.

Design notes:

- The "Prompt accepted" sending banner in `apps/web/src/routes/_app/session/new.tsx` rendered the user's submitted prompt inside `<div className="... max-h-32 overflow-y-auto whitespace-pre-wrap break-words">`. Long prompts produced a tiny vertical scrollbar inside the 8rem-tall box even when the page had plenty of vertical room.
- The outer chat-log container at line 797 already carries `flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 flex flex-col items-center gap-4`. That IS the right scroll surface - the preview should expand to its natural height and let the outer container handle overflow.
- Fix: drop `max-h-32 overflow-y-auto` from the preview div. Other classes (`rounded border border-border bg-bg/60 p-2 text-xs text-muted-fg whitespace-pre-wrap break-words`) preserved.
- Worktree: `~/projekty/webapps/portal-loading-banner-noscroll` on branch `fix/loading-banner-noscroll`.
