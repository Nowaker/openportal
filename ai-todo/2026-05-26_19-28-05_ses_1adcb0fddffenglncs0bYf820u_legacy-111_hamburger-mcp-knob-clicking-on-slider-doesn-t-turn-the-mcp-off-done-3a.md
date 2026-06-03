---
status: PENDING
commit: 
session: ses_1adcb0fddffenglncs0bYf820u
queued_at: 2026-05-26T19:28:05-05:00
legacy_number: 111
---

# Hamburger MCP knob: clicking ON slider doesn't turn the MCP off (DONE - 3ae1c13) [loser-bump: originally #103 in mcp-polish branch]

User prompt (verbatim):

> other mcps, e.g. the ones that are on (green), clicking on the on/off slider in hamburger doesn't turn them off.

Design notes:
- McpRow's onClick fires `void onToggle(name, isOn ? "disconnect" : "connect")`. The toggle hook calls POST /api/opencode/<port>/mcp with `{name, action:"disconnect"}` which proxies to `client.mcp.disconnect({ name })`.
- Smoke test: POST `{name:"chrome-devtools-mcp",action:"disconnect"}` returned the post-disconnect status snapshot still showing the MCP as "connected". So opencode's runtime disconnect is failing silently or immediately reconnecting.
- Likely root cause: opencode's runtime mcp.disconnect toggles in-memory state, but the MCP is configured with `"enabled":true` in opencode.json so it immediately re-attaches on next event-loop tick.
- Fix path: route the slider OFF action through the openportal MCP-config PUT endpoint (set enabled:false) instead of opencode's runtime toggle. Slider ON sets enabled:true. Persistent through restart. Triggers PENDING RESTART badge so the user knows to restart opencode for the disable to take effect at the connection layer.
- Alternative: file a bug with opencode for the silent-fail disconnect. Out of scope for this iteration.
