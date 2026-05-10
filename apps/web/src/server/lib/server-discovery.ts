// Server discovery. Two sources today:
//
//   1. Process scan. Fast, dependency-free, works for any opencode running
//      locally — including the one spawned by opencode-desktop, which
//      picks an ephemeral 127.0.0.1 port on every relaunch and has no
//      portfile we could read.
//
//   2. mDNS. Opencode advertises generic `_http._tcp.local` with instance
//      name `opencode-<port>` when started with `--mdns` (or the desktop
//      app's network mode). Picks up other people's opencode instances
//      on the same LAN / Tailscale / VPN. Never fires for the desktop
//      sidecar in default loopback mode (verified in its logs).
//
// Both sources return entries shaped like `DiscoveredServer` so the
// frontend can display them uniformly. Results are NOT persisted; the
// caller re-runs discovery on every list call. Promotion to a configured
// server happens via the registry API.

import { exec, spawn } from "child_process";
import { promisify } from "util";
import type { DiscoveryHint } from "./server-registry";

const execAsync = promisify(exec);

export interface BasicAuthCreds {
  username: string;
  password: string;
}

export interface DiscoveredServer {
  // Synthetic ID derived from source + host:port. Stable for the same
  // running process; allows the UI to do React keying without flicker.
  id: string;
  source: "process" | "mdns";
  host: string;
  port: number;
  label: string;
  // Provenance hint that makes this server re-findable after a
  // restart-with-different-port. Carried through to a configured entry on
  // promotion.
  discoveryHint?: DiscoveryHint;
  // HTTP Basic credentials when the server requires auth. opencode-desktop
  // generates per-launch random credentials and passes them to the
  // spawned sidecar via OPENCODE_SERVER_USERNAME / OPENCODE_SERVER_PASSWORD
  // env vars. We harvest them off the running process so the Portal can
  // reach the sidecar without extra config from the user.
  auth?: BasicAuthCreds;
  // Extra info shown in the UI to help disambiguate. Best-effort.
  pid?: number;
  cmdline?: string;
}

// Match opencode-cli serve invocations. We extract --hostname and --port
// directly from the cmdline; opencode-cli always passes both as flags
// (verified against /Applications/OpenCode.app/Contents/MacOS/opencode-cli
// and `opencode serve` in the homebrew tap).
const OPENCODE_DESKTOP_BINARY = "/Applications/OpenCode.app/Contents/MacOS/opencode-cli";

interface PsLine {
  pid: number;
  command: string;
}

