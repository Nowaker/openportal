---
status: DONE
commit: 
session: ses_19503c6b9ffehM9rD28ldvSMTg
queued_at: 2026-05-27T19:09:29-05:00
legacy_number: 105
---

# Bisect opencode 1.15.10 plugins to find which one breaks `/config/providers` 500

User prompt (verbatim):

> do everything that's needed, and as how many times as needed against tailscale opencode. i don't care what. just don't delete anything. bisecting plugins, whatever, just do it.
> note: restarting tailscale opencode gives no result. so don't even try.

(Followed by a clarification on a second user message:)

> on the tailscale instance.

Design notes:

- User explicitly authorized restart-of-tailscale-opencode AS MANY TIMES AS NEEDED and signaled restart-alone doesn't fix it. So this is a plugin-removal bisection that DOES restart opencode 9 times. Side-effect: my current session blips on every restart - the bisection runs as a detached `systemd-run --user` script that lives in its own cgroup scope, so it survives the opencode-serve-tailscale.service restart sequence (which would otherwise kill my bash tool process as a child of opencode).
- Script: [/tmp/bisect-opencode.sh](file:///tmp/bisect-opencode.sh). Logs: [/tmp/bisect-opencode.log](file:///tmp/bisect-opencode.log). Completion sentinel: `/tmp/bisect-opencode.DONE`. systemd unit: `bisect-opencode.service` (--user --collect).
- Test plan in the script:
  - TEST 0: baseline (unchanged config) — expect HTTP 500 to confirm reproduction.
  - TEST 1: ALL plugins disabled in BOTH configs — if HTTP 200, bug IS plugin-driven; if HTTP 500, bug is in opencode core or auth.json (cannot bisect via plugins).
  - TEST 2..N: remove ONE plugin at a time, restart, probe. Plugins iterated: oh-my-openagent@latest, opencode-session-backup@latest, opencode-db-backup-plugin, opencode-log-archive-plugin, opencode-heap-snapshot-pruner-plugin, opencode-stuck-detector (6 in main), openportal-companion-plugin (1 in home). 7 per-plugin tests + baseline + all-off = 9 restarts.
- Don't-delete-anything compliance: original `~/.config/opencode/opencode.json` and `~/.opencode/opencode.json` are copied to `~/.opencode-bisect-backup-<timestamp>/` BEFORE any edits. Script's EXIT trap runs `restore_full` + final `systemctl restart` on ANY exit (success, error, abort, signal). Backup dir is PRESERVED after completion for forensics.
- Probe logic: each test polls `http://100.105.229.19:4096/config/providers` up to 60 seconds (1s intervals, 3s curl timeout), accepting only HTTP 200 (clean) or HTTP 500 (the bug) as conclusive. "timeout" means opencode never came back up - unlikely with the systemd unit's `Restart=always`.
- Follow-up turn (next turn this conversation): read `/tmp/bisect-opencode.log`, identify lines starting with `>>> CULPRIT:`, report findings to user, recommend remediation. If `ALL_OFF_HEALTHY=0` in the final summary, bug is NOT a plugin and a separate auth-file or built-in-provider investigation is required (also do not delete auth.json - move it aside and replace with `{}` temporarily, restoring after).
- This entry is `DONE - bisection launched` because the QUEUEING + setup is complete. The follow-up turn will UPDATE this entry with the actual bisection RESULT once the log is readable (status flips to `DONE - <conclusion>`).
