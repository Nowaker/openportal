---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T06:01:12-05:00
legacy_number: 33
commits:
  attributed:
    - 67c75e8ffcb7
  on_main:
    - 67c75e8ffcb7
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Move-to-project modal: cropped content + font too large + needs vertical scroll on phone

User prompt:

> After current todo:
>
> Move "OpenCode session work"?
> Target: /home/nowaker/projekty/nowaker/opencode-tools
>
> Dry-run output:
> session set (57): ses_229d7083fffem6lkaEj69adZ7H, ses_228246169ffeykE2Yo9GmFi4GQ, ses_1e5a66a67ffeEYcKS1PH8JcRlg, ses_1e595fe93ffeux41QMDt9QeblY, [...truncated list of 57 sessions...]
>
>  Move to project modal has cropped content. The font for the output is too large. And it doesn't fit my phone. Vertical scroll needed if text too long.

Design notes:
- `ConfirmDialog` (`apps/web/src/components/ui/confirm-dialog.tsx`): widen `description` from `string` to `ReactNode` (backward-compatible — string is a subset). Add `max-h-[90vh]` on the modal container + lay out as fixed-header + scrollable-body + fixed-footer so the action buttons stay visible no matter how long the body grows.
- Move-pending dialog body now renders dry-run output as `<pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-all">` inside a bordered muted block. Removed the 800-char slice cap entirely — scrollable body handles arbitrary output length.
- Live-runner confirm dialog gets the same treatment for the offending session list (now a `<ul>` of session IDs) plus the underlying CLI error block.
- Existing string-passing ConfirmDialog consumers (servers route, settings tab) keep their `whitespace-pre-line` paragraph rendering unchanged.
