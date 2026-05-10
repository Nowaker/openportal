import { defineHandler } from "nitro/h3";
import { lookup as dnsLookup } from "dns/promises";
import {
  getActiveServerId,
  listConfiguredServers,
  type ConfiguredServer,
} from "../lib/server-registry";
import { discoverAll, probeOpencode } from "../lib/server-discovery";
import { listInspectFindings } from "../lib/inspect-pool";
import { resolveLiveEndpoint } from "../lib/server-resolver";
import {
  ensureBackgroundCredLookup,
  getCredStatusPublic,
  type CredLookupState,
} from "../lib/cred-lookup";
import { getAuth } from "../lib/auth-store";

// Cache of hostname -> resolved IP (or null = unresolvable / failed).
// /api/servers gets polled every few seconds; without caching we'd
// fire a DNS lookup per entry per poll. 60s is long enough to be
// effectively free and short enough that a Tailscale device flipping
// IPs is reflected on the page in under a minute.
interface DnsCacheEntry {
  address: string | null;
  expiresAt: number;
}
const DNS_TTL_MS = 60_000;
const dnsCache = new Map<string, DnsCacheEntry>();

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6_RE = /^[0-9a-f:]+$/i;

function isIpLiteral(host: string): boolean {
  return IPV4_RE.test(host) || IPV6_RE.test(host);
}

async function resolveHostAddress(host: string): Promise<string | null> {
  // IPs map to themselves trivially; skip the lookup. Loopback aliases
  // get a synthetic resolution so the UI shows "127.0.0.1" rather than
  // a blank — kind of a no-op but the user shouldn't have to think
  // about "is localhost == 127.0.0.1 today?".
  if (isIpLiteral(host)) return null;
  if (host === "localhost") return "127.0.0.1";
  const cached = dnsCache.get(host);
  if (cached && cached.expiresAt > Date.now()) return cached.address;
  // Prefer IPv4 (`family: 4`) over IPv6. The hostnames here are
  // typically mDNS / Tailscale / LAN names where IPv4 is the
  // routable, human-meaningful answer. IPv6 link-local addresses
  // (fe80::) are essentially noise — they're correct but not
  // useful for a user looking at "which box is this?".
  try {
    const { address } = await dnsLookup(host, { family: 4 });
    dnsCache.set(host, { address, expiresAt: Date.now() + DNS_TTL_MS });
    return address;
  } catch {
    // Fall back to whatever family the resolver returns; better than
    // showing nothing for v6-only hosts.
    try {
      const { address } = await dnsLookup(host, { family: 0 });
      dnsCache.set(host, { address, expiresAt: Date.now() + DNS_TTL_MS });
      return address;
    } catch {
      dnsCache.set(host, { address: null, expiresAt: Date.now() + DNS_TTL_MS });
      return null;
    }
  }
}

// GET /api/servers — list every server we know about, configured plus
// freshly-discovered, each annotated with a live status. The frontend uses
// this to render the server-list screen and its status pills.
//
// Status pills, in priority order:
//   - "active": the configured server currently bound to this Portal.
//   - "online": probe succeeded.
//   - "offline": probe failed (server is configured but not reachable).
//   - "ephemeral-online": ephemeral configured server we re-discovered;
//     same as "online" semantically but lets the UI show a different
//     pill ("relocated to :12345" tooltip etc.).
//   - "discovered": a non-configured running opencode we found. Always
//     online (we wouldn't have detected it otherwise).
//
// Discovery and probing run concurrently — the bottleneck on a quiet
// laptop is one ps invocation plus N probes, all in flight.

export type ServerStatus =
  | "active"
  | "online"
  | "offline"
  | "ephemeral-online"
  | "discovered";

export interface CredLookupSummary {
  state: CredLookupState;
  step?: string;
  message?: string;
  // Only set when state === "succeeded". See CredAuthMode docs in
  // server/lib/cred-lookup.ts for the meaning of each value.
  authMode?: "none" | "discovered" | "manual" | "stored";
}

