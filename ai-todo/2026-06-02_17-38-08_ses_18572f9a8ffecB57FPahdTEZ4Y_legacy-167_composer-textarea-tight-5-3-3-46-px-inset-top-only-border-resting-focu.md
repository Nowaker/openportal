---
status: DONE
session: ses_18572f9a8ffecB57FPahdTEZ4Y
queued_at: 2026-06-02T17:38:08-05:00
legacy_number: 167
commits:
  attributed:
    - c6211359728b
    - 4a69796b039f
  on_main:
    - c6211359728b
    - 4a69796b039f
  reverted: false
verdict: present
verdict_reason: "Commits c621135 + 4a69796 on main. apps/web/src/routes/_app/session/$id.tsx:6087 and new.tsx:1235 carry inline style={{paddingLeft:5,paddingTop:3,paddingBottom:3,paddingRight:46}} + 'rounded-none border-x-0 border-b-0 focus:border-x focus:border-b focus:ring-0'"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Composer textarea: tight 5/3/3/46 px inset, top-only border resting / focus brings other three sides at 1px, square corners, overlay anchored bottom-1 right-1

User prompt (verbatim):

> Are you fucking stupid? the text still goes behind the submit and mic buttons. what the fuck.
> i'm done with this nonsense.
>
> set this shit as follows:
>
> textarea padding left 5px, top bottom 3px, padding right 46px. border right left bottom none. corner shape square.
> when textarea in focus, border right left bottom 1px.
>
> div container with mic & submit: bottom-1 right-1
>
> <div class="px-1 pt-0.5 relative flex-1 min-h-0 flex flex-col"> right before form - remove pb-0.5 px-1
> do it

Design notes:

- Textarea className across both composer call sites becomes `rounded-none border-x-0 border-b-0 focus:border-x focus:border-b focus:ring-0 pl-[5px] pt-[3px] pb-[3px] pr-[46px]` plus the existing `resize-none overflow-y-auto text-sm min-h-...` floor. Base `border border-input rounded-lg` is overridden so the rest state shows only the top hairline; on focus the three other sides return at 1px via `focus:border-x focus:border-b`, ring halo killed via `focus:ring-0`.
- Floating mic + submit overlay moved from `bottom-1.5 right-1.5` to `bottom-1 right-1` (4px inset from the textarea borders) so the right padding math (44px submit column + 2px gap = 46px reserved) matches exactly.
- Container right before the form drops `px-1` and `pb-0.5` so the composer fills its slot tighter. `$id.tsx` becomes `pt-0.5 relative flex-1 min-h-0 flex flex-col`; `new.tsx` becomes `pt-0.5 flex-1 min-h-0 flex flex-col`.
- AGENTS.md "Composer layout (mobile-safe)" section rewritten to document the new contract (Textarea padding + border + focus rules) and the bottom-1 right-1 overlay anchor; the old `pr-24` and `px-1.5 py-1.5` math is gone.
- Source comment in `apps/web/src/routes/_app/session/$id.tsx` next to the wrapper updated to spell out the same contract inline so a future reader doesn't have to bounce to AGENTS.md.
- Files: `AGENTS.md`, `apps/web/src/routes/_app/session/$id.tsx`, `apps/web/src/routes/_app/session/new.tsx`.
