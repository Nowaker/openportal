#!/usr/bin/env bun

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "fs";
import { getPort } from "get-port-please";
import { homedir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(homedir(), ".portal.json");
const CONFIG_LOCK_PATH = `${CONFIG_PATH}.lock`;
const OPENPORTAL_CONFIG_PATH = join(homedir(), ".openportal.json");
const DEFAULT_HOSTNAME = "0.0.0.0";
const DEFAULT_PORT = 3000;
const DEFAULT_OPENCODE_PORT = 4000;

const WEB_SERVER_PATH = join(__dirname, "..", "web", "server", "index.mjs");

interface PortalInstance {
  id: string;
  name: string;
  directory: string;
  port: number | null;
  opencodePort: number;
  hostname: string;
  opencodePid: number | null;
  webPid: number | null;
  startedAt: string;
  attachedOpencode?: boolean;
}

interface PortalConfig {
  instances: PortalInstance[];
}

function readConfig(): PortalConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      config.instances = config.instances.map((instance: PortalInstance) => ({
        ...instance,
        opencodePid: instance.opencodePid ?? null,
        webPid: instance.webPid ?? null,
      }));
      return config;
    }
  } catch (error) {
    console.warn(
      `[config] Failed to read config file, using empty config:`,
      error instanceof Error ? error.message : error,
    );
  }
  return { instances: [] };
}

