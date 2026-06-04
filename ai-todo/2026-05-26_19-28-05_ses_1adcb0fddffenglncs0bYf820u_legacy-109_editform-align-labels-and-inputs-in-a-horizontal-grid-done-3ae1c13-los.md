---
status: PENDING
session: ses_1adcb0fddffenglncs0bYf820u
queued_at: 2026-05-26T19:28:05-05:00
legacy_number: 109
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# EditForm: align labels and inputs in a horizontal grid (DONE - 3ae1c13) [loser-bump: originally #101 in mcp-polish branch]

User prompt (verbatim):

> also the editor shouldn't be:
>
> field name
> form2
>
> field name
> form2
>
> should be a nice aligned form more like
>
> filed name                form
> field nam2                form2
>
> nicely aligned and everything.

Design notes:
- Current EditForm in mcp-info-modal.tsx stacks each label above its input (Field wrapper renders label as a block + input on next line).
- Switch to a two-column grid: label on the LEFT (right-aligned, fixed width or content-sized), input on the RIGHT (flex-1).
- Use `grid grid-cols-[max-content_1fr] gap-x-3 gap-y-2` same as the PrettyView dl already uses, so the form mode visually mirrors the view mode.
- Multi-row controls (command argv editor, env KV editor) need to still occupy the full input column.
