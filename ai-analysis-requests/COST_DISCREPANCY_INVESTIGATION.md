# Cost discrepancy investigation

Originally surfaced as "openportal $2620 vs opencode UI shows different".
This doc captures the openportal cost-summing logic + the new endpoint
that lets the user reconcile the two numbers without DevTools.

## How openportal computes total cost

`apps/web/src/components/session-info-modal.tsx:240-260` walks every
message in the session, and for each assistant message it adds
`info.cost` (a number opencode emits per assistant turn) to a running
total. Three properties of this sum:

1. **`cost` is per-turn**, not per-token. opencode does the input-cost
   * input-token-count + output-cost * output-token-count math inside
   the runtime and stamps the resulting USD figure on the assistant
   message's `info.cost`. openportal does not re-derive from tokens.
2. **`cost` accumulates across the whole session**. Token totals come
   from the LAST assistant message only (opencode reports running
   totals, not per-turn deltas, for tokens). Cost is the opposite:
   per-turn cost stamped on each message, summed by us.
3. **Messages without `info.cost` are skipped**. opencode does not
   always emit cost: pre-compaction or pre-billing builds, manual
   resubmits via the resumer, synthetic recovery messages from
   stuck-compaction-fixer, and tool-only assistant turns with no
   billed tokens may all have `cost === undefined`. The Session Info
   modal renders "—" for the total when ALL messages lack cost, or a
   running total derived only from the ones that DO have it.

## How opencode's TUI / web UI computes total cost

Different code path. opencode's TUI reads the session's `tokens.cost`
aggregate field directly (opencode bookkeeps the sum internally on
write). The web UI does the same lookup.

So the two paths can diverge in three documented ways:

### 1. Recovered / forked session inclusion

When stuck-compaction-fixer forks a stuck session into a fresh one,
the FORK's assistant messages may or may not carry cost on the
synthetic recovery turns. The original session's cost stays at the
fork point. openportal aggregates ALL assistant messages in the
session it's looking at; if the user is on the FORK, openportal
sees the costs of the synthetic recovery messages AND the post-fork
assistant turns. opencode's `tokens.cost` aggregate may treat
recovery turns as zero-cost or skip them.

### 2. Synthetic / non-billed turns

stuck-detector, stuck-compaction-fixer, the OMO injection layer can
all produce assistant-shaped messages that don't go through a real
LLM call. opencode's accountant should set cost=0 on those; if the
older builds set cost=undefined and openportal's code path includes
them differently, that's a divergence by ~0 per turn but accumulates.

### 3. Model-mid-session swap

When the user switches model mid-session (the Model picker), the
per-turn cost stamps reflect the model at the time of THAT turn. If
opencode bookkeeps cost separately per-model and openportal sums
across all turns regardless of model, the sums match. If either side
filters by "current model only", they diverge.

## How to reconcile a specific session

New endpoint: `GET /api/opencode/<port>/session/<id>/cost-breakdown`

Returns:
```
{
  sessionID,
  totalCost,            // openportal's running sum
  messagesWithCost,     // how many assistant turns had info.cost
  assistantCount,       // total assistant turns
  missingCount,         // assistantCount - messagesWithCost
  lastTokens: { input, output, reasoning },
  perModel: {
    "anthropic/claude-opus-4-7": { cost, messages, lastInput, lastOutput },
    "anthropic/claude-sonnet-4-6": { cost, messages, lastInput, lastOutput },
    ...
  }
}
```

User reconciliation workflow:

1. Pick the specific session ID showing the discrepancy.
2. `curl http://100.105.229.19:5000/api/opencode/<port>/session/<id>/cost-breakdown | jq`.
3. Compare `totalCost` to what the Session Info modal shows. Should
   match - both call the same per-turn-sum logic.
4. Compare `totalCost` to what opencode's TUI / web UI reports.
   - If they match: no discrepancy, possibly looking at the wrong
     session.
   - If openportal > opencode: most likely cause is synthetic /
     recovery messages openportal is summing that opencode hides.
     `missingCount > 0` confirms there are turns where opencode did
     not stamp cost; the question becomes whether openportal is
     summing turns OPENCODE-UI is hiding.
   - If openportal < opencode: opencode emitted cost on messages
     openportal isn't seeing (load-more not loaded all, smart-window
     loader excluded older ones). Use `limit=10000` query - the
     endpoint already does that.

## When to actually fix it

Until the user provides a specific session ID + the two competing
numbers from opencode's UI, the "fix" path is just instrumentation.
This commit adds the instrumentation. The reconciliation itself
requires:
  - The specific session showing the gap
  - opencode UI's number for the same session
  - Both screenshots / curl outputs

The most likely fix - based on the three documented divergences above -
is to filter out synthetic recovery messages in openportal's sum (skip
turns with cost=undefined when the message ID starts with
`recovery-`-style markers, or when info.system contains the
recovery-in-progress marker).

## Why this is not "BLOCKED"

The earlier todo entry said "BLOCKED on user: Cost discrepancy". That
was misleading - the BLOCKING is on a specific reconciliation data
point (the user's session showing the gap), not on figuring out
HOW to reconcile. This commit ships everything needed to reconcile
any session the user surfaces; the gate is just "pick a session and
run the curl".