function writeConfig(config: PortalConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Acquire an exclusive advisory lock on ~/.portal.json by atomically creating
// ~/.portal.json.lock with O_CREAT|O_EXCL ('wx' in Node). Stores the holder's
// pid so a subsequent caller can detect and steal a stale lock left behind by
// a process that crashed before releasing it.
function acquireConfigLock(timeoutMs = 30_000): () => void {
  const start = Date.now();
  // 50ms initial backoff, capped at 250ms.
  let backoff = 50;
  while (true) {
    try {
      const fd = openSync(CONFIG_LOCK_PATH, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(CONFIG_LOCK_PATH);
        } catch {
          // Already removed (e.g. by a stale-lock stealer); not our problem.
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (tryStealStaleLock()) continue;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Could not acquire ${CONFIG_LOCK_PATH} within ${timeoutMs}ms.`,
        );
      }
      // Synchronous sleep; CLI is single-threaded and we want simple semantics.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoff);
      backoff = Math.min(backoff * 2, 250);
    }
  }
}

function tryStealStaleLock(): boolean {
  let holderPid: number;
  try {
    holderPid = parseInt(readFileSync(CONFIG_LOCK_PATH, "utf-8"), 10);
  } catch {
    // Lock file vanished while we were inspecting it; whoever held it released.
    return true;
  }
  if (!Number.isFinite(holderPid) || holderPid <= 0) return false;
  if (isProcessRunning(holderPid)) return false;
  // Holder is dead; remove the corpse so the next loop iteration can lock.
  try {
    unlinkSync(CONFIG_LOCK_PATH);
  } catch {}
  return true;
}

// Atomically read, mutate, and write ~/.portal.json. The mutator runs while
// the file lock is held, so concurrent CLI invocations cannot lose updates.
// Use this for any code path that wants to add, remove, or amend an instance.
function mutateConfig<T>(mutator: (config: PortalConfig) => T): T {
  const release = acquireConfigLock();
  try {
    const config = readConfig();
    const result = mutator(config);
    writeConfig(config);
    return result;
  } finally {
    release();
  }
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function isProcessRunning(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isInstanceRunning(instance: PortalInstance): boolean {
  return (
    isProcessRunning(instance.opencodePid) || isProcessRunning(instance.webPid)
  );
}

// JSONC support: ~/.openportal.json is read as JSONC (JSON-with-comments)
// so users can leave inline rationale + commented-out backup configs. The
// stripper walks character-by-character so it doesn't false-trigger on `//`
// inside string values (URLs, paths). It does NOT strip trailing commas;
// JSONC technically allows them but JSON.parse will reject them, and
// supporting them here without a real parser is fragile.
function stripJsoncComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : "";
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        const ch = src[i];
        out += ch;
        if (ch === "\\" && i + 1 < n) {
          out += src[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (ch === '"') break;
      }
    } else if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i + 1 < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

interface OpenportalCliConfig {
  decoupleOpencode?: boolean;
  externalOpencode?: { port?: number };
}

// Reads ~/.openportal.json (JSONC). Returns an empty object on read/parse
// failure so the CLI keeps booting. Three lifecycle modes, mutually
// exclusive, evaluated in priority order in cmdDefault/cmdRun:
//
//   1. externalOpencode.port set      -> connect-only. NEVER spawn opencode.
//      The pidfile mechanism is bypassed (we don't own the process). The
//      configured port wins over --opencode-port. cmdStop won't kill it.
//   2. decoupleOpencode === true      -> pidfile-driven attach. First start
//      spawns + writes ~/.openportal-opencode-<port>.pid; subsequent starts
//      attach if the pidfile points at a live opencode. cmdStop won't kill
//      attached instances.
//   3. neither set                    -> legacy managed-child behaviour.
//      openportal spawns and (via cmdStop) kills opencode. Children still
//      orphan when openportal exits without going through cmdStop.
function readOpenportalConfig(): OpenportalCliConfig {
  try {
    if (!existsSync(OPENPORTAL_CONFIG_PATH)) return {};
    const raw = readFileSync(OPENPORTAL_CONFIG_PATH, "utf-8");
    return JSON.parse(stripJsoncComments(raw)) as OpenportalCliConfig;
  } catch (error) {
    console.warn(
      `[openportal-config] Failed to read ${OPENPORTAL_CONFIG_PATH}:`,
      error instanceof Error ? error.message : error,
    );
    return {};
  }
}

// Quick TCP-level reachability + protocol sanity check for an externally
// managed opencode. Hits opencode's /config/providers (cheap, JSON, served
// only by an actual opencode). Used in external mode at startup. Returns
// false on any failure (timeout, connection refused, non-2xx, parse miss);
// caller decides whether to abort startup or warn-and-continue.
async function probeOpencode(
  hostname: string,
  port: number,
  timeoutMs = 2000,
): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${hostname}:${port}/config/providers`, {
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function opencodePidfilePath(port: number): string {
  return join(homedir(), `.openportal-opencode-${port}.pid`);
}

function writeOpencodePidfile(port: number, pid: number): void {
  try {
    writeFileSync(opencodePidfilePath(port), `${pid}\n`);
  } catch (error) {
    console.warn(
      `[pidfile] Failed to write opencode pidfile for port ${port}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

// Returns the live opencode PID for `port` if we have a pidfile pointing at
// a running opencode process, else null. PID validation: exists in pidfile,
// process is alive, and on Linux /proc/<pid>/cmdline contains "opencode" so
// a recycled PID belonging to an unrelated process can't be mistaken for
// opencode. Non-Linux hosts skip the cmdline check (alive-only validation).
function readLiveOpencodePidfile(port: number): number | null {
  const path = opencodePidfilePath(port);
  if (!existsSync(path)) return null;
  let pid: number;
  try {
    pid = parseInt(readFileSync(path, "utf-8").trim(), 10);
  } catch {
    return null;
  }
  if (!Number.isFinite(pid) || pid <= 0) return null;
  if (!isProcessRunning(pid)) return null;
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
    if (!cmdline.includes("opencode")) return null;
  } catch {
    // /proc unavailable (non-Linux); trust the alive check above.
  }
  return pid;
}

function printHelp() {
  console.log(`
OpenPortal CLI - Run OpenCode with a web UI

Usage: openportal [command] [options]

Commands:
  (default)       Start OpenCode server and Web UI
  run [options]   Start only OpenCode server (no Web UI)
  stop            Stop running instances
  list, ls        List running instances
  clean           Clean up stale entries

Options:
  -h, --help              Show this help message
  -d, --directory <path>  Working directory (default: current directory)
  -p, --port <port>       Web UI port (default: 3000)
  --opencode-port <port>  OpenCode server port (default: 4000)
  --hostname <host>       Hostname to bind (default: 0.0.0.0)
  --name <name>           Instance name

Examples:
  openportal                               Start OpenCode + Web UI
  openportal .                             Start OpenCode + Web UI in current dir
  openportal run                           Start only OpenCode server
  openportal run -d ./my-project           Start OpenCode in specific directory
  openportal --port 8080                   Use custom web UI port
  openportal stop                          Stop running instances
  openportal list                          List running instances
`);
}

function parseArgs(): {
  args: string[];
  flags: Record<string, string | boolean | undefined>;
} {
  const args: string[] = [];
  const flags: Record<string, string | boolean | undefined> = {};

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--")) {
      const [key, value] = arg.substring(2).split("=");
      if (value !== undefined) {
        flags[key.toLowerCase()] = value;
      } else {
        const next = process.argv[i + 1];
        if (next && !next.startsWith("-")) {
          flags[key.toLowerCase()] = next;
          i++;
        } else {
          flags[key.toLowerCase()] = true;
        }
      }
    } else if (arg.startsWith("-")) {
      const short = arg.substring(1);
      const next = process.argv[i + 1];
      if (next && !next.startsWith("-")) {
        flags[short.toLowerCase()] = next;
        i++;
      } else {
        flags[short.toLowerCase()] = true;
      }
    } else {
      args.push(arg);
    }
  }

  return { args, flags };
}

async function startOpenCodeServer(
  directory: string,
  opencodePort: number,
  hostname: string,
): Promise<number> {
  console.log(`Starting OpenCode server...`);
  const proc = Bun.spawn(
    [
      "opencode",
      "serve",
      "--port",
      String(opencodePort),
      "--hostname",
      hostname,
    ],
    {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    },
  );
  return proc.pid;
}

async function startWebServer(port: number, hostname: string): Promise<number> {
  console.log(`Starting Web UI server...`);
  const proc = Bun.spawn(["bun", "run", WEB_SERVER_PATH], {
    cwd: dirname(WEB_SERVER_PATH),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: hostname,
      NITRO_PORT: String(port),
      NITRO_HOST: hostname,
    },
  });
  return proc.pid;
}

async function cmdDefault(
  options: Record<string, string | boolean | undefined>,
) {
  const hostname = (options.hostname as string) || DEFAULT_HOSTNAME;
  const directory = resolve(
    (options.directory as string) || (options.d as string) || process.cwd(),
  );
  const name =
    (options.name as string) || directory.split("/").pop() || "opencode";
  const port =
    options.port || options.p
      ? parseInt((options.port as string) || (options.p as string), 10)
      : await getPort({ host: hostname, port: DEFAULT_PORT });

  const cfg = readOpenportalConfig();
  const externalPort = cfg.externalOpencode?.port;
  const decouple = cfg.decoupleOpencode === true;

  let opencodePort: number;
  if (typeof externalPort === "number") {
    opencodePort = externalPort;
    if (options["opencode-port"]) {
      const cliPort = parseInt(options["opencode-port"] as string, 10);
      if (cliPort !== externalPort) {
        console.log(
          `[openportal-config] externalOpencode.port=${externalPort} overrides --opencode-port ${cliPort}`,
        );
      }
    }
  } else if (options["opencode-port"]) {
    opencodePort = parseInt(options["opencode-port"] as string, 10);
  } else {
    opencodePort = await getPort({ host: hostname, port: DEFAULT_OPENCODE_PORT });
  }

  const existing = readConfig().instances.find((i) => i.directory === directory);
  if (existing && isInstanceRunning(existing)) {
    console.log(`OpenPortal is already running for this directory.`);
    console.log(`  Name: ${existing.name}`);
    console.log(`  Web UI Port: ${existing.port ?? "N/A"}`);
    console.log(`  OpenCode Port: ${existing.opencodePort}`);
    if (existing.port) {
      console.log(
        `\n📱 Access OpenPortal at http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${existing.port}`,
      );
    }
    console.log(
      `🔧 OpenCode API at http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${existing.opencodePort}`,
    );
    return;
  }

  if (!existsSync(WEB_SERVER_PATH)) {
    console.error(`❌ Web server not found at ${WEB_SERVER_PATH}`);
    console.error(`   The web app may not be bundled correctly.`);
    process.exit(1);
  }

  console.log(`Starting OpenPortal...`);
  console.log(`  Name: ${name}`);
  console.log(`  Directory: ${directory}`);
  console.log(`  Web UI Port: ${port}`);
  console.log(`  OpenCode Port: ${opencodePort}`);
  console.log(`  Hostname: ${hostname}`);
  if (typeof externalPort === "number") {
    console.log(`  Lifecycle: external (no spawn; connecting to existing opencode)`);
  } else if (decouple) {
    console.log(`  Lifecycle: decoupled (opencode survives openportal restarts)`);
  }

  try {
    let opencodePid: number | null;
    let attachedOpencode = false;
    if (typeof externalPort === "number") {
      const reachable = await probeOpencode(hostname, externalPort);
      if (!reachable) {
        console.warn(
          `⚠️  external OpenCode at ${hostname}:${externalPort} did not respond on /config/providers. Starting web UI anyway; it will retry.`,
        );
      } else {
        console.log(`Probed external OpenCode at ${hostname}:${externalPort} ✓`);
      }
      opencodePid = null;
      attachedOpencode = true;
    } else if (decouple) {
      const existingPid = readLiveOpencodePidfile(opencodePort);
      if (existingPid !== null) {
        opencodePid = existingPid;
        attachedOpencode = true;
        console.log(`Attaching to existing OpenCode (PID: ${existingPid})`);
      } else {
        opencodePid = await startOpenCodeServer(directory, opencodePort, hostname);
        writeOpencodePidfile(opencodePort, opencodePid);
      }
    } else {
      opencodePid = await startOpenCodeServer(directory, opencodePort, hostname);
    }
    const webPid = await startWebServer(port, hostname);

    const instance: PortalInstance = {
      id: generateId(),
      name,
      directory,
      port,
      opencodePort,
      hostname,
      opencodePid,
      webPid,
      startedAt: new Date().toISOString(),
      attachedOpencode,
    };

    mutateConfig((config) => {
      config.instances = config.instances.filter(
        (i) => i.directory !== directory,
      );
      config.instances.push(instance);
    });

    const displayHost = hostname === "0.0.0.0" ? "localhost" : hostname;

    console.log(`\n✅ OpenPortal started!`);
    if (opencodePid !== null) {
      console.log(`   OpenCode PID: ${opencodePid}${attachedOpencode ? " (attached)" : ""}`);
    } else {
      console.log(`   OpenCode: external (not managed by openportal)`);
    }
    console.log(`   Web UI PID: ${webPid}`);
    console.log(`\n📱 Access OpenPortal at http://${displayHost}:${port}`);
    console.log(`🔧 OpenCode API at http://${displayHost}:${opencodePort}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`\n❌ Failed to start OpenPortal: ${error.message}`);
    }
    process.exit(1);
  }
}

async function cmdRun(options: Record<string, string | boolean | undefined>) {
  const hostname = (options.hostname as string) || DEFAULT_HOSTNAME;
  const directory = resolve(
    (options.directory as string) || (options.d as string) || process.cwd(),
  );
  const name =
    (options.name as string) || directory.split("/").pop() || "opencode";
  const opencodePort = options["opencode-port"]
    ? parseInt(options["opencode-port"] as string, 10)
    : await getPort({ host: hostname, port: DEFAULT_OPENCODE_PORT });

  const existing = readConfig().instances.find((i) => i.directory === directory);
  if (existing && isInstanceRunning(existing)) {
    console.log(`OpenCode is already running for this directory.`);
    console.log(`  Name: ${existing.name}`);
    console.log(`  OpenCode Port: ${existing.opencodePort}`);
    console.log(
      `🔧 OpenCode API at http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${existing.opencodePort}`,
    );
    return;
  }

  const cfg = readOpenportalConfig();
  if (typeof cfg.externalOpencode?.port === "number") {
    console.error(
      `❌ 'openportal run' is incompatible with externalOpencode mode (no opencode to spawn). Remove externalOpencode from ~/.openportal.json or use 'openportal' (default) which only starts the web UI.`,
    );
    process.exit(1);
  }
  const decouple = cfg.decoupleOpencode === true;

  console.log(`Starting OpenCode server...`);
  console.log(`  Name: ${name}`);
  console.log(`  Directory: ${directory}`);
  console.log(`  OpenCode Port: ${opencodePort}`);
  console.log(`  Hostname: ${hostname}`);
  if (decouple) console.log(`  Lifecycle: decoupled`);

  try {
    let opencodePid: number;
    let attachedOpencode = false;
    if (decouple) {
      const existingPid = readLiveOpencodePidfile(opencodePort);
      if (existingPid !== null) {
        opencodePid = existingPid;
        attachedOpencode = true;
        console.log(`Attaching to existing OpenCode (PID: ${existingPid})`);
      } else {
        opencodePid = await startOpenCodeServer(directory, opencodePort, hostname);
        writeOpencodePidfile(opencodePort, opencodePid);
      }
    } else {
      opencodePid = await startOpenCodeServer(directory, opencodePort, hostname);
    }

    const instance: PortalInstance = {
      id: generateId(),
      name,
      directory,
      port: null,
      opencodePort,
      hostname,
      opencodePid,
      webPid: null,
      startedAt: new Date().toISOString(),
      attachedOpencode,
    };

    mutateConfig((config) => {
      config.instances = config.instances.filter(
        (i) => i.directory !== directory,
      );
      config.instances.push(instance);
    });

    const displayHost = hostname === "0.0.0.0" ? "localhost" : hostname;

    console.log(`\n✅ OpenCode server started!`);
    console.log(`   OpenCode PID: ${opencodePid}`);
    console.log(`🔧 OpenCode API at http://${displayHost}:${opencodePort}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`\n❌ Failed to start OpenCode: ${error.message}`);
    }
    process.exit(1);
  }
}

async function cmdStop(options: Record<string, string | boolean | undefined>) {
  const directory =
    options.directory || options.d
      ? resolve((options.directory as string) || (options.d as string))
      : process.cwd();

  const removed = mutateConfig((config) => {
    const instance = options.name
      ? config.instances.find((i) => i.name === options.name)
      : config.instances.find((i) => i.directory === directory);
    if (!instance) return null;
    config.instances = config.instances.filter((i) => i.id !== instance.id);
    return instance;
  });

  if (!removed) {
    console.error("No instance found.");
    process.exit(1);
  }

  if (removed.opencodePid !== null) {
    if (removed.attachedOpencode) {
      console.log(
        `Leaving OpenCode running (decoupled, PID: ${removed.opencodePid})`,
      );
    } else {
      try {
        process.kill(removed.opencodePid, "SIGTERM");
        console.log(`Stopped OpenCode (PID: ${removed.opencodePid})`);
      } catch {
        console.log("OpenCode was already stopped.");
      }
    }
  }

  if (removed.webPid !== null) {
    try {
      process.kill(removed.webPid, "SIGTERM");
      console.log(`Stopped Web UI (PID: ${removed.webPid})`);
    } catch {
      console.log("Web UI was already stopped.");
    }
  }

  console.log(`\nStopped: ${removed.name}`);
}

async function cmdList() {
  const config = readConfig();

  if (config.instances.length === 0) {
    console.log("No OpenPortal instances running.");
    return;
  }

  console.log("\nOpenPortal Instances:\n");
  console.log("ID\t\tNAME\t\t\tPORT\tOPENCODE\tSTATUS\t\tDIRECTORY");
  console.log("-".repeat(110));

  const liveIds = new Set<string>();

  for (const instance of config.instances) {
    const opencodeRunning = isProcessRunning(instance.opencodePid);
    const webRunning = isProcessRunning(instance.webPid);

    let status = "stopped";
    if (opencodeRunning && webRunning) status = "running";
    else if (opencodeRunning) status = "opencode";
    else if (webRunning) status = "web only";

    if (opencodeRunning || webRunning) {
      liveIds.add(instance.id);
    }

    const portDisplay = instance.port ?? "-";
    console.log(
      `${instance.id}\t${instance.name.padEnd(16)}\t${String(portDisplay).padEnd(4)}\t${instance.opencodePort}\t\t${status.padEnd(12)}\t${instance.directory}`,
    );
  }

  if (liveIds.size !== config.instances.length) {
    mutateConfig((latest) => {
      latest.instances = latest.instances.filter(
        (i) => liveIds.has(i.id) || isInstanceRunning(i),
      );
    });
  }
}

async function cmdClean() {
  const result = mutateConfig((config) => {
    const valid: PortalInstance[] = [];
    const removed: string[] = [];
    for (const instance of config.instances) {
      if (isInstanceRunning(instance)) {
        valid.push(instance);
      } else {
        removed.push(instance.name);
      }
    }
    config.instances = valid;
    return { valid, removed };
  });

  for (const name of result.removed) {
    console.log(`Removed stale entry: ${name}`);
  }
  console.log(`\nConfig cleaned. ${result.valid.length} active instance(s).`);
}

async function main() {
  const { args, flags } = parseArgs();

  if (flags.help || flags.h) {
    printHelp();
    return;
  }

  const command = args[0]?.toLowerCase();

  if (
    !command ||
    command === "." ||
    command.startsWith("/") ||
    command.startsWith("./")
  ) {
    if (command && command !== ".") {
      flags.directory = command;
    }
    await cmdDefault(flags);
    return;
  }

  switch (command) {
    case "run":
      await cmdRun(flags);
      break;
    case "stop":
      await cmdStop(flags);
      break;
    case "list":
    case "ls":
      await cmdList();
      break;
    case "clean":
      await cmdClean();
      break;
    default:
      if (existsSync(command)) {
        flags.directory = command;
        await cmdDefault(flags);
      } else {
        console.log(`Unknown command: ${command}`);
        console.log("Use --help to see available commands.");
        process.exit(1);
      }
  }
}

main();