async function listPsLines(): Promise<PsLine[]> {
  // -ww disables truncation; without it `ps` clips the cmdline at terminal
  // width and we lose --port.
  try {
    const { stdout } = await execAsync("ps -axww -o pid=,command=", {
      maxBuffer: 8 * 1024 * 1024,
    });
    const out: PsLine[] = [];
    for (const raw of stdout.split("\n")) {
      const line = raw.trimEnd();
      if (!line) continue;
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      if (!Number.isFinite(pid)) continue;
      out.push({ pid, command: m[2] });
    }
    return out;
  } catch (e) {
    console.warn(
      `[server-discovery] ps failed:`,
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

function extractFlag(cmdline: string, flag: string): string | null {
  // Tolerates both `--flag value` and `--flag=value` forms. opencode-cli
  // uses the space form today but be liberal in what we accept.
  const eq = new RegExp(`${flag}=([^\\s]+)`).exec(cmdline);
  if (eq) return eq[1];
  const sp = new RegExp(`${flag}\\s+([^\\s]+)`).exec(cmdline);
  if (sp) return sp[1];
  return null;
}

function isOpencodeServeLine(cmd: string): boolean {
  // The cmdline of an actual opencode process starts with the binary path
  // (or a node interpreter wrapping it). Two real-world shapes:
  //
  //   /Applications/OpenCode.app/Contents/MacOS/opencode-cli ... serve ...
  //   /opt/homebrew/opt/node/bin/node /opt/homebrew/bin/opencode ... serve ...
  //   /opt/homebrew/Cellar/opencode/1.14.40/.../bin/opencode ... serve ...
  //
  // Tightened over an earlier permissive regex that matched ANY shell
  // command containing the words "opencode" and "serve" — caught e.g.
  // a `bash -c "... opencode serve ..."` parent of a build script. We
  // now require either:
  //   (a) the cmdline START to be (or contain) an opencode-* binary, OR
  //   (b) the cmdline to be `<node> <path-to-opencode> ... serve ...`
  //       where the second token's basename is `opencode`.
  if (!/\bserve\b/.test(cmd)) return false;
  const firstToken = cmd.split(/\s+/)[0] ?? "";
  const firstBase = firstToken.split("/").pop() ?? "";
  if (/^opencode(?:-cli)?$/.test(firstBase)) return true;
  // node wrapper: second token is the actual JS entrypoint, e.g.
  // /opt/homebrew/bin/opencode. basename must be exactly "opencode".
  if (/^node$/.test(firstBase)) {
    const secondToken = cmd.split(/\s+/)[1] ?? "";
    const secondBase = secondToken.split("/").pop() ?? "";
    if (secondBase === "opencode") return true;
  }
  return false;
}

function classifyHint(cmd: string): DiscoveryHint | undefined {
  if (cmd.startsWith(OPENCODE_DESKTOP_BINARY)) {
    return { kind: "opencode-desktop" };
  }
  return undefined;
}

function labelFor(hint: DiscoveryHint | undefined, host: string, port: number): string {
  // Labels are just human-friendly names. The card layout always
  // renders the host:port on its own line, so embedding it in the
  // label too would just be visual repetition. `host`/`port` are
  // still kept as arguments so future labelling rules can use them
  // (e.g. "opencode-desktop (Tailscale)") without changing the
  // call sites.
  void host;
  void port;
  if (hint?.kind === "opencode-desktop") return "OpenCode Desktop";
  return "opencode";
}

function syntheticId(source: string, host: string, port: number): string {
  return `disc-${source}-${host.replace(/[^a-z0-9]/gi, "_")}-${port}`;
}

// Read the env of a running process via `ps eww`. macOS supports this when
// the env-reader is the same uid as the target process (always true for our
// own opencode-desktop session). Linux supports it too. Returns an empty
// map on any failure — auth-less probe is a downgrade, not a hard error.
async function readProcessEnv(pid: number): Promise<Record<string, string>> {
  try {
    const { stdout } = await execAsync(`ps eww -p ${pid} -o command=`, {
      maxBuffer: 4 * 1024 * 1024,
    });
    const out: Record<string, string> = {};
    // ps prints the cmdline followed by env vars, all space-separated.
    // Anything that looks like KEY=VALUE we treat as env.
    for (const tok of stdout.split(/\s+/)) {
      const eq = tok.indexOf("=");
      if (eq <= 0) continue;
      const k = tok.slice(0, eq);
      // Env keys are conventionally [A-Z_][A-Z0-9_]*; filter so we don't
      // pick up flag-style tokens like --foo=bar or paths with `=` in them.
      if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) continue;
      out[k] = tok.slice(eq + 1);
    }
    return out;
  } catch {
    return {};
  }
}

async function readBasicAuthForPid(
  pid: number,
): Promise<BasicAuthCreds | undefined> {
  const env = await readProcessEnv(pid);
  const username = env.OPENCODE_SERVER_USERNAME;
  const password = env.OPENCODE_SERVER_PASSWORD;
  if (!username || !password) return undefined;
  return { username, password };
}

// `0.0.0.0` and `::` are bind addresses, not destination addresses. Show
// the user something they can actually click. For loopback all-interfaces
// binds we present `127.0.0.1`; if the user wants the LAN IP they can
// reach the server via mDNS or by configuring it manually.
function normalizeListenHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") return "127.0.0.1";
  return host;
}

// Best-effort lookup of the TCP port a pid is listening on. Used as a
// fallback when `opencode serve` was invoked without `--port` (opencode
// picks an ephemeral port internally, the kernel assigns it, and there
// is no cmdline hint). `lsof -P -n -i -a -p <pid>` lists every socket
// owned by that pid; we filter to LISTEN-state TCP and pick the first.
// macOS and Linux both ship lsof; we return null on any failure so the
// caller can decide to drop the entry.
async function readListeningPortForPid(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `lsof -P -n -iTCP -sTCP:LISTEN -a -p ${pid}`,
      { maxBuffer: 1 * 1024 * 1024 },
    );
    // Output rows look like:
    //   node 35332 nowaker  21u  IPv4  ...  TCP 127.0.0.1:34883 (LISTEN)
    // We want the port after the last colon on a LISTEN line.
    for (const raw of stdout.split("\n")) {
      const line = raw.trimEnd();
      if (!line || !line.includes("LISTEN")) continue;
      const m = /\b\d+\.\d+\.\d+\.\d+:(\d+)\b/.exec(line)
        ?? /\]:(\d+)\b/.exec(line);
      if (!m) continue;
      const port = parseInt(m[1], 10);
      if (Number.isFinite(port) && port > 0 && port < 65536) return port;
    }
    return null;
  } catch {
    return null;
  }
}

