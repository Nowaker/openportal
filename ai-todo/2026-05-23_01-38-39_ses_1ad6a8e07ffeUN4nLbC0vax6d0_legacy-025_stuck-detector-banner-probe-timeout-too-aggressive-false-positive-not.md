---
status: DONE
commit: c64912e
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T01:38:39-05:00
legacy_number: 25
---

# Stuck-detector banner: probe timeout too aggressive (false-positive "not loaded")

User-provided diagnosis + fix (verbatim):

> NEW BUG TO FIX: stuck-detector banner permanently shows "Stuck detector not loaded - falling back to portal heuristic. Last probe: timeout" even though the plugin IS loaded and responding.
>
> ROOT CAUSE (diagnosed from opencode-tools side):
>
> The plugin's HTTP server (Bun.serve at 127.0.0.1:4098 inside the host opencode-serve process) shares the same event loop as the host opencode's main work (LLM streaming, tool calls, parsing). When the host opencode is busy (45% CPU), the plugin's HTTP handler can't respond promptly. Measured response times for any plugin endpoint vary 0.05s - 3+s. Specifically:
>
>   /verdicts: 0.32s | 0.81s | 1.81s | 1.49s | 0.37s  (11295 bytes, 22 verdicts)
>   /config:   0.30s | TIMEOUT(>3s) | 0.39s | 0.01s | 0.18s  (704 bytes)
>   /workers:  0.12s | TIMEOUT(>3s) | 0.35s | 2.93s | 0.78s
>
> Portal's probe code at apps/web/src/server/stuck-detector/status.get.ts:
>   const PROBE_TIMEOUT_MS = 1_000;  // <-- way too aggressive
>   const r = await fetch(`${PLUGIN_URL}/verdicts`, { signal: controller.signal });
>
> The 1-second timeout fires often enough that the banner stays visible permanently. Plus, /verdicts is the heaviest endpoint (full cache serialization) - bad choice for a liveness probe.

Concrete fix steps (portal side, no opencode-serve restart needed):
1. `apps/web/src/server/stuck-detector/status.get.ts`: change `PROBE_TIMEOUT_MS` from `1_000` to `10_000`. The plugin can take 3+s during heavy host activity; 10s gives p99 headroom while still failing fast on a genuinely dead plugin (ECONNREFUSED is instant regardless of timeout).
2. Same file: switch the probe URL from `/verdicts` to `/config`. `/config` is 704 bytes vs `/verdicts`' 11KB+ (grows with stuck-session count). Both are equally good liveness signals; `/config` is bounded.
3. Verify the banner state machine de-asserts when the probe succeeds. `apps/web/src/components/stuck-detector-install-banner.tsx` should hide on `connected: true`; if it doesn't, fix the dismiss logic so a successful probe always clears the banner.

Future / optional (deferred plugin-side change in opencode-tools — would ship on next opencode-serve restart):
- opencode-tools side will add a `/health` endpoint that returns instant static data, no map/DB access. Defense-in-depth: even with a saturated event loop, `/health`'s handler is the smallest possible work and most likely to slip in between blocking operations. Until `/health` lands AND the user restarts opencode-serve, the portal fix (#1+#2 above) is the only effective change.

Context the user supplied:
- Plugin source: `/home/nowaker/projekty/nowaker/opencode-tools/opencode-stuck-detector/plugin.ts` (entry) + `/home/nowaker/projekty/nowaker/opencode-tools/_lib/stuck-detector/http-server.ts` (HTTP layer). opencode-tools master tip `3236794` (test fixes just landed).
- Plugin tests pass (48 / 0 fail). Issue is purely the portal probe configuration, not the plugin code.
- Live endpoints: `GET /verdicts /verdicts/stream /workers /config /actions /unstuck /register` etc. See `opencode-tools/_lib/stuck-detector/http-server.ts` for the full route table.
