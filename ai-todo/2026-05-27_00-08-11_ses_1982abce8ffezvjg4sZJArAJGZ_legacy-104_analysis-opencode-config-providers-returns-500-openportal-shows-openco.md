---
status: DONE
session: ses_1982abce8ffezvjg4sZJArAJGZ
queued_at: 2026-05-27T00:08:11-05:00
legacy_number: 104
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# ANALYSIS: opencode `/config/providers` returns 500 -> OpenPortal shows "OpenCode unreachable" banner while opencode is fully usable otherwise

User prompt (verbatim):

> Create a git worktree. Develop and test there (when possible). Merge to the primary branch when done. Deploy the application and make sure it works. Push afterwards.
>
> Remember to obey project's AGENTS.md and always append to AI_TODO.md.
>
> current state of openportal:
>
> OpenCode unreachable - retrying every 10s
> Restart
> Servers
> Cached data still showing. OpenPortal-owned features (prompts archive, server list, settings) keep working. Live OpenCode reads resume automatically.
>
> chrome log:
> [connection-monitor] probe ok (trigger=interval, 7ms, health.opencode=down + lastKnown)
> ...
> [connection-monitor] probe ok (trigger=interval, 4ms, health.opencode=down + lastKnown)
>
> /api/instance/self returns:
> { "instance": null, "error": "active-server-unreachable", "reason": "Active OpenCode did not respond (server stopped, credentials rejected, or port in use by something else).", "lastKnown": {...srv-2dy1srwz @ 100.105.229.19:4096...}, "health": {"openportal": "up", "opencode": "down", "opencodeReason": "Active OpenCode did not respond..."}, "client": {...}, "presence": {...} }
>
> validate the health of 100.105.229.19:4096. why is openportal seeing it as down? it's half working, sure, but what exactly is going on?  if opencode is faulty / bad state, how to fix it? what is it doing? etc.

Design notes:

- This was an [analyze-mode] task. Per project AGENTS.md analysis protocol, full investigation persisted to [ai-analysis-requests/OPENCODE_CONFIG_PROVIDERS_500.md](file:///home/nowaker/projekty/webapps/portal/ai-analysis-requests/OPENCODE_CONFIG_PROVIDERS_500.md). No OpenPortal code changes in this turn (analyze-mode is research-only). The generic worktree+deploy framing in the prompt body is the user's standard preamble and doesn't trigger an implementation when the actual question is diagnostic.
- Root cause: opencode `1.15.10`'s `Provider.list()` throws `TypeError: undefined is not an object (evaluating 'r.provider')` on every invocation. Same crash from both `/config/providers` (via `ConfigHttpApi.providers`) and `/provider` (via `ProviderHttpApi.list`) — same minified `Provider.list` symbol at `chunk-80zh6mae.js:2:216672` and `:229818`. Crash starts at +782 ms after process start and never recovers.
- Adjacent diagnostic at startup, 1 ms BEFORE the first `r.provider` 500: `service=plugin error=undefined is not an object (evaluating 'O.config') plugin config hook failed`. Plugin name not logged. Strongly suggests some plugin's `config` hook return value poisoned the in-memory provider registry. 6 external plugins are loaded at startup; companion plugin in this repo is one of them.
- Other opencode endpoints all return 200: `/`, `/config`, `/agent`, `/mode`, `/session`, `/event` (SSE). Chat sessions work. Only the META "enumerate providers" endpoint is broken — exactly what the user called "half working".
- OpenPortal sees opencode as down because its probe is hardcoded to `GET /config/providers` in [`apps/web/src/server/lib/server-discovery.ts:548`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/lib/server-discovery.ts#L548). A 500 from that endpoint becomes `ok=false, reason=other, status=500` → `instance/self.ts` returns `active-server-unreachable` → the red banner.
- User's config is clean: `~/.local/share/opencode/auth.json` has exactly 3 providers (anthropic, openai, google), all with `key`+`type` fields. `~/.config/opencode/opencode.json` has NO `provider` key. So the malformed registry entry is being introduced by opencode itself (built-in registry or plugin hook), not by user-authored config.
- Recommendations in the doc, summarized: (a) restart `opencode-serve-tailscale.service` — fastest diagnostic, side-effect is current SSE sessions blip for ~5s; (b) if reproducible after restart, disable plugins one at a time; (c) OpenPortal-side probe-robustness improvement (separate future task) — teach the probe to recognize opencode's own error envelope shape (`{"name":"UnknownError","ref":"err_..."}`) as proof-of-life on 5xx, OR switch probe target to `/agent` which doesn't go through `Provider.list()`. Three concrete options (A/B/C) detailed in the doc.
- Did NOT restart opencode in this turn — that interrupts every active session including this one. User decides when. The opencode runtime is mid-investigation; restarting also destroys the live debug log evidence for upstream bug reporting.
- Open questions parked for the user: (1) restart now? (2) build the OpenPortal probe-robustness change? (3) which option (A/B/C)? Documented at the bottom of the analysis doc.
