# OpenCode `/config/providers` 500: why OpenPortal sees opencode as "down"

**Status**: Analyzed — awaiting user direction
**Symptom**: OpenPortal UI shows "OpenCode unreachable — retrying every 10s" banner against `100.105.229.19:4096`.
**Reality**: opencode is alive and serving the chat API. Only the `/config/providers` and `/provider` endpoints are broken.
**Root cause**: opencode `1.15.10`'s `Provider.list()` throws `TypeError: undefined is not an object (evaluating 'r.provider')` on every call. Some entry in its internal provider/auth iteration is missing a `.provider` field.
**Date**: 2026-05-27

---

## TL;DR

OpenPortal pings opencode for liveness with `GET /config/providers`. That single endpoint is broken in this opencode process — it 500s with a `TypeError` inside `Provider.list()` — while every other endpoint (`/`, `/config`, `/agent`, `/mode`, `/session`, `/event` SSE) returns 200. opencode is fully usable; you can chat, create sessions, browse history, stream events. OpenPortal just can't tell, because its probe is hardcoded to the one endpoint that's crashing.

Two independently actionable fixes:

1. **Restart opencode** (`systemctl --user restart opencode-serve-tailscale.service`) to see if the broken provider state is transient. If `/config/providers` returns clean, log it and move on.
2. **Fix OpenPortal's probe** to recognize "opencode is up but `/config/providers` broken" by either (a) checking the response body shape — a 500 with `name: "UnknownError"` and `ref: "err_..."` is opencode's own error envelope, so it IS opencode and openportal should treat it as up-but-degraded, OR (b) falling back to a stabler endpoint like `/agent` (cheap, opencode-specific, doesn't go through `Provider.list()`).

---

## Investigation

### Direct probe of every endpoint

```
GET /                    HTTP 200  4ms
GET /config              HTTP 200  4ms   (returns full config JSON, big)
GET /config/providers    HTTP 500  1ms   <-- THE BREAKAGE
GET /agent               HTTP 200  9ms
GET /mode                HTTP 200  1ms
GET /session             HTTP 200  4ms
GET /event               HTTP 200  SSE   (server.connected event flows fine)
```

Body of the `/config/providers` 500:

```json
{
  "name": "UnknownError",
  "data": {
    "message": "Unexpected server error. Check server logs for details.",
    "ref": "err_2adb56ef"
  }
}
```

Each call to `/config/providers` mints a fresh `err_XXXXXXXX` ref. The error is logged into opencode's own debug log every time.

### Cross-reference with opencode's debug log

`~/.local/share/opencode/log/2026-05-27T195656.log` shows:

- Process started: `19:56:56 +226ms` (= `14:56:56 CDT`, ~5 min before the user's report).
- Plugins loaded normally (10 internal + 6 external plugins listed).
- `19:56:59 +781ms`: `service=plugin error=undefined is not an object (evaluating 'O.config') plugin config hook failed`. **Plugin name is not logged**; it's a bare error from inside the plugin-host's `config` hook fan-out. This fires once at startup.
- `19:56:59 +1ms` (immediately after the plugin hook error): first `r.provider` crash. Stack:
  ```
  TypeError: undefined is not an object (evaluating 'r.provider')
      at <anonymous>           (chunk-mrjaff7n.js:657:53040)   <-- iterator inner fn
      at Provider.list         (chunk-80zh6mae.js:2:216672)
      at Provider.list (def)   (chunk-mrjaff7n.js:657:58067)
      at ConfigHttpApi.providers
                               (chunk-80zh6mae.js:2:91976)
      at ConfigHttpApi.providers (def)
                               (chunk-80zh6mae.js:2:216614)
      at Server.listen         (chunk-80zh6mae.js:2:259524)
  ```
- Same crash also surfaces from a sibling call site on `/provider`:
  ```
      at Provider.list         (chunk-80zh6mae.js:2:229818)
      at ProviderHttpApi.list  (chunk-80zh6mae.js:2:229537)
  ```
  Same `Provider.list` symbol, different caller. Both endpoints crash, deterministically, on every call.

Cadence after startup: ~one error every 5–6 seconds, which is the openportal connection-monitor's 10s probe interval against `/api/instance/self` × probe-cache miss × 2 active browser tabs (the `multi-tab cohort` story below). Each browser-tab poll causes a fresh `/config/providers` call from openportal → opencode and a fresh 500.

### Why is `r.provider` undefined?

The opencode binary is a 144 MB bundled-with-Bun executable; full source isn't available to read directly. From the stack trace and the symbol names, what we can say:

- `Provider.list()` returns a list of providers by iterating some collection. The iterator body dereferences `r.provider` for each element. One element has `r.provider === undefined`.
- This is the SAME `Provider.list()` used by both `/config/providers` and `/provider`, so the corruption is in opencode's in-memory provider registry, not request-path-specific.
- The 1ms-after-plugin-hook-error timing is strongly suggestive that a plugin's `config` hook contributed a malformed entry to the registry. Could be:
  - one of the 10 internal opencode plugins
  - one of the 6 external plugins:
    - `oh-my-openagent@latest`
    - `opencode-session-backup@latest`
    - `opencode-db-backup-plugin` (local)
    - `opencode-log-archive-plugin` (local)
    - `opencode-heap-snapshot-pruner-plugin` (local)
    - `opencode-stuck-detector` (local)
    - `openportal-companion-plugin` (this repo)

  The `O.config` minified variable name doesn't pin down which one.

### User config + auth state (clean)

- `~/.local/share/opencode/auth.json` contains exactly three providers: `anthropic`, `openai`, `google`. Each value has `key` + `type` fields. No malformed entries from the user side.
- `~/.config/opencode/opencode.json` has no `provider` key at all. Only `agent`, `logLevel`, `mcp`, `permission`, `plugin`.
- `~/.config/opencode/opencode.jsonc`, `~/.config/opencode/config.json`, `~/.opencode/opencode.json` all exist and are loaded but none add provider entries that could be malformed.
- This means the malformed entry is being introduced by **opencode itself** (built-in provider registry or plugin-host code), not by user-authored config.

### How OpenPortal turns the 500 into "OpenCode unreachable"

The probe lives in [`apps/web/src/server/lib/server-discovery.ts:539-562`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/lib/server-discovery.ts#L539-L562):

```ts
export async function probeOpencodeDetailed(
  host: string, port: number, auth?: BasicAuthCreds, timeoutMs = 5000,
): Promise<ProbeResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${host}:${port}/config/providers`, {
      signal: ctrl.signal,
      headers: basicAuthHeader(auth),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "auth-required", status: res.status };
    }
    return { ok: false, reason: "other", status: res.status };
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally { clearTimeout(t); }
}
```

Then [`apps/web/src/server/instance/self.ts:84-113`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/instance/self.ts#L84-L113) calls `probeOpencodeCached()` and, if `probeResult.ok` is false, returns:

```json
{
  "instance": null,
  "error": "active-server-unreachable",
  "reason": "Active OpenCode did not respond (server stopped, credentials rejected, or port in use by something else)."
}
```

That's the exact payload the user pasted. The frontend's `useConnectionMonitor` ([`apps/web/src/hooks/use-connection-monitor.ts:98`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/hooks/use-connection-monitor.ts#L98)) reads `body.error === "active-server-unreachable"` and renders the red "OpenCode unreachable — retrying every 10s" banner with the Restart / Servers buttons.

### Why this is "half-working"

`Provider.list()` is called by exactly two HTTP endpoints — `/config/providers` and `/provider`. **Every other opencode endpoint works**. Sessions don't need `Provider.list()` to operate — they were created against a specific provider/model, and `session.chat`/`session.message`/`session.prompt` use those bound values directly. The streaming bus, the file watcher, the format/lsp services, the bus subscriptions all initialized normally.

So the user's actual chat sessions are functional. OpenPortal's cached-data path even renders them correctly (the "Cached data still showing. OpenPortal-owned features (prompts archive, server list, settings) keep working." line in the user's UI). The only thing that's broken is the META endpoint that enumerates providers, plus OpenPortal's hardcoded use of that endpoint as the liveness probe.

### Process state (live opencode)

```
PID 4016665  RSS 498MB  VSZ 76GB  %CPU 17.6  ETIME 05:52  STAT Ssl  opencode
```

- Tasks: 533 (mostly MCP child processes — 3x lsp-tools, 3x ast-grep, 3x chrome-devtools-mcp, 3x panel-context, 3x openportal-sudo, etc. — these are PER-instance MCP children, opencode spawns one set per directory).
- Memory peak this session: 8.5 GB (cgroup-tracked). Previous session ran 15h+ and peaked at 36.3 GB before the timeout-shutdown at 13:41:38.
- Last shutdown was a timeout-kill (`State 'final-sigterm' timed out. Killing.`) — opencode didn't drain SSE/MCP cleanly, was SIGKILL'd. That's a separate issue but might be related if the bad shutdown corrupted the on-disk plugin registry — though plugin loading explicitly re-runs on every startup, so this shouldn't carry across boots.

---

## Recommendations

### Immediate (no code change)

1. **Restart opencode**: `systemctl --user restart opencode-serve-tailscale.service`. The plugin loader runs fresh, so if the malformed entry came from a transient plugin-hook race, it should clear.
   - Side effect: every active chat session will lose its in-memory SSE connection. They auto-reconnect, but the user gets an "OpenCode unreachable" blip for ~5 s.
2. **If `/config/providers` still 500s after restart**, the bug is reproducible from current config + plugins:
   - Disable plugins one at a time by editing `~/.config/opencode/opencode.json` `"plugin": [...]` to find the culprit.
   - Start with `openportal-companion-plugin` (the only one in this repo's code path) — its `config: false` field at [packages/openportal-companion-plugin/src/index.ts:109](file:///home/nowaker/projekty/webapps/portal/packages/openportal-companion-plugin/src/index.ts#L109) is unrelated to opencode's plugin-host `config` hook, but worth a smoke-test.
   - Then try the local `~/projekty/nowaker/opencode-tools/*` plugins one by one.
   - Finally `oh-my-openagent` and `opencode-session-backup`.
3. **Last resort**: pin opencode-bin to a different version (current Arch package is `opencode-bin 1.15.10-1`). If a `1.15.11` or `1.16.x` is on AUR, try the upgrade.

### Short-term (OpenPortal code change — separate task, not done here)

Probe should not treat opencode's-own-error-envelope as "this isn't opencode". Two options:

**Option A**: After getting a non-2xx response, parse the body. If it matches opencode's error envelope shape (`{ name: string, data: { message, ref } }`), return `ok: true` with a `degraded: true` flag. The UI can then render an amber "OpenCode is up but reporting errors on /config/providers" banner instead of the red "unreachable" banner — and the user keeps chatting.

**Option B**: Switch the probe target from `/config/providers` to `/agent`. Same opencode-only specificity (a stock HTTP server won't serve `/agent`), faster (smaller payload), and doesn't go through `Provider.list()`. Slightly less of a "deep" probe — we don't catch the case where Provider.list is busted but everything else works — but that's arguably the right behaviour anyway: if chat works, openportal should report the server as up.

**Option C** (best of both): Probe `/agent` for the fast liveness path. Surface `/config/providers` failures as a separate diagnostic on `/api/instance/self` (e.g. `health.providersEndpoint: "broken"`) so the Settings → Diagnostics tab can show "providers list unavailable — restart opencode" without flipping the whole UI into the red-banner unreachable state.

### Long-term (upstream)

File the `r.provider` crash against `sst/opencode` (or whichever upstream the `anomalyco/opencode` Arch package tracks). Reproducer:

```
opencode serve --hostname 127.0.0.1 &
curl -i http://127.0.0.1:4096/config/providers
```

Expected: 200 + provider list. Actual: 500 + TypeError. The bug appears to fire on at least some plugin combinations even without user-authored `provider` config.

---

## Open questions for the user

1. Want me to restart `opencode-serve-tailscale.service` and confirm whether the probe goes green after restart? (Briefly interrupts current sessions but is the fastest diagnostic.)
2. If restart fixes it transiently, is this worth investing in the OpenPortal probe-robustness change above, or just live with it as a "restart opencode when it happens" issue?
3. If a code change IS desired, which option (A / B / C above) is preferred?

---

## References

- Probe code: [apps/web/src/server/lib/server-discovery.ts#L518-L562](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/lib/server-discovery.ts#L518-L562)
- Probe usage: [apps/web/src/server/instance/self.ts#L84-L113](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/instance/self.ts#L84-L113)
- Frontend handling: [apps/web/src/hooks/use-connection-monitor.ts#L98](file:///home/nowaker/projekty/webapps/portal/apps/web/src/hooks/use-connection-monitor.ts#L98)
- opencode log with crash: `~/.local/share/opencode/log/2026-05-27T195656.log` (search for `r.provider`)
- opencode version: `opencode-bin 1.15.10-1` (Arch)
