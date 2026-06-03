---
status: PENDING
commit: 
session: ses_1adcb0fddffenglncs0bYf820u
queued_at: 2026-05-26T19:28:05-05:00
legacy_number: 108
---

# MCP status label: "needs_auth" should render as human-readable "Needs auth" (DONE - 3ae1c13) [loser-bump: originally #100 in mcp-polish branch; #100-103 were claimed by parallel-agent work and a first renumber attempt collided with #104-105 (opencode 500 analysis + bisect) - landed at #108]

User prompt (verbatim):

> Status needs_auth
> UI should say it more nicely

Design notes:
- The MCP info modal currently shows the raw enum value `needs_auth` in the Status row. Should render a friendly label like "Needs auth".
- statusLabel() in mcp-info-modal.tsx already has a case for `needsAuth` returning "Needs auth"; the snake_case variant fails to match and falls through to the default which prints the raw string.
- Fix lands together with #110 (enum normalization) - one canonical case handles both.
