---
status: DONE
session: ses_19acecfc9ffeLwGYd7kS56G7wf
queued_at: 2026-05-26T14:53:04-05:00
legacy_number: 68
commits:
  attributed:
    - 9cd994debfc8
  on_main:
    - 9cd994debfc8
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Prompt-submit transient disappear+reappear bug; distinct badges per phase

User prompt (verbatim):

> enqueue before ^K work: there's a brief moment when prompt is submitted -> sent to opencode -> SOMETIMES: disappears from chat log -> reappears again as queued. OR maybe, i can't recall prompt is submitted -> sent to opencode -> queued -> SOMETIMES: disappears from chat log -> reappears again. i can't tell which one, but one of them for sure. MUST be aware that opencode has latency and sometimes a list of messages comes back and it's out of date with our submission. so openportal must ALWAYS be aware of that, and keep anything that opencode confirmed as received, but not yet coming back to us with a certain badge. do not reuse "queued". each situation must be distinct from each other. tooltip on badge of each situation should explain what each situation means.

Design notes:
- Root cause hypothesis: messages from opencode come back BEFORE the user's submission has been flushed to opencode's DB. The virtual prompt entry (from prompt-archive) renders, then a fresh `/messages` poll returns an older snapshot without it, then the next poll catches up. SWR `keepPreviousData` doesn't help because the merge logic replaces the array; the virtual-prompt-merge in `messages.ts` (`loadFullMessages`) needs an additional gate: "if a virtual prompt has a confirmed opencode messageID we already saw in EARLIER polls, keep it on screen even if THIS poll's snapshot is missing it".
- Define explicit per-phase badges. NO reuse of "QUEUED" beyond the original meaning. Proposed taxonomy (each MUST have a distinct visual style + tooltip):
  - **DRAFT** (gray): localStorage-captured only; not yet POSTed to openportal. Tooltip: "Captured in your browser. Not yet sent to OpenPortal."
  - **PORTAL-ACK** (light blue): openportal accepted, archive row created, not yet POSTed to opencode. Tooltip: "OpenPortal accepted your prompt. About to send to OpenCode."
  - **SENT-TO-OPENCODE** (sky-blue, no animation): pending-prompt-worker received 2xx from opencode's `/prompt_async`. Tooltip: "OpenCode accepted the prompt. Waiting to start the assistant turn."
  - **QUEUED** (existing muted-gray pulse): opencode has it queued behind another running turn (mode === "queued" or pendingPromptIds detected on the indicator). Tooltip: "OpenCode is busy with an earlier turn. Your prompt is queued."
  - **RECONCILING** (yellow): we have the prompt locally + sent confirmation but a recent `/messages` snapshot is missing it. Tooltip: "OpenCode confirmed the submission but its latest snapshot hasn't caught up yet. Holding the message visible to avoid blinking it away."
- Backend change: track the highest "last seen" opencode messageID per session in memory; when a fresh `/messages` response is MISSING a virtual prompt's opencode messageID that was in an earlier response within N seconds (say 30s), keep the virtual visible with phase=RECONCILING instead of dropping it.
- Frontend change: virtual-message renderer picks badge from `_pending.phase` map; styles + tooltips defined in one constant table so tooltip text never drifts.
