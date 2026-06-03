---
status: DONE
commit: 4e543bd
session: ses_unknown
queued_at: 2024-01-01T00:00:57-05:00
legacy_number: 57
---

# Stuck-detector multi-part dispatch: SSE independence + PUT /config audit + label rename + presets + SSE latency sidebar metric (ITEMs 1-5 from msg_e575eb73f)

User prompt (5-part dispatch summary):

> Multi-part stuck-detector portal-side work. ITEM 1 (ses_1aa08841d verification post-restart, no portal code). ITEM 2 (SSE-latency sidebar metric). ITEM 3 (settings UI labels + 'Set all to automatic' + 'Set all to passive' presets). ITEM 4 (verify stuck-detector SSE subscription stays alive when opencode unreachable). ITEM 5 (PUT /config wrapper sends full body + surfaces validation errors + refresh after save).

Design notes:
- ITEM 4: VERIFIED no code needed. stuck-detector-client.ts + stuck-detector-journal-client.ts both subscribe to 127.0.0.1:4098 directly with no gating on opencode reachability. Independent of opencode HTTP availability.
- ITEM 5: VERIFIED no code needed. updateStuckDetectorConfig already sends complete config object, server wrapper passes through plugin's validation errors to UI (toast.error), and globalMutate(KEY, body) refreshes SWR cache with canonicalized response.
- ITEM 3 (4e543bd): renamed CauseAction labels for self-documenting clarity: "Disable cause entirely" / "Just log (passive observer)" / "Automatic recovery (resumer)" / "Auto-bump (retry-overdue only)". New AUTOMATIC_PRESET + PASSIVE_PRESET constants. New 'Set all to automatic' + 'Set all to passive (log only)' buttons fire one atomic PUT carrying every cause's new action.
- ITEM 2 (b6571bb): per-server lastEventMs Map in indicator-broadcaster, stamped on every SSE frame. Exposed via getLastEventMs(serverId) + getAllLastEventMs(). New sseLatency field on /api/system-stats: { perServer: {<sid>: {lastEventMs, lagMs}}, worstLagMs }. Sidebar 'sse' row with color thresholds (<1s neutral, 1-30s warning, >30s danger). Tooltip carries exact band.
- ITEM 1: AWAITS user's next opencode-serve restart. Plugin-side already shipped scanDbStuckCauses pass in 65fbbf2; portal verification step happens once the new plugin code is live.
