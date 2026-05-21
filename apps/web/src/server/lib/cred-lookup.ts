// Per-host:port credential-lookup state machine.
//
// Surfaces in /api/servers as a non-blocking field so the UI can show
// a spinner while we probe over SSH. Lifecycle:
//
//   idle           -> initial / never started
//   probing-http   -> HTTP probe in flight
//   needs-auth     -> server returned 401, we'll try SSH next
//   probing-ssh    -> SSH probe in flight
//   succeeded      -> we have valid creds (validated against the server)
//   failed         -> tried everything, user input required
//
// Why this state isn't part of the server registry: registry is
// disk-persisted and a probe lifecycle is per-process. A new Portal
// startup re-probes everything; cached results don't survive restart.
// (Persisting "creds at host:port were rejected last time" is a
// footgun — the server's auth might have rotated.)
//
// The cache is keyed by `host:port` rather than a synthetic id so the
// background-probe path (kicked off when /api/servers lists discovered
// entries) and the user-driven path (after they click Add) share state
// even though they don't share an id.

import {
  basicAuthHeader,
  probeOpencode,
  type BasicAuthCreds,
} from "./server-discovery";
import { probeSshForCreds, type SshProbeStep } from "./ssh-creds";
import { probeOpencodeDetailed } from "./server-discovery";
import { listConfiguredServers } from "./server-registry";
import { setAuth } from "./auth-store";
import { invalidateLiveEndpoint } from "./server-resolver";

export type CredLookupState =
  | "idle"
  | "probing-http"
  | "needs-auth"
  | "probing-ssh"
  | "succeeded"
  | "failed";

// On `succeeded`, how did we get to ready-to-connect? Drives the
// copy on the card:
//   none       - server doesn't require auth (HTTP probe returned 200
//                with no Authorization header)
//   discovered - we harvested credentials via the SSH probe and they
//                validated against the server
//   manual     - the user supplied credentials through the auth modal
//                and we validated them
//   stored     - synthesized at list-time when there's an entry in
//                the on-disk auth-store but no in-memory cred-lookup
//                cache (typical after a Portal restart). We trust the
//                stored auth and report it as "saved" so the user
//                knows the password is on file even though no probe
//                ran this session.
// Not meaningful for non-success states.
export type CredAuthMode = "none" | "discovered" | "manual" | "stored";

export interface CredLookupStatus {
  state: CredLookupState;
  // Sub-step for the UI to surface in the status box. For HTTP probing
  // this might be "Probing http://host:port"; for SSH probing it
  // matches SshProbeStep.
  step?: string | SshProbeStep;
  message?: string;
  // Set on `succeeded`; never serialised to clients of /api/servers
  // (the client never needs the password directly — the proxy holds it).
  creds?: BasicAuthCreds;
  // Set on `succeeded` only.
  authMode?: CredAuthMode;
  // Last update timestamp (ms since epoch). Lets the UI show a "last
  // tried Xs ago" hint if it wants.
  updatedAt: number;
}

const cache = new Map<string, CredLookupStatus>();
const inflight = new Map<string, Promise<CredLookupStatus>>();

function key(host: string, port: number): string {
  return `${host}:${port}`;
}

export function getCredStatus(
  host: string,
  port: number,
): CredLookupStatus | undefined {
  return cache.get(key(host, port));
}

// Public, redacted view: never includes the password. Used by the
// /api/servers list endpoint.
export function getCredStatusPublic(
  host: string,
  port: number,
): {
  state: CredLookupState;
  step?: string;
  message?: string;
  authMode?: CredAuthMode;
} | undefined {
  const s = cache.get(key(host, port));
  if (!s) return undefined;
  return {
    state: s.state,
    step: s.step,
    message: s.message,
    authMode: s.authMode,
  };
}

function set(
  host: string,
  port: number,
  patch: Partial<CredLookupStatus> & { state: CredLookupState },
): CredLookupStatus {
  const next: CredLookupStatus = {
    ...(cache.get(key(host, port)) ?? {}),
    ...patch,
    updatedAt: Date.now(),
  };
  cache.set(key(host, port), next);
  return next;
}

export function clearCredStatus(host: string, port: number): void {
  cache.delete(key(host, port));
  inflight.delete(key(host, port));
}

interface RunOptions {
  // SSH overrides supplied by the user via the manual "Try SSH"
  // panel — username (login), password (when key auth fails).
  sshUser?: string;
  sshPassword?: string;
  // If true: skip the HTTP probe and go straight to SSH. Used when the
  // user explicitly hit a "Probe via SSH" button after we already
  // detected a 401 on a previous run.
  forceSsh?: boolean;
}

