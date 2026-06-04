---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T20:16:21-05:00
legacy_number: 59
commits:
  attributed:
    - 2fa0d9489ef6
  on_main:
    - 2fa0d9489ef6
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# P0 cohort owner-routing across every runner-targeted command (CRITICAL CORRECTNESS)

User prompt (P0 from cohort-architecture dispatch):

> Today portal sends POST /session/<sid>/prompt_async to whichever opencode instance the user has selected as 'active server'. If a session is running on instance B (its owner) but the user's UI shows instance A as active, portal will deliver the prompt to A. A then spawns a SECOND runner for the same session, parallel to B's existing one. Outcome: Two concurrent assistant messages on the same session ID. Interleaved part writes -> garbled chat output, potential FK violations. Double model-API costs. opencode has no cross-instance prompt-routing mutex. The DB doesn't coordinate. THIS IS A REAL BUG, hits any user with multi-instance setups (tailscale + LAN + sandbox + docker). FIX: every prompt dispatch goes through a 'resolve owner' step: 1. Query plugin: GET 127.0.0.1:4098/verdicts/<sid>. 2. Read verdict.owner_instance_url. 3. If non-null: route POST /prompt_async to that URL, not the user-selected active-server URL. 4. If null (no current runner): route to user's selected active-server URL.

Design notes:
- 2fa0d94: new apps/web/src/server/lib/prompt-routing.ts exports resolveOwner(sessionId) which queries the plugin's authoritative aggregator at /verdicts/<sid> and parses owner_instance_url into {host, port}. 5s TTL cache so prompt bursts hit plugin once. Wired into pending-prompt-worker.ts + /prompt.ts + /command.ts. console.log records every rerouting decision.
- f26dcc3: same pattern applied to session.abort. Same bug class - aborts from non-owner instance no-op while runner keeps generating on owner.
- 7dd0b64: same pattern applied to session.summarize/compact. Compaction kicks off work on a specific instance; non-owner dispatch would spawn a second parallel compaction job. Now ALL runner-targeted opencode commands route via cohort owner: session.promptAsync, session.command, session.abort, session.summarize. DB-write commands (delete/archive/unarchive/revert/fork) stay on user's active-server since shared SQLite means any instance writes propagate.
- DEFERRED: per-cohort plugin URL (today everything goes to 127.0.0.1:4098; eventually plugin will run per cohort). SDK auth handoff if owner instance requires non-default auth (today everything is loopback unauthenticated so getOpencodeClient works for any port portal can reach).
