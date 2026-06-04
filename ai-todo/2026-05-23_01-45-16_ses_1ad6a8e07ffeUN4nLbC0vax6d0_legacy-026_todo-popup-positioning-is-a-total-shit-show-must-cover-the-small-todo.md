---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T01:45:16-05:00
legacy_number: 26
commits:
  attributed:
    - dac4662bb97e
    - ebbf6dcc7a7f
    - 1184ed537211
  on_main:
    - dac4662bb97e
    - ebbf6dcc7a7f
    - 1184ed537211
  reverted: false
verdict: present
verdict_reason: "Commits dac4662 + ebbf6dc + 7051e12 + 1184ed5 on main (todo-strip popup positioning + overflow fixes). Backfill commit 064a175 marked #26+#27 DONE"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Todo popup positioning is a "total shit show" — must cover the small todo + verify visually

User prompt:

> todo open and cover the small todo component. positioning not the same.
> it's a total shit show. must validate visually via mcp / driving chromium browser via debug protocol directly (not google-chrome please, use chromium).
> run that part in subagent to save tokens with image work.

Design notes:
- Related to #21 (todo strip popup positioning) but specifically calling out that the current implementation does NOT cover the small minified todo component when opened. The popup positioning is observably wrong.
- Validation MUST be visual — drive Chromium directly via DevTools / playwright MCP. NOT google-chrome (the binary; use chromium).
- The visual-validation pass should run in a subagent (image work is token-heavy; isolating it saves the main session's context).
- Cross-reference with #21 for the desktop / mobile width + position rules. This entry is the "fix is wrong, prove it visually" complement.
