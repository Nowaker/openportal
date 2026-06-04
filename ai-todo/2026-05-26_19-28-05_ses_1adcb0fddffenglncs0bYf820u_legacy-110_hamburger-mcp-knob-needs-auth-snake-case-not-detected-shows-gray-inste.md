---
status: PENDING
session: ses_1adcb0fddffenglncs0bYf820u
queued_at: 2026-05-26T19:28:05-05:00
legacy_number: 110
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Hamburger MCP knob: needs_auth (snake_case) not detected, shows gray instead of orange (DONE - 3ae1c13) [loser-bump: originally #102 in mcp-polish branch]

User prompt (verbatim):

> when i open the hamrburger i see calendar mcp as off, in gray, and toggle isn't operable (can't click it to start auth; it's not orange/yellow)

Design notes:
- opencode 1.15.6 returns `"status":"needs_auth"` (snake_case) via /mcp endpoint. Confirmed via `curl http://100.105.229.19:4096/mcp` showing `"google-calendar-mcp":{"status":"needs_auth"}`.
- openportal's McpStatusKind type + McpRow's matching expect `"needsAuth"` (camelCase). When kind doesn't match any known enum value, McpRow falls through to default styling (gray slider, no needsAuth recognition).
- Fix: normalize on the SERVER proxy in apps/web/src/server/opencode/[port]/mcp.ts - map snake_case statuses (needs_auth, needs_client_registration) to camelCase before returning to clients. Single point of fix; all consumers benefit.
- Also affects #108 (status label) since statusLabel() also keys off the camelCase enum.
