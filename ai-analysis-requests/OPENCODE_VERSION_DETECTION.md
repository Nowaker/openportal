# OpenCode version detection in OpenPortal

## Question

User asked how OpenPortal determines the currently running OpenCode version,
whether the OpenCode API returns the version, and how the implementation should
work before making a fix.

Observed banner text:

```text
OpenCode v1.16.2 ready - restart to apply
Running v1.15.12 -> installed v1.16.2
Install method: AUR package "opencode-bin"
Update command: paru -Syu opencode-bin # or yay / your AUR helper
```

## Current OpenPortal implementation

OpenPortal does **not** read the running OpenCode process version.

The only backend endpoint for this feature is
`apps/web/src/server/opencode-version.ts`:

```ts
if (method === "GET") {
  return getOpencodeVersionInfo();
}
```

`getOpencodeVersionInfo()` lives in
`apps/web/src/server/lib/opencode-version-state.ts` and returns:

- `installed`: parsed from `opencode --version` on the OpenPortal host.
- `lastAcknowledgedVersion`: persisted in
  `~/.openportal-state.json` under `settings.opencodeUpdate`.
- `updated`: `installed !== lastAcknowledgedVersion`.
- `installSource`: guessed from `command -v opencode` plus package-manager
  checks such as `pacman -Qo` / `pacman -Si`.

Important code path:

```ts
const raw = execSync(`${bin} --version 2>/dev/null`, {
  encoding: "utf8",
  timeout: 2000,
}).trim();
const m = raw.match(/(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/);
```

Then:

```ts
const updated =
  installed !== null &&
  state.lastAcknowledgedVersion !== null &&
  state.lastAcknowledgedVersion !== installed;
```

The frontend hook in `apps/web/src/stores/opencode-version-store.ts` polls
`/api/opencode-version` hourly. The banner in
`apps/web/src/components/opencode-update-banner.tsx` renders:

```tsx
OpenCode v{info.installed} ready - restart to apply
Running v{info.lastAcknowledgedVersion} -> installed v{info.installed}
```

So the label `Running v...` is misleading. It is not the version returned by
the active OpenCode server. It is only the last version the user dismissed or
the first installed version OpenPortal saw.

## Live local evidence

OpenPortal currently reports its own version-check endpoint as:

```json
{
  "installed": "1.16.2",
  "lastAcknowledgedVersion": "1.16.2",
  "updated": false,
  "installSource": {
    "method": "aur",
    "package": "opencode-bin",
    "binaryPath": "/bin/opencode",
    "updateCommand": "paru -Syu opencode-bin  # or yay / your AUR helper"
  }
}
```

The host binary check agrees:

```text
/bin/opencode
1.16.2
opencode-bin 1.16.2-1
/usr/bin/opencode is owned by opencode-bin 1.16.2-1
```

OpenPortal is configured to talk to an external OpenCode server at
`100.105.229.19:4096`, not `127.0.0.1:4096`:

```json
{
  "externalOpencode": {
    "port": 4096,
    "exitAfterUnreachableSeconds": 300
  },
  "activeServerId": "srv-2dy1srwz"
}
```

That distinction matters because `opencode --version` checks the installed
binary visible to the OpenPortal process, while the active server may be an
already-running process started before the package update or even a different
host/server entry.

## Does OpenCode API return the running version?

Yes. Current OpenCode docs document:

```text
GET /global/health
Get server health and version
Response: { healthy: true, version: string }
```

Source: `https://opencode.ai/docs/server/`, section `Global`.

This is the correct runtime signal because it comes from the OpenCode server
process OpenPortal is actually talking to. It answers: "what version is this
running daemon?"

By contrast:

- `GET /config` returns the OpenCode config object. It has no top-level
  runtime version field.
- `GET /config/providers` returns `{ providers, default }`. It has no runtime
  version field.
- `/app` and `/version` on the live server returned the web app shell HTML in
  this environment, not JSON version data.

Live checks through OpenPortal confirmed proxied config/provider responses do
not expose a runtime version:

```json
// /api/opencode/4096/config
{
  "keys": [
    "$schema",
    "agent",
    "command",
    "default_agent",
    "formatter",
    "logLevel",
    "mcp",
    "mode",
    "permission",
    "plugin",
    "provider",
    "skills",
    "tools",
    "username"
  ],
  "version": null
}

// /api/opencode/4096/providers
{
  "keys": ["default", "providers"],
  "version": null
}
```

## Why the current implementation is wrong

The feature has two separate concepts but only stores one real measurement:

| Concept | Current value | Problem |
|---|---|---|
| Installed version | `opencode --version` on OpenPortal host | Real, but only local install state. |
| Running version | `lastAcknowledgedVersion` | Not real; just dismissal state. |
| Update available? | `installed !== lastAcknowledgedVersion` | Detects "user has not dismissed this installed version", not "daemon is stale". |

The current banner can lie in both directions:

1. If OpenCode was updated on disk but the daemon is still old, the banner
   happens to look useful, but only because `lastAcknowledgedVersion` often
   equals the pre-update installed version. It did not actually inspect the
   running daemon.
2. If the user dismisses the banner before restarting OpenCode,
   `lastAcknowledgedVersion` becomes the new installed version and the banner
   disappears even though the daemon may still be old.
3. If OpenPortal talks to a remote or non-local server, local
   `opencode --version` may be unrelated to the running server entirely.
4. If multiple configured OpenCode servers exist, one global
   `lastAcknowledgedVersion` cannot describe the runtime version per server.

## How it should be implemented

OpenPortal should model version detection as three fields:

```ts
interface OpencodeVersionInfo {
  running: string | null;       // from active server GET /global/health
  installed: string | null;     // from local opencode --version, only if local install is relevant
  updateAvailable: boolean;     // running !== installed, when both are known
  installSource: InstallSource | null;
  dismissedFor?: string | null; // UI-dismiss state, not a version source
}
```

Implementation outline:

1. Resolve the active/configured OpenCode server using the same resolver as the
   other opencode proxy routes (`getOpencodeBaseUrl(port)` or an SDK method if
   generated SDK exposes `global.health`).
2. Call `GET /global/health` on that resolved target with the same auth wrapper
   used for `/config` and `/config/providers`.
3. Treat `health.version` as the authoritative running version for that server.
4. Keep the existing local `opencode --version` logic only for installed-version
   detection and install-source guidance.
5. Compare `running` vs `installed` only when both are non-null.
6. Store dismissal state separately, preferably keyed by server identity and the
   pair `{ running, installed }`, not as `lastAcknowledgedVersion` pretending to
   be runtime state.
7. Update UI copy to say exactly what is known:
   - `OpenCode v1.16.2 installed - running v1.15.12. Restart OpenCode to apply.`
   - If running unknown: `OpenCode v1.16.2 installed. Running version unknown.`
   - If installed unknown: `OpenCode running v1.15.12. Installed version unknown.`

## Files involved

- `apps/web/src/server/opencode-version.ts` - OpenPortal API endpoint for the
  banner.
- `apps/web/src/server/lib/opencode-version-state.ts` - current local binary
  version, install-source detection, and dismissal state.
- `apps/web/src/stores/opencode-version-store.ts` - frontend SWR hook.
- `apps/web/src/components/opencode-update-banner.tsx` - banner text and
  dismiss action.
- `apps/web/src/server/lib/opencode-client.ts` - existing target resolution,
  base URL, and auth wrapper patterns that a fixed implementation should reuse.
- `apps/web/src/server/opencode/[port]/config.ts` and `providers.ts` - examples
  of existing proxied opencode calls that do not currently include runtime
  version.