export interface ServerListEntry {
  id: string;
  label: string;
  host: string;
  port: number;
  // Visible host:port may differ from `host:port` when an ephemeral
  // configured server has been re-discovered to a new endpoint. The
  // registry's stored port becomes a stable handle; liveHost/livePort
  // (when present) is what we actually talk to.
  liveHost?: string;
  livePort?: number;
  // When `host` is a hostname (e.g. opencode.local, desktop.ts.example),
  // this is its current resolved IP address. Surfaced for the UI to
  // show next to the hostname so the user knows WHICH machine on
  // their network the label points at — relevant for mDNS / Tailscale
  // hostnames where the same advertised name can shift between hosts.
  // Unset when host is already an IP or could not be resolved.
  resolvedAddress?: string;
  ephemeral: boolean;
  configured: boolean;
  source:
    | "manual"
    | "discovered-process"
    | "discovered-mdns"
    | "discovered-inspect";
  status: ServerStatus;
  isActive: boolean;
  // Background credential-lookup status for this entry. Lets the UI
  // show "looking up creds via SSH..." spinners without waiting for
  // the user to click anything. NEVER includes the password.
  credLookup?: CredLookupSummary;
  // Extra info shown on hover / for debugging.
  pid?: number;
  cmdline?: string;
}

function isLoopbackHost(host: string): boolean {
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0"
  );
}

async function buildConfiguredEntries(
  configured: ConfiguredServer[],
  activeId: string | null,
): Promise<ServerListEntry[]> {
  return Promise.all(
    configured.map(async (server) => {
      // resolveLiveEndpoint handles ephemeral re-discovery. For
      // non-ephemeral entries it's a cheap pass-through.
      const live = await resolveLiveEndpoint(server);
      const liveHost = live?.host;
      const livePort = live?.port;
      const ok = live
        ? await probeOpencode(live.host, live.port, live.auth)
        : false;
      const isActive = server.id === activeId;
      let status: ServerStatus;
      if (isActive && ok) status = "active";
      else if (ok && server.ephemeral) status = "ephemeral-online";
      else if (ok) status = "online";
      else status = "offline";

      // Cred-lookup hint shown on the card. Resolution order:
      //
      //   1. In-memory cred-lookup cache for live host:port — the
      //      best signal because it reflects what just happened
      //      (probing, succeeded, failed, manually-typed).
      //   2. For ephemeral entries whose live endpoint carries
      //      process-scan auth: synthesize "discovered" because
      //      that's exactly what just happened (we grabbed creds
      //      from env on the live process).
      //   3. Offline non-loopback non-ephemeral servers kick a
      //      background SSH probe and pick up whatever state it
      //      lands in (in-flight if it just started).
      //   4. Reachable servers with an entry in the on-disk
      //      auth-store but no in-memory cred-lookup: synthesize
      //      "stored". This is the post-restart case where the
      //      Portal came back up, the auth file still has the
      //      credentials, but the in-memory state cache is fresh
      //      and empty.
      //   5. Reachable servers with no auth-store entry and no
      //      cred-lookup: synthesize "none". The server didn't
      //      need auth and the resolver got through without
      //      Authorization headers.
      let credLookup: CredLookupSummary | undefined = live
        ? getCredStatusPublic(live.host, live.port)
        : undefined;

      if (!credLookup && server.ephemeral && live?.auth) {
        // Ephemeral re-discovery just harvested fresh credentials
        // for us; that IS a discovery.
        credLookup = { state: "succeeded", authMode: "discovered" };
      }

      if (
        !credLookup &&
        live &&
        !ok &&
        !server.ephemeral &&
        !isLoopbackHost(live.host)
      ) {
        ensureBackgroundCredLookup(live.host, live.port);
        credLookup = getCredStatusPublic(live.host, live.port);
      }

      if (!credLookup && ok) {
        const stored = getAuth(server.id);
        if (stored) {
          credLookup = { state: "succeeded", authMode: "stored" };
        } else if (!server.ephemeral) {
          // Non-ephemeral, online, no stored auth => the server
          // doesn't need auth at all.
          credLookup = { state: "succeeded", authMode: "none" };
        }
      }

      // Show the resolved IP next to the hostname when the host is a
      // name rather than a literal address. For ephemeral entries the
      // live host (after re-discovery) wins over the stored host.
      const displayHost = liveHost ?? server.host;
      const resolvedAddress =
        (await resolveHostAddress(displayHost)) ?? undefined;
      return {
        id: server.id,
        label: server.label,
        host: server.host,
        port: server.port,
        liveHost: liveHost && liveHost !== server.host ? liveHost : undefined,
        livePort: livePort && livePort !== server.port ? livePort : undefined,
        resolvedAddress,
        ephemeral: server.ephemeral,
        configured: true,
        source: "manual",
        status,
        isActive,
        credLookup,
      };
    }),
  );
}