async function runProbe(
  host: string,
  port: number,
  options: RunOptions,
): Promise<CredLookupStatus> {
  // Step 1: HTTP probe with no auth. Tri-state: success = no auth
  // needed; auth-required (401/403) = move to SSH; unreachable / other
  // = bail out with an honest 'server unreachable' rather than SSH-ing
  // in to look for credentials of a process that isn't running.
  if (!options.forceSsh) {
    set(host, port, {
      state: "probing-http",
      step: `Probing http://${host}:${port}`,
    });
    const result = await probeOpencodeDetailed(host, port);
    if (result.ok) {
      return set(host, port, {
        state: "succeeded",
        step: "Server does not require authentication.",
        creds: undefined,
        authMode: "none",
      });
    }
    if (result.reason === "unreachable") {
      return set(host, port, {
        state: "failed",
        step: "unreachable",
        message: `Server at ${host}:${port} is unreachable. Is OpenCode running there? Skipping SSH credential probe.`,
      });
    }
    if (result.reason === "other") {
      return set(host, port, {
        state: "failed",
        step: "unreachable",
        message: `Server at ${host}:${port} returned HTTP ${result.status} (expected 200 or 401). Not running OpenCode? Skipping SSH credential probe.`,
      });
    }
    // Falls through to SSH only for auth-required (401/403).
  }

  // Step 2: 401 (or forced). Try SSH.
  set(host, port, {
    state: "needs-auth",
    step: "Server requires authentication. Trying SSH to fetch credentials\u2026",
  });

  // If the user supplied an SSH password, switch to password auth; ssh
  // still tries publickey first by default, so we explicitly disable
  // that mode and use sshpass-style password feeding via SSH_ASKPASS.
  // Important: we don't have sshpass on every system. The simpler path
  // we ship is: if the user gave a password, refuse password-less
  // auth and surface a clear "install sshpass" message. For the home-
  // LAN / SSH-key case this is irrelevant; the typical path is "key
  // auth Just Works".
  const sshExtraOptions: Record<string, string> = {};
  if (options.sshPassword) {
    // Only public-key + keyboard-interactive supported reliably without
    // an extra dep. Tell the user to set up an SSH key — better UX than
    // silent fall-through.
    return set(host, port, {
      state: "failed",
      step: "ssh-rejected",
      message:
        "SSH password auth from inside the Portal isn't supported yet — copy your SSH public key to the remote (`ssh-copy-id`) and try again, or paste the opencode password manually below.",
    });
  }

  set(host, port, {
    state: "probing-ssh",
    step: "Connecting over SSH\u2026",
  });
  const sshOutcome = await probeSshForCreds(host, {
    user: options.sshUser,
    extraOptions: sshExtraOptions,
  });
  if (!sshOutcome.ok) {
    return set(host, port, {
      state: "failed",
      step: sshOutcome.step,
      message: sshOutcome.message,
    });
  }

  // Step 3: validate the creds we got against the actual HTTP endpoint.
  // Belt-and-braces: SSH might have given us creds for a stopped
  // opencode, or there could be two opencodes on the same machine with
  // different creds.
  set(host, port, {
    state: "probing-http",
    step: "Validating credentials against the server\u2026",
  });
  const creds: BasicAuthCreds = {
    username: sshOutcome.username!,
    password: sshOutcome.password!,
  };
  const okWithCreds = await probeOpencode(host, port, creds);
  if (!okWithCreds) {
    return set(host, port, {
      state: "failed",
      step: "validation-failed",
      message:
        "Got credentials over SSH but the server rejected them. The server may have rotated its credentials since SSH read them.",
    });
  }
  // Auto-persist the validated creds to the auth-store IF this host:port
  // already maps to a configured (non-ephemeral) server. The user
  // doesn't have to click anything; their next /api/servers refresh
  // shows the server as `online`. Discovered (not yet configured)
  // entries still need promotion — promote.post.ts reads this same
  // cache and writes auth on its way through.
  const configuredMatch = listConfiguredServers().find(
    (s) => !s.ephemeral && s.host === host && s.port === port,
  );
  if (configuredMatch) {
    try {
      setAuth(configuredMatch.id, creds);
      invalidateLiveEndpoint(configuredMatch.id);
    } catch (e) {
      // Persisting failed, e.g. disk-full. The in-memory cache still
      // has the creds; user can retry via the modal.
      console.warn(
        `[cred-lookup] Could not persist auth for ${configuredMatch.id}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return set(host, port, {
    state: "succeeded",
    step: "Got credentials and validated.",
    creds,
    authMode: "discovered",
  });
}

// Kick off (or join an in-flight) probe for the given host:port.
// Returns the eventual outcome. Multiple concurrent calls share a
// single SSH attempt — important because /api/servers is polled every
// few seconds and we don't want to stack probes.
export function startCredLookup(
  host: string,
  port: number,
  options: RunOptions = {},
): Promise<CredLookupStatus> {
  const k = key(host, port);
  const existing = inflight.get(k);
  if (existing) return existing;
  const p = runProbe(host, port, options).finally(() => {
    inflight.delete(k);
  });
  inflight.set(k, p);
  return p;
}

// Fire-and-forget: kicks off a probe if we don't already have a
// terminal result. Used by the listing endpoint so the UI's first
// click on Add finds the answer waiting.
export function ensureBackgroundCredLookup(host: string, port: number): void {
  const k = key(host, port);
  if (inflight.has(k)) return;
  const cur = cache.get(k);
  if (cur && (cur.state === "succeeded" || cur.state === "failed")) return;
  // Discard the returned promise; the caller doesn't await — this is
  // intentional, the result lands in the cache for the next /api/servers
  // poll to pick up.
  void startCredLookup(host, port);
}

// Used when `addServer` accepts creds (manual add flow) — drop the
// stale "needs-auth" or "failed" cache entry so a follow-up GET shows
// the expected `succeeded` state without waiting for the next probe.
export function recordKnownGoodCreds(
  host: string,
  port: number,
  creds: BasicAuthCreds,
): void {
  set(host, port, {
    state: "succeeded",
    step: "Manually supplied credentials.",
    creds,
    message: undefined,
    authMode: "manual",
  });
}

export function basicAuthHeaderFromStatus(
  host: string,
  port: number,
): Record<string, string> {
  const s = cache.get(key(host, port));
  if (!s?.creds) return {};
  return basicAuthHeader(s.creds);
}
