---
status: DONE
session: ses_1895559c5ffeQMyfWWNKatvrrS
queued_at: 2026-05-29T22:46:48-05:00
legacy_number: 132
commits:
  attributed:
    - 8b94dc36fa89
  on_main:
    - 8b94dc36fa89
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Path linkization parity in chat messages

User prompt (verbatim):

> ok looking at my above submission, this is how linkization happened:
>
> - /home/nowaker/projekty/webapps/portal/apps/web/src/routes/_app/session/$id.tsx <- not a link
> - ~/projekty/webapps/portal/apps/web/src/routes/_app/session/$id.tsx <- not a link
> - ./AI_TODO.md <- LINK
> - AI_TODO.md <- LINK
> - `/home/nowaker/projekty/webapps/portal/apps/web/src/routes/_app/session/$id.tsx` <- not a link
> - `~/projekty/webapps/portal/apps/web/src/routes/_app/session/$id.tsx` <- not a link
> - `./AI_TODO.md` <- not a link
> - `AI_TODO.md` <- not a link
>
>
> i don't need any analysis - implement links where they are missing
>
> Please address this message and continue with your tasks.

Design notes:
- Reuse existing file-path linkization path (the `FileLinks` renderer used in message content) instead of introducing a second independent parser.
- Make absolute paths (`/home/...`) and home-short paths (`~/...`) clickable consistently in plain prose and inline-code surfaces where they currently fail.
- Preserve current behavior for `./AI_TODO.md` and `AI_TODO.md` (already linkized in prose); add missing coverage in code-formatted text.
- Keep fenced code blocks readable (fix single-letter regression) while adding linkization only where intended.