export async function discoverByProcessScan(): Promise<DiscoveredServer[]> {
  const lines = await listPsLines();
  const candidates: { pid: number; command: string }[] = [];
  for (const { pid, command } of lines) {
    if (isOpencodeServeLine(command)) candidates.push({ pid, command });
  }
  // Resolve auth + (when needed) lsof port lookups concurrently.
  // Both are independent per-pid operations; serial wait would
  // multiply latency.
  const [auths, fallbackPorts] = await Promise.all([
    Promise.all(candidates.map((c) => readBasicAuthForPid(c.pid))),
    Promise.all(
      candidates.map(async (c) => {
        // Only do the lsof lookup if --port isn't on the cmdline.
        // The common case is --port present and we skip lsof entirely.
        if (extractFlag(c.command, "--port")) return null;
        return readListeningPortForPid(c.pid);
      }),
    ),
  ]);
  const out: DiscoveredServer[] = [];
  candidates.forEach(({ pid, command }, i) => {
    let port: number | null = null;
    const portStr = extractFlag(command, "--port");
    if (portStr) {
      const parsed = parseInt(portStr, 10);
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) {
        port = parsed;
      }
    } else {
      port = fallbackPorts[i];
    }
    if (port === null) return;
    const rawHost = extractFlag(command, "--hostname") ?? "127.0.0.1";
    const host = normalizeListenHost(rawHost);
    const hint = classifyHint(command);
    out.push({
      id: syntheticId("proc", host, port),
      source: "process",
      host,
      port,
      label: labelFor(hint, host, port),
      discoveryHint: hint,
      auth: auths[i],
      pid,
      cmdline: command,
    });
  });
  // De-dup on host:port (a proc may appear twice when an npm wrapper
  // spawns a child opencode binary; both have full cmdlines with --port).
  // The first wins; we don't try to pick the "real" pid.
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.host}:${s.port}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// mDNS discovery for opencode servers on the local network.
//
// What opencode actually advertises (verified against `opencode serve
// --mdns --mdns-domain opencode.local` on this machine): generic
// `_http._tcp.local` service type, instance name `opencode-<port>`, SRV
// target = the user-configured mDNS domain (default `opencode.local`),
// TXT `path=/`. NOT a custom `_opencode._tcp` type, despite what the
// initial guess in this file said.
//
// Strategy: shell out to the OS's native mDNS browser, time-bound the
// scan, parse instances whose name starts with `opencode-`. We use the
// SRV target hostname directly (e.g. `opencode.local`) because both
// macOS (via mDNSResponder) and Linux (via libnss-mdns / nss_mdns_minimal)
// resolve it through standard hostname lookups — fetch() to
// `http://opencode.local:14096/...` Just Works.
//
// Why shell out instead of bundling an mDNS lib: dns-sd / avahi-browse
// are present out of the box on every supported platform, the parser
// is ~50 lines of regex, and we avoid a native-binding dep that has
// to be rebuilt per Node/Bun ABI version. We don't need to advertise,
// only browse + resolve, which is the easy half.
//
// The desktop-sidecar case is NOT covered by this — it binds to
// loopback and explicitly skips mDNS publish (verified in its logs).
// That's why process scan exists alongside this. The two sources are
// merged in discoverAll().

