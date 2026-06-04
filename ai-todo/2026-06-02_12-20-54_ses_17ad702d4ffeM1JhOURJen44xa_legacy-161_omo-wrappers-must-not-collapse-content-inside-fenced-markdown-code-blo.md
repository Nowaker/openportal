---
status: DONE
session: ses_17ad702d4ffeM1JhOURJen44xa
queued_at: 2026-06-02T12:20:54-05:00
legacy_number: 161
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# OMO wrappers must not collapse content inside fenced markdown code blocks

User prompt (verbatim):

> do not show a wrapper if it's inside multiline code block, like this:
>
> ```
> <system-reminder>
> [BACKGROUND TASK RESULT READY]
> some content here
> </system-reminder>
>
> ```
>
> reason: https://portal.desktop.ts.nowaker.net/session/ses_17ad702d4ffeM1JhOURJen44xa?server=srv-2dy1srwz#msg-msg_e854d0673001pH8LE23fus1jad
>
> when i cite some code, it shouldn't be omo-wrapped.

Design notes:

- Add `collectFencedCodeBlockRanges(text)` to `apps/web/src/lib/omo-injection.ts` that scans for paired triple-backtick (`` ``` ``) or triple-tilde (`~~~`) fences via a single multiline regex, pairing opens to closes and treating an unclosed open as fenced through end-of-text.
- In `parseOmoBlocks`, filter the `collectAllOmoRanges` output to drop any range whose start+end falls entirely inside a code-block range. This handles every detector at once (system-reminder, ultrawork-mode, auto-slash-command, command-instruction, initiator-terminated, orphan tail, stripped marker) without touching their individual scanners.
- Tests cover: cited reminder inside fenced block stays as user prose; real reminder outside the fence still collapses; orphan-like tail inside a fence is also ignored.