export default defineHandler(async () => {
  const configured = listConfiguredServers();
  const activeId = getActiveServerId();
  const [configuredEntries, discovered] = await Promise.all([
    buildConfiguredEntries(configured, activeId),
    discoverAll(),
  ]);

  // Filter out discovered entries that match an already-configured
  // host:port, so each running opencode shows up exactly once. Configured
  // entries take precedence (they carry user labels).
  const configuredByHostPort = new Set(
    configuredEntries.map((c) => `${c.liveHost ?? c.host}:${c.livePort ?? c.port}`),
  );
  const discoveredEntries: ServerListEntry[] = await Promise.all(
    discovered
      .filter((d) => !configuredByHostPort.has(`${d.host}:${d.port}`))
      .map(async (d) => {
        // Background-probe non-loopback discovered servers so the user's
        // future Add click finds creds ready (or a clear "couldn't get
        // them" state). Skip the proc-scan local entries — they already
        // carry auth from env.
        const remote = !isLoopbackHost(d.host);
        const proc = d.source === "process";
        if (remote && !proc) {
          ensureBackgroundCredLookup(d.host, d.port);
        }

        // Cred-lookup hint resolution order, in order of trust:
        //   1. A cached lookup result (background SSH probe finished
        //      or is in flight). Most accurate.
        //   2. Process-scan auth attached to the discovery entry: this
        //      is the local-loopback case where we read env from
        //      /proc or ps. Synthesize `succeeded + discovered` so the
        //      card shows "Ready to connect - password discovered".
        //   3. Local process scan with no auth in env: synthesize
        //      `succeeded + none` so the card shows "Ready to connect
        //      - instance without password".
        //   4. Nothing (remote mDNS entries during their first scan):
        //      undefined; the UI shows a "looking up" spinner from
        //      the background probe we just kicked off.
        let credLookup = getCredStatusPublic(d.host, d.port);
        if (!credLookup && proc) {
          credLookup = d.auth
            ? { state: "succeeded", authMode: "discovered" }
            : { state: "succeeded", authMode: "none" };
        }

        const resolvedAddress = (await resolveHostAddress(d.host)) ?? undefined;

        return {
          id: d.id,
          label: d.label,
          host: d.host,
          port: d.port,
          resolvedAddress,
          ephemeral: d.discoveryHint?.kind === "opencode-desktop",
          configured: false,
          source: d.source === "process" ? "discovered-process" : "discovered-mdns",
          status: "discovered",
          isActive: false,
          pid: d.pid,
          cmdline: d.cmdline,
          credLookup,
        };
      }),
  );

  // Inspect-pool entries: opencodes the user already had us SSH-probe
  // through the inspect-host flow. We keep them in the Discovered
  // section across polls so the user doesn't lose them when they
  // edit the Host field and the inline inspect-result panel clears.
  // Skip any host:port that's already covered by a Configured or
  // process/mDNS-discovered entry - same precedence rules as the
  // local-vs-mDNS dedup above.
  const seenHostPort = new Set<string>([
    ...configuredEntries.map(
      (c) => `${c.liveHost ?? c.host}:${c.livePort ?? c.port}`,
    ),
    ...discoveredEntries.map((d) => `${d.host}:${d.port}`),
  ]);
  const inspectFindings = listInspectFindings();
  const inspectEntries: ServerListEntry[] = await Promise.all(
    inspectFindings
      .filter((f) => !seenHostPort.has(`${f.host}:${f.port}`))
      .map(async (f) => {
        // Cred hint synthesized from what the pool knows about
        // this finding. Auth present => discovered. Auth absent
        // but needsAuth=true => failed-with-no-creds (rare; SSH
        // saw process but couldn't read env). Auth absent and
        // needsAuth=false => "none" (no password needed).
        const credLookup: CredLookupSummary | undefined = f.auth
          ? { state: "succeeded", authMode: "discovered" }
          : f.needsAuth
            ? { state: "failed", message: "Auth required" }
            : { state: "succeeded", authMode: "none" };
        const resolvedAddress =
          (await resolveHostAddress(f.host)) ?? undefined;
        return {
          id: f.id,
          label: f.label,
          host: f.host,
          port: f.port,
          resolvedAddress,
          ephemeral: false,
          configured: false,
          source: "discovered-inspect",
          status: "discovered",
          isActive: false,
          pid: f.pid,
          credLookup,
        };
      }),
  );

  return {
    activeId,
    servers: [...configuredEntries, ...discoveredEntries, ...inspectEntries],
  };
});