const MDNS_BROWSE_TIMEOUT_MS = 1500;

interface MdnsBrowseResult {
  instanceName: string;
  host: string;
  port: number;
}

async function runWithTimeout(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolveP) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let settled = false;
    const settle = (s: string) => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // already dead
      }
      resolveP(s);
    };
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", () => settle(out));
    child.on("close", () => settle(out));
    setTimeout(() => settle(out), timeoutMs);
  });
}

// macOS: parse `dns-sd -Z _http._tcp local` zone-file output. Records
// come in three lines per instance: PTR (browse), SRV (port + target
// host), TXT. We pair PTR + SRV per instance name, ignore everything
// else.
function parseDnsSdZone(output: string): MdnsBrowseResult[] {
  const srvByName = new Map<string, { port: number; host: string }>();
  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    // Match e.g. "opencode-14096._http._tcp     SRV     0 0 14096 opencode.local. ; Replace ..."
    const m = /^(\S+?)\._http\._tcp\s+SRV\s+\d+\s+\d+\s+(\d+)\s+(\S+?)\.\s*(?:;.*)?$/.exec(
      line,
    );
    if (!m) continue;
    const instance = m[1].replace(/\\032/g, " ");
    const port = parseInt(m[2], 10);
    if (!Number.isFinite(port)) continue;
    const host = m[3];
    srvByName.set(instance, { port, host });
  }
  const results: MdnsBrowseResult[] = [];
  for (const [name, ep] of srvByName) {
    results.push({ instanceName: name, host: ep.host, port: ep.port });
  }
  return results;
}

// Linux: avahi-browse -ptr emits one line per resolved record:
//   =;<iface>;<proto>;<name>;<type>;<domain>;<host>;<address>;<port>;<txt>
// The leading `=` indicates a fully-resolved record; other markers (+, -)
// are add/remove notifications and we ignore them. Names containing `;`
// or escaped sequences are best-effort decoded.
function parseAvahiBrowse(output: string): MdnsBrowseResult[] {
  const results: MdnsBrowseResult[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.startsWith("=;")) continue;
    const cols = line.split(";");
    if (cols.length < 9) continue;
    const name = cols[3].replace(/\\032/g, " ");
    const host = cols[6];
    const port = parseInt(cols[8], 10);
    if (!Number.isFinite(port)) continue;
    results.push({ instanceName: name, host, port });
  }
  return results;
}

async function browseLocalMdns(): Promise<MdnsBrowseResult[]> {
  if (process.platform === "darwin") {
    const out = await runWithTimeout(
      "dns-sd",
      ["-Z", "_http._tcp", "local"],
      MDNS_BROWSE_TIMEOUT_MS,
    );
    if (!out) return [];
    return parseDnsSdZone(out);
  }
  // Linux + others: try avahi-browse if it's installed. -p = parseable,
  // -t = terminate after listing existing services (instead of streaming
  // forever), -r = resolve in same pass.
  const out = await runWithTimeout(
    "avahi-browse",
    ["-ptr", "_http._tcp"],
    MDNS_BROWSE_TIMEOUT_MS,
  );
  if (!out) return [];
  return parseAvahiBrowse(out);
}

