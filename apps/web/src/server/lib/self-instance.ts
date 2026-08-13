import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { H3Event } from "nitro/h3";
import {
  buildServerOrigin,
  displayServerLabel,
  getActiveServer,
  type ConfiguredServer,
  type ServerProtocol,
} from "./server-registry";
import { resolveLiveEndpoint } from "./server-resolver";
import { probeOpencodeCached } from "./probe-cache";
import { detectClient } from "./client-detection";
import { getLatestBrowserPresence } from "./presence-tracker";

const LEGACY_CONFIG_PATH = join(homedir(), ".portal.json");

function buildPresencePayload() {
  const p = getLatestBrowserPresence();
  if (!p) return null;
  return { ip: p.ip, isLocal: p.isLocal, at: p.at, ageMs: Date.now() - p.at };
}

function webEndpointFor(
  protocol: ServerProtocol,
  host: string,
  port: number,
  explicit?: string,
): string {
  const base = explicit?.trim() || buildServerOrigin(protocol, host, port);
  try {
    return new URL(base).toString().replace(/\/$/, "");
  } catch {
    return buildServerOrigin(protocol, host, port);
  }
}

// The payload behind /api/instance/self — tell the browser which server
// this Portal UI is bound to. Lives in lib/ rather than inside the route
// handler because /api/servers/bind returns the exact same body: a
// permalink-driven server switch hands the browser its new self-state
// in the same round-trip that performed the switch, so the client can
// seed its SWR cache instead of racing a second fetch against the data
// hooks it is about to unblock. One definition, two callers.
//
// Resolution order:
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
// Response shape carries three orthogonal signals:
//   client    Per-request: who is calling THIS endpoint right now (drives
//             the VSCode-link local/remote split, etc.).
//   presence  Per-user: where the most recent BROWSER request came from
//             (drives the sudo dispatch + anything else that needs to
//             know where the user's eyes are, NOT where the caller is).
//   health    Per-instance: openportal is always 'up' if we answered;
//             opencode is 'up' or 'down' depending on whether the bound
//             opencode responded to a probe. The frontend uses this to
//             pick between a red 'openportal-down' banner and a yellow
//             'opencode-down (cached data)' banner.

type OpencodeHealth = "up" | "down";

interface HealthShape {
  openportal: "up";
  opencode: OpencodeHealth;
  opencodeReason?: string;
}

type InstanceShape = {
  id: string;
  name: string;
  directory: undefined;
  port: number;
  hostname: string;
  protocol: ServerProtocol;
  webEndpoint: string;
  ephemeral: boolean;
};

function instanceFor(server: ConfiguredServer): InstanceShape {
  return {
    id: server.id,
    name: displayServerLabel(server),
    directory: undefined,
    port: server.port,
    hostname: server.host,
    protocol: server.protocol,
    webEndpoint: webEndpointFor(
      server.protocol,
      server.host,
      server.port,
      server.webEndpoint,
    ),
    ephemeral: server.ephemeral,
  };
}

export async function buildSelfPayload(event: H3Event) {
  const client = detectClient(event);
  const presence = buildPresencePayload();
  const active = getActiveServer();
  if (active) {
    const live = await resolveLiveEndpoint(active);
    if (!live) {
      const reason = active.ephemeral
        ? "Active OpenCode is no longer running (ephemeral) and could not be re-discovered."
        : "Active OpenCode is no longer reachable at its configured endpoint.";
      const health: HealthShape = {
        openportal: "up",
        opencode: "down",
        opencodeReason: reason,
      };
      return {
        instance: instanceFor(active),
        error: "active-server-unreachable",
        reason,
        lastKnown: {
          id: active.id,
          label: displayServerLabel(active),
          protocol: active.protocol,
          host: active.host,
          port: active.port,
          ephemeral: active.ephemeral,
        },
        health,
        client,
        presence,
      };
    }
    const fresh = getActiveServer() ?? active;
    if (!fresh.ephemeral) {
      const probeResult = await probeOpencodeCached(
        live.host,
        live.port,
        live.auth,
        live.protocol,
      );
      if (!probeResult.ok) {
        const reason =
          "Active OpenCode did not respond (server stopped, credentials rejected, or port in use by something else).";
        const health: HealthShape = {
          openportal: "up",
          opencode: "down",
          opencodeReason: reason,
        };
        return {
          instance: instanceFor(fresh),
          error: "active-server-unreachable",
          reason,
          lastKnown: {
            id: fresh.id,
            label: displayServerLabel(fresh),
            protocol: fresh.protocol,
            host: fresh.host,
            port: fresh.port,
            ephemeral: fresh.ephemeral,
          },
          health,
          client,
          presence,
        };
      }
    }
    return {
      instance: instanceFor(fresh),
      health: { openportal: "up", opencode: "up" } as HealthShape,
      client,
      presence,
    };
  }

  const myPort = parseInt(process.env.PORT || "", 10);
  if (!myPort || Number.isNaN(myPort)) {
    return {
      instance: null,
      error: "PORT env not set",
      health: { openportal: "up", opencode: "down", opencodeReason: "no-active-server" } as HealthShape,
      client,
      presence,
    };
  }
  if (!existsSync(LEGACY_CONFIG_PATH)) {
    return {
      instance: null,
      error: "no active server, no legacy config",
      health: { openportal: "up", opencode: "down", opencodeReason: "no-active-server" } as HealthShape,
      client,
      presence,
    };
  }
  try {
    const config = JSON.parse(readFileSync(LEGACY_CONFIG_PATH, "utf-8"));
    const me = (config.instances || []).find(
      (i: { port: number | null }) => i.port === myPort,
    );
    if (!me) {
      return {
        instance: null,
        error: `no registry entry for PORT=${myPort}`,
        health: { openportal: "up", opencode: "down", opencodeReason: "no-active-server" } as HealthShape,
        client,
        presence,
      };
    }
    return {
      instance: {
        id: me.id,
        name: me.name,
        directory: me.directory,
        port: me.opencodePort,
        hostname: me.hostname,
        protocol: "http",
        webEndpoint: webEndpointFor("http", me.hostname, me.opencodePort),
        ephemeral: false,
      },
      health: { openportal: "up", opencode: "up" } as HealthShape,
      client,
      presence,
    };
  } catch (e) {
    return {
      instance: null,
      error: e instanceof Error ? e.message : "config read failed",
      health: { openportal: "up", opencode: "down", opencodeReason: "no-active-server" } as HealthShape,
      client,
      presence,
    };
  }
}
