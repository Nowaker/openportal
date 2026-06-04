---
status: PENDING
session: ses_1896b745cffekFUlQoLUR8YJQd
queued_at: 2026-05-29T21:52:44-05:00
legacy_number: 131
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Clean Session UI: expose drop-after msg id and conditional preserve-user toggle

User prompt (verbatim):

> also expose --drop-after=message id, with message id field to paste msgid to.
> and if filled, allow --drop-after-preserve=user to be checked.

Design notes:

- Extend hamburger -> Clean session dialog with:
  - text input for `drop-after` message id
  - checkbox for `drop-after-preserve=user`
- Preserve-user checkbox must only be enabled/visible when drop-after field is non-empty.
- Wire fields through `/api/session-ops/clean` request body to `long-op-runner` and map to clean-session.ts args:
  - `--drop-after <msgid>`
  - `--drop-after-preserve=user` when checked.
- Keep existing progress stream and fork navigation behavior unchanged.

User prompt (verbatim):

> Create a git worktree. Develop and test there (when possible). Merge to the primary branch when done. Deploy the application and make sure it works. Push afterwards.
>
> Remember to obey project's AGENTS.md and always append to AI_TODO.md.
>
> https://portal.desktop.ts.nowaker.net:8443/session/ses_193b20fadffezxhfH0Vj3bp4Rk?server=srv-2dy1srwz#msg-msg_f6b2b635236284d719e581a7849a31de <- this message has a clickable session id
>
> https://portal.desktop.ts.nowaker.net:8443/session/ses_193b20fadffezxhfH0Vj3bp4Rk?server=srv-2dy1srwz#msg-msg_e6f94aab9001jTiGeo6A3TeXZ0 <- this one doesn't
>
> all mentions of session ids must be linkized.
>
> Please address this message and continue with your tasks.

Design notes:
- Reproduce in the message renderer and identify why one message linkizes `ses_...` and another does not.
- Implement a single normalization/linkization path so all `ses_<id>` mentions become clickable in prose and other rendered text surfaces.
- Verify with manual browser QA using the two provided message permalinks.
- Ship via worktree flow: branch in new worktree, merge to `main-nowaker`, deploy with `scripts/deploy.sh`, push to `origin` and `github`.

User prompt (verbatim):

> portal has hamburger -> clean session. only has aggressive mode as checkbox.
>
> let's expose the following:
>
> - aggressive   (when checkboxed on, checkboxes on all items that aggressive activates - check in source; along the way, improve --help for that tool too, aggressive and minimal should define each switch they pull in)
>   - item1
>   - item2
>   - item3
> - item4 - not enabled by aggressive, so needs to be checkboxed manually by my choice (e.g. prune loop)
> - item5 - like above, etc.
>
> session disposition: dropdown
>
>
> portal must either pass   --progress-file and watch it for changes and present them on screen, or use another mechanism to watch for progress. must not just click and who knows what's happening.
> if session disposition results in a new session, view must switch to that session when cleanup done.
>
> Please address this message and continue with your tasks.

Design notes:

- Expand Clean Session modal from one aggressive checkbox into explicit flag controls that map 1:1 to clean-session.ts switches.
- Add mode semantics section: minimal/aggressive definitions in tool help and UI auto-selection behavior (checking Aggressive toggles the exact implied flags on).
- Add non-mode flags as independent checkboxes (example: prune-loop) so user can opt in manually.
- Add session disposition dropdown mirroring `--old-session-disposition` choices.
- Add progress streaming via `--progress-file` (or equivalent) and display live phases/status in modal while running.
- On completion, if disposition yields a new session id, auto-navigate to that session route.
- Implement on a dedicated git worktree, verify in browser, deploy with scripts/deploy.sh, then push.
