import { defineHandler } from "nitro/h3";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getActiveServer } from "../lib/server-registry";
import { resolveLiveEndpoint } from "../lib/server-resolver";
import { probeOpencode } from "../lib/server-discovery";
import { detectClient } from "../lib/client-detection";
import { getLatestBrowserPresence } from "../lib/presence-tracker";

function buildPresencePayload() {
  const p = getLatestBrowserPresence();
  if (!p) return null;
  return { ip: p.ip, isLocal: p.isLocal, at: p.at, ageMs: Date.now() - p.at };
}

const LEGACY_CONFIG_PATH = join(homedir(), ".portal.json");

// /api/instance/self — tell the browser which server this Portal UI is
// bound to. Resolution order:
//
//   1. New registry: an explicit `activeServerId` in ~/.openportal.json.
//      This is the configless / multi-server path. The Portal UI was
//      either started without a managed opencode at all, or the user
//      pointed it at a different server via the /servers screen.
//   2. Legacy ~/.portal.json: the openportal-CLI-spawned-its-own-opencode
//      flow. Match by web-UI port (the env var PORT this process was
//      started with). Same behavior as before the multi-server refactor.
//   3. No instance. Frontend redirects to /servers so the user can pick
//      or add one.
//
// Critical behavior for ephemeral servers: this handler triggers
// resolveLiveEndpoint() on every call, which (for ephemeral entries)
// re-runs process-scan discovery and persists the new live port back
// into the registry. This is how opencode-desktop port shifts propagate
// to the frontend: connection monitor pings /api/instance/self, sees the
// changed port, the instance-store is reseated, all SWR keys
// (which include port in their URL) refetch against the new endpoint.

export default defineHandler(async (event) => {
  const client = detectClient(event);
  const presence = buildPresencePayload();
  const active = getActiveServer();
  if (active) {
    // Force a fresh resolve so ephemeral entries pick up port shifts.
    // Side effect: resolver's updateEphemeralEndpoint() persists the
    // new port to ~/.openportal.json. Re-read after to surface the
    // updated value, since the in-memory `active` is now stale.
    const live = await resolveLiveEndpoint(active);
    if (!live) {
      // Ephemeral entry whose process is no longer running (e.g.
      // opencode-desktop quit), or a configured entry whose stored
      // host:port can no longer be resolved. The frontend treats
      // `instance: null` as "redirect to /servers"; we surface a
      // `reason` so the UI can show a more specific banner if it
      // wants, plus enough context (label, host, port, ephemeral) to
      // render a "your last server was X — pick it again or choose
      // another" hint.
      return {
              instance: null,
              error: "active-server-unreachable",
              reason: active.ephemeral
                ? "Active opencode is no longer running (ephemeral) and could not be re-discovered."
                : "Active opencode is no longer reachable at its configured endpoint.",
              lastKnown: {
                id: active.id,
                label: active.label,
                host: active.host,
                port: active.port,
                ephemeral: active.ephemeral,
              },
              client,
              presence,
            };
    }
    // For non-ephemeral active servers, also do a real HTTP probe so
    // that "process listening on the registry's port but it's a
    // different service" gets caught. Cheap: one /config/providers
    // call per /api/instance/self poll (every 10s via the connection
    // monitor) is negligible.
    const fresh = getActiveServer() ?? active;
    if (!fresh.ephemeral) {
      const ok = await probeOpencode(live.host, live.port, live.auth);
      if (!ok) {
        return {
          instance: null,
          error: "active-server-unreachable",
          reason:
            "Active opencode did not respond (server stopped, credentials rejected, or port in use by something else).",
          lastKnown: {
            id: fresh.id,
            label: fresh.label,
            host: fresh.host,
            port: fresh.port,
            ephemeral: fresh.ephemeral,
          },
          client,
          presence,
        };
      }
    }
    return {
      instance: {
        id: fresh.id,
        name: fresh.label,
        directory: undefined,
        port: fresh.port,
        hostname: fresh.host,
        ephemeral: fresh.ephemeral,
      },
      client,
      presence,
    };
  }

  const myPort = parseInt(process.env.PORT || "", 10);
  if (!myPort || Number.isNaN(myPort)) {
    return { instance: null, error: "PORT env not set", client, presence };
  }
  if (!existsSync(LEGACY_CONFIG_PATH)) {
    return { instance: null, error: "no active server, no legacy config", client, presence };
  }
  try {
    const config = JSON.parse(readFileSync(LEGACY_CONFIG_PATH, "utf-8"));
    const me = (config.instances || []).find(
      (i: { port: number | null }) => i.port === myPort,
    );
    if (!me) {
      return { instance: null, error: `no registry entry for PORT=${myPort}`, client, presence };
    }
    return {
      instance: {
        id: me.id,
        name: me.name,
        directory: me.directory,
        port: me.opencodePort,
        hostname: me.hostname,
        ephemeral: false,
      },
      client,
      presence,
    };
  } catch (e) {
    return {
      instance: null,
      error: e instanceof Error ? e.message : "config read failed",
      client,
      presence,
    };
  }
});