export async function discoverByMdns(): Promise<DiscoveredServer[]> {
  let raw: MdnsBrowseResult[] = [];
  try {
    raw = await browseLocalMdns();
  } catch {
    // mDNS browser not installed (no avahi on a stripped Linux server,
    // for example). Empty discovery is the correct no-op.
    return [];
  }
  // Filter to instance names that look like opencode advertisements.
  // The convention used by `opencode serve --mdns` is `opencode-<port>`;
  // we also accept anything resolving to `opencode.local`-style hosts
  // for forward-compat with future naming changes.
  const filtered = raw.filter(
    (r) =>
      r.instanceName.toLowerCase().startsWith("opencode-") ||
      /\bopencode[\w.-]*\.local\.?$/i.test(r.host),
  );
  // Drop stable IDs collisions (multiple network interfaces can each
  // re-announce the same instance).
  const seen = new Set<string>();
  const out: DiscoveredServer[] = [];
  for (const r of filtered) {
    const key = `${r.host}:${r.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: syntheticId("mdns", r.host, r.port),
      source: "mdns",
      host: r.host.replace(/\.$/, ""),
      port: r.port,
      // Instance name as the label. Same reasoning as labelFor():
      // the host:port has its own line in the card; the label stays
      // just the friendly identifier the server advertised.
      label: r.instanceName,
      // mDNS-discovered opencodes are "stable enough" — their hostname
      // doesn't change across restarts even when the port might. We
      // still mark `ephemeral: false` because re-discovery for them is
      // a different mechanism (re-browse mDNS) than the desktop sidecar
      // case (re-scan ps + harvest env). If a user's mDNS opencode
      // shifts ports they can re-promote.
    });
  }
  return out;
}

export async function discoverAll(): Promise<DiscoveredServer[]> {
  const [byProc, byMdns] = await Promise.all([
    discoverByProcessScan(),
    discoverByMdns(),
  ]);
  // Merge with process scan taking precedence over mDNS for the SAME
  // opencode. Two-tier dedup:
  //   1. exact host:port match across sources
  //   2. mDNS dropped when an all-interfaces process scan exists on
  //      the same port — mDNS would have picked up our local opencode
  //      via its LAN-routable hostname, and we already have the auth
  //      via process env. Showing both adds noise.
  // mDNS opencodes on OTHER machines are kept (no proc entry shadows
  // them) so the user still sees them. Connecting to those will require
  // manual auth (future feature).
  const procPorts = new Set(byProc.map((s) => s.port));
  const seen = new Set<string>();
  const out: DiscoveredServer[] = [];
  for (const s of byProc) {
    const k = `${s.host}:${s.port}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  for (const s of byMdns) {
    const k = `${s.host}:${s.port}`;
    if (seen.has(k)) continue;
    if (procPorts.has(s.port)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// Quick reachability + protocol check. opencode's /config/providers is
// served only by an actual opencode and is cheap. Same probe used by the
// CLI's externalOpencode resilience watchdog. 1.5s default — tight enough
// to keep the server-list page responsive when probing many servers in
// parallel, generous enough to survive a momentarily-busy localhost.
export function basicAuthHeader(
  auth: BasicAuthCreds | undefined,
): Record<string, string> {
  if (!auth) return {};
  const token = Buffer.from(`${auth.username}:${auth.password}`).toString(
    "base64",
  );
  return { Authorization: `Basic ${token}` };
}

export async function probeOpencode(
  host: string,
  port: number,
  auth?: BasicAuthCreds,
  timeoutMs = 1500,
): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${host}:${port}/config/providers`, {
      signal: ctrl.signal,
      headers: basicAuthHeader(auth),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// Re-discovery for ephemeral servers. Given a configured server marked
// ephemeral with a discoveryHint, scan the live process table and return
// the new live host:port plus credentials. If nothing matches, returns
// null and the caller should surface a "server gone" status rather than
// mutating the registry. The auth is returned alongside because
// opencode-desktop generates fresh credentials on every relaunch — they
// MUST be re-read from the new sidecar's env, not cached from the old.
export async function rediscoverEphemeral(
  hint: DiscoveryHint | undefined,
): Promise<
  { host: string; port: number; auth?: BasicAuthCreds } | null
> {
  if (!hint) return null;
  const live = await discoverByProcessScan();
  const match = live.find((s) => s.discoveryHint?.kind === hint.kind);
  if (!match) return null;
  return { host: match.host, port: match.port, auth: match.auth };
}
