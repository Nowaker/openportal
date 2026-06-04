---
status: DONE
session: ses_17b265c4bffeObiJZJ6Z77ops5
queued_at: 2026-06-01T15:21:59-05:00
legacy_number: 155
commits:
  attributed:
    - 3fae9e3c2cc2
  on_main:
    - 3fae9e3c2cc2
  reverted: false
verdict: present
verdict_reason: "Commit 3fae9e3 on main: 'session-ui: link spawned subsessions from tool rows'. spawnedSessionId + spawnedSessionHref at apps/web/src/routes/_app/session/$id.tsx:1487,1538"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Tool call rows: link spawned subsession ids in task/subsession-management labels

User prompt (verbatim):

> i'd like these tool calls to have a link to session id spawned.
>
> instead of this:
>
> task explore- trace unknown stop source
> task explore- find session status sources
>
> have it like:
>
> task explore- [trace unknown stop source](url to session id)
> task explore- [find session status sources](url to session id)
>
> also screen this instance for other tools that are used for the purpose of spawning/managing subsessions, and these should have it too.
>
> ...i only hope that we're able to actually get the subsession id at that point to make those links happen?
>
> investigate. if doable, implement.

Design notes:

- Investigate `ToolCallItem` + `formatToolCall` path in `apps/web/src/routes/_app/session/$id.tsx` and confirm whether spawned `ses_*` IDs are available in `part.state.output` for `task` and other sub-session tools.
- If available, render the description segment as a clickable in-app session link (`/session/<id>?server=<activeServerId>`) in the compact tool row, matching the user's requested `task explore - [description](...)` behavior.
- Extend to other sub-session management tools (create/fork/fire/reply/continue style calls) when their outputs expose a canonical spawned `ses_*` field; keep non-spawn tools unchanged.
