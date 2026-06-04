---
status: DONE
session: ses_18cd90b4effeWgohIGbJD9tVkE
queued_at: 2026-05-30T21:58:16-05:00
legacy_number: 147
commits:
  attributed:
    - b6e54eb60174
  on_main:
    - b6e54eb60174
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Templates Round 6: per-row preview/edit chevron + ephemeral modifications + " + modifications" suffix

(Originally enqueued as #144 on feat/templates-redesign-round-4 before main shipped its own #144 - configurable polling interval - and the loser bumps to N+1 per AI_TODO.md collision rule.)

User prompt (verbatim):

> also:
> new session view, on the very right of each template, should be ^ (but pointing down) to expand the template for the purpose of previewing it.
> it should be an editable field. if modified by the user, it's NOT saved back to the system. it's a one time change for this session only.
>
> if that happens:
>
> ```
> # /template "template title 1" + modifications:
>
> modified content here
> ```
>
> and
>
> ```
> [ Template: template title 1 + modifications [icon to expand here] ]
> ```

Design notes:

- New-session picker row gains a `ChevronDownIcon` button on the right edge. Click expands an inline `<Textarea>` pre-filled with the template's body. Edits stream into a component-local `edits: Record<string, string>` map keyed by template id.
- Edits are EPHEMERAL: not written to `useToolsStore`, not written to disk, not persisted across reloads. Lost when the user navigates away or refreshes the page. Matches user's "one time change for this session only" spec verbatim.
- Header tracking: `tool.name` + `+ modifications` suffix appears in the picker row when the edit diverges from the original prompt. A "Reset to original" link clears the edit.
- `PromptTemplateBlock` interface gains optional `modified?: boolean`. `buildPromptWithTemplates` emits `# /template "Title" + modifications:` when set; `parsePromptWithTemplates` populates the field from the captured suffix group.
- `TemplateBlockView` (the collapse pill in chat log + prompt history) displays the suffix when `modified=true`. Same accent-coloured styling as the picker row badge for visual consistency.
- See `ai-analysis-requests/TEMPLATES_REDESIGN.md` § "Round 6 (2026-05-30)" for the locked design + anti-reversion notes.

Plan order (single commit):

1. `prompt-template-format.ts` - field + builder + parser regex + tests
2. `template-block-view.tsx` - suffix display
3. `new.tsx` picker row - chevron + textarea + edits state + submit-handler wiring

Phase 1 (UnifiedToolList + FsTemplateRow + NewFsTemplateForm bug fix on tools-settings.tsx) is INDEPENDENT - the previous Phase 1 delegate agent (bg_4314b99a) died at compaction without committing. Will be done inline by the orchestrator after this Round 6 commit.
