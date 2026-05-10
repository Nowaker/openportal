import { z } from "zod/v4";
import { defineHandler } from "nitro/h3";
import { lookup as dnsLookup } from "dns/promises";
import { parseBody } from "../lib/validation";
import { probeSshForAllInstances } from "../lib/ssh-creds";
import { probeOpencode } from "../lib/server-discovery";
import { addInspectFinding } from "../lib/inspect-pool";

// POST /api/servers/inspect-host - given just a hostname (or hostname
// + a list of port hints to try), discover every opencode running on
// that machine. The user supplies a host without committing to a
// port; we figure out what's there.
//
// Strategy, in order of decreasing trust:
//
//   1. SSH ps scan. The high-quality source: lists every opencode
//      process with its real port, hostname bind, AND env-harvested
//      credentials. Requires SSH key auth to the host. When this
//      works, we don't need the other sources.
//
//   2. Direct HTTP probes of well-known ports (4096, 4097, 3000)
//      plus any extra ports the user supplied. Catches the case
//      where SSH isn't available but a known opencode is up at a
//      conventional port.
//
// Results carry enough info for the frontend to render an "Add"
// button per discovery: host (always the user-supplied hostname),
// port, label suggestion, and a hint of how we found it. Credentials
// from SSH stay in this response since the frontend will turn around
// and POST them to /api/servers/promote-style add. No credentials
// for HTTP-probe-only results - the user will have to supply those
// via the auth modal.
//
// Time budget: SSH probe gets the standard ~6s; HTTP probes go in
// parallel with a 1.5s per-port cap. Total roughly 7s worst case.

const PROBE_TIMEOUT_MS = 1500;
const WELL_KNOWN_PORTS = [4096, 4097, 3000];

const schema = z.object({
  host: z.string().min(1).max(255),
  // Caller may pass `extraPorts: [27000, 5000]` to probe in addition
  // to the well-known list. Used when the user has a rough idea of
  // where opencode lives. Out-of-band hints; not required.
  extraPorts: z.array(z.int().min(1).max(65535)).optional(),
});

export interface InspectFinding {
  port: number;
  label: string;
  // How we found this entry. Surfaced for the UI so the user knows
  // whether SSH is involved (and credentials will be auto-attached
  // on Add) or it's a port-probe (they'll need to provide auth).
  source: "ssh" | "http-probe";
  // Whether the server requires authentication. From SSH: derived
  // from whether env had OPENCODE_SERVER_PASSWORD. From HTTP probe:
  // derived from whether the no-auth /config/providers call got 200.
  needsAuth: boolean;
  // SSH-source entries with creds carry them through. Never present
  // on http-probe entries. The client posts these to
  // /api/servers/promote-style endpoints which validate before
  // persisting.
  username?: string;
  password?: string;
  // Misc info shown in the UI for diagnostic purposes.
  pid?: number;
  boundHost?: string;
}

export interface InspectResult {
  host: string;
  // Resolved IP for the host. null = couldn't resolve (probably a
  // bad hostname; we still tried the probes against the raw input).
  resolvedAddress: string | null;
  ssh: {
    attempted: boolean;
    ok: boolean;
    // SshProbeStep when failed; "skipped" if we didn't bother (no
    // host resolution / loopback / explicit skip).
    step?: string;
    message?: string;
    elapsedMs?: number;
  };
  findings: InspectFinding[];
  elapsedMs: number;
}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6_RE = /^[0-9a-f:]+$/i;

function isIpLiteral(host: string): boolean {
  return IPV4_RE.test(host) || IPV6_RE.test(host);
}

async function resolveHost(host: string): Promise<string | null> {
  if (isIpLiteral(host)) return host;
  if (host === "localhost") return "127.0.0.1";
  try {
    const { address } = await dnsLookup(host, { family: 4 });
    return address;
  } catch {
    return null;
  }
}

export default defineHandler(async (event) => {
  const startedAt = Date.now();
  const body = await parseBody(event, schema);
  const host = body.host.trim();

  const resolvedAddress = await resolveHost(host);

  // Kick the SSH inspect and the well-known-port HTTP probes in
  // parallel. Both bounded by their own internal timeouts; the
  // handler waits for both then returns the merged findings.
  const sshPromise = probeSshForAllInstances(host);

  const ports = Array.from(
    new Set([...WELL_KNOWN_PORTS, ...(body.extraPorts ?? [])]),
  );
  const httpProbes = await Promise.all(
    ports.map(async (port) => {
      const ok = await probeOpencode(host, port, undefined, PROBE_TIMEOUT_MS);
      return { port, ok };
    }),
  );

  const sshOutcome = await sshPromise;

  // Build the findings list. SSH wins on overlap: if SSH found an
  // instance on a given port AND the HTTP probe also surfaced it,
  // we keep the SSH version (it carries credentials).
  const seenPorts = new Set<number>();
  const findings: InspectFinding[] = [];

  if (sshOutcome.ok) {
    for (const inst of sshOutcome.instances) {
      if (seenPorts.has(inst.port)) continue;
      seenPorts.add(inst.port);
      const finding: InspectFinding = {
        port: inst.port,
        label: `opencode-${inst.port}`,
        source: "ssh",
        needsAuth: Boolean(inst.username || inst.password),
        username: inst.username,
        password: inst.password,
        pid: inst.pid,
        boundHost: inst.boundHost,
      };
      findings.push(finding);
      // Add to the cross-request inspect pool so the Discovered
      // section in /api/servers surfaces it on subsequent polls.
      // Auth lives in the pool (server-side); never sent to the
      // client.
      addInspectFinding({
        host,
        port: inst.port,
        label: finding.label,
        source: "ssh",
        needsAuth: finding.needsAuth,
        auth:
          inst.username && inst.password
            ? { username: inst.username, password: inst.password }
            : undefined,
        pid: inst.pid,
        boundHost: inst.boundHost,
      });
    }
  }

  for (const { port, ok } of httpProbes) {
    if (!ok) continue;
    if (seenPorts.has(port)) continue;
    seenPorts.add(port);
    const finding: InspectFinding = {
      port,
      label: `opencode-${port}`,
      source: "http-probe",
      needsAuth: false, // Probe passed without auth => no auth needed.
    };
    findings.push(finding);
    addInspectFinding({
      host,
      port,
      label: finding.label,
      source: "http-probe",
      needsAuth: false,
    });
  }

  // If the HTTP probes returned 401 we can't tell that just from
  // probeOpencode (it returns false either way). The SSH source
  // covers auth-protected servers when available; if neither path
  // finds anything, we report empty findings and the UI surfaces
  // it as "nothing found - is opencode running here?".

  const elapsedMs = Date.now() - startedAt;
  const result: InspectResult = {
    host,
    resolvedAddress,
    ssh: sshOutcome.ok
      ? {
          attempted: true,
          ok: true,
          step: sshOutcome.step,
          message: sshOutcome.message,
          elapsedMs: sshOutcome.elapsedMs,
        }
      : {
          attempted: true,
          ok: false,
          step: sshOutcome.step,
          message: sshOutcome.message,
          elapsedMs: sshOutcome.elapsedMs,
        },
    findings,
    elapsedMs,
  };
  return result;
});
