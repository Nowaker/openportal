import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

import { getPromptDb } from "./prompt-db";
import {
  addServer,
  removeServer,
  updateServer,
  getServerByPort,
} from "./server-registry";
import { fetchOpencode } from "./opencode-client";

const MANAGED_HOST = "127.0.0.1";
const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 200;

export interface ManagedInstanceRow {
  session_id: string;
  parent_session_id: string | null;
  source_port: number;
  server_id: string;
  host: string;
  port: number;
  pid: number | null;
  directory: string | null;
  created_at: number;
  updated_at: number;
}

export interface ManagedRoutingTarget {
  host: string;
  port: number;
  ownerInstanceUrl: string;
}

export interface PendingManagedInstance {
  sourcePort: number;
  serverId: string;
  host: string;
  port: number;
  pid: number | null;
  directory: string | null;
  proc: ChildProcess;
}

const children = new Map<number, ChildProcess>();
let initialized = false;

function db() {
  return getPromptDb();
}

function now(): number {
  return Date.now();
}

function localHosts(): Set<string> {
  const out = new Set(["localhost", "127.0.0.1", "::1"]);
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      out.add(entry.address);
    }
  }
  return out;
}

function sourcePortIsLocal(port: number): boolean {
  const server = getServerByPort(port);
  const host = server?.host ?? "127.0.0.1";
  return localHosts().has(host.replace(/^\[|\]$/g, ""));
}

export function managedSessionSpawningEnabled(sourcePort: number): boolean {
  const raw = process.env.OPENPORTAL_MANAGED_SESSION_OPENCODE;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return sourcePortIsLocal(sourcePort);
}

function opencodeBinary(): string {
  const explicit = process.env.OPENPORTAL_MANAGED_OPENCODE_BIN?.trim();
  if (explicit) return explicit;
  const localBuild = resolve(
    process.env.HOME ?? ".",
    "projekty/webapps/opencode-build/bin/opencode",
  );
  if (existsSync(localBuild)) return localBuild;
  return "opencode";
}

async function allocatePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, MANAGED_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else if (port > 0) resolvePort(port);
        else reject(new Error("failed to allocate a loopback port"));
      });
    });
  });
}

async function waitUntilReady(port: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), READY_POLL_MS);
    try {
      const res = await fetch(`http://${MANAGED_HOST}:${port}/`, {
        signal: ctrl.signal,
      });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  throw new Error(
    `managed opencode on ${MANAGED_HOST}:${port} did not become ready: ${lastError}`,
  );
}

function registerCleanupHandlers(): void {
  if (initialized) return;
  initialized = true;
  const stopChildren = () => {
    for (const child of children.values()) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  };
  process.once("exit", stopChildren);
  const forwardSignal = (signal: NodeJS.Signals, handler: () => void) => {
    stopChildren();
    process.off(signal, handler);
    process.kill(process.pid, signal);
  };
  const sigint = () => forwardSignal("SIGINT", sigint);
  const sigterm = () => forwardSignal("SIGTERM", sigterm);
  process.once("SIGINT", sigint);
  process.once("SIGTERM", sigterm);
}

function getRow(sessionId: string): ManagedInstanceRow | null {
  return (
    (db()
      .query("SELECT * FROM managed_opencode_instances WHERE session_id = ?")
      .get(sessionId) as ManagedInstanceRow | null) ?? null
  );
}

function upsertRow(input: {
  sessionId: string;
  parentSessionId: string | null;
  sourcePort: number;
  serverId: string;
  host: string;
  port: number;
  pid: number | null;
  directory: string | null;
}): ManagedInstanceRow {
  const ts = now();
  db().prepare(
    `INSERT INTO managed_opencode_instances (
       session_id, parent_session_id, source_port, server_id, host, port,
       pid, directory, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       parent_session_id = excluded.parent_session_id,
       source_port = excluded.source_port,
       server_id = excluded.server_id,
       host = excluded.host,
       port = excluded.port,
       pid = excluded.pid,
       directory = excluded.directory,
       updated_at = excluded.updated_at`,
  ).run(
    input.sessionId,
    input.parentSessionId,
    input.sourcePort,
    input.serverId,
    input.host,
    input.port,
    input.pid,
    input.directory,
    ts,
    ts,
  );
  return getRow(input.sessionId)!;
}

function rowIsLive(row: ManagedInstanceRow): boolean {
  if (children.has(row.pid ?? -1)) return true;
  return pidMatchesManagedInstance(row);
}

function deleteRow(sessionId: string): void {
  db()
    .prepare("DELETE FROM managed_opencode_instances WHERE session_id = ?")
    .run(sessionId);
}

function childRows(sessionId: string): ManagedInstanceRow[] {
  return db()
    .query(
      "SELECT * FROM managed_opencode_instances WHERE parent_session_id = ? ORDER BY created_at ASC",
    )
    .all(sessionId) as ManagedInstanceRow[];
}

function collectDescendants(sessionId: string): ManagedInstanceRow[] {
  const out: ManagedInstanceRow[] = [];
  const queue = childRows(sessionId);
  while (queue.length > 0) {
    const row = queue.shift()!;
    out.push(row);
    queue.push(...childRows(row.session_id));
  }
  return out;
}

function pidMatchesManagedInstance(row: ManagedInstanceRow): boolean {
  if (!row.pid || row.pid <= 0) return false;
  try {
    const args = readFileSync(`/proc/${row.pid}/cmdline`, "utf-8")
      .split("\0")
      .filter(Boolean);
    return (
      args.some((arg) => arg.includes("opencode")) &&
      args.includes("serve") &&
      args.includes("--hostname") &&
      args.includes(row.host) &&
      args.includes("--port") &&
      args.includes(String(row.port))
    );
  } catch {
    return false;
  }
}

function stopRowProcess(row: ManagedInstanceRow): boolean {
  if (!row.pid || row.pid <= 0) return false;
  const child = children.get(row.pid);
  if (child) {
    try {
      return child.kill("SIGTERM");
    } catch {
      return false;
    }
  }
  if (!pidMatchesManagedInstance(row)) return false;
  try {
    process.kill(row.pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function reapStaleRows(): void {
  for (const row of listManagedInstances()) {
    if (rowIsLive(row)) continue;
    removeServer(row.server_id);
    deleteRow(row.session_id);
  }
}

async function lookupParentId(
  sessionId: string,
  fallbackPort: number,
): Promise<string | null> {
  const res = await fetchOpencode(
    fallbackPort,
    `/session/${encodeURIComponent(sessionId)}`,
  );
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as
    | { parentID?: unknown }
    | null;
  return typeof body?.parentID === "string" && body.parentID.length > 0
    ? body.parentID
    : null;
}

async function resolveManagedRow(
  sessionId: string,
  fallbackPort: number,
  seen = new Set<string>(),
): Promise<ManagedInstanceRow | null> {
  if (seen.has(sessionId)) return null;
  seen.add(sessionId);
  const direct = getRow(sessionId);
  if (direct && rowIsLive(direct)) return direct;
  if (direct) {
    removeServer(direct.server_id);
    deleteRow(direct.session_id);
  }
  const parentId = await lookupParentId(sessionId, fallbackPort);
  if (!parentId) return null;
  const parent = await resolveManagedRow(parentId, fallbackPort, seen);
  if (!parent) return null;
  return upsertRow({
    sessionId,
    parentSessionId: parentId,
    sourcePort: fallbackPort,
    serverId: parent.server_id,
    host: parent.host,
    port: parent.port,
    pid: parent.pid,
    directory: parent.directory,
  });
}

export async function resolveManagedRoutingTarget(
  sessionId: string,
  fallbackPort: number,
): Promise<ManagedRoutingTarget | null> {
  const row = await resolveManagedRow(sessionId, fallbackPort);
  if (!row) return null;
  return {
    host: row.host,
    port: row.port,
    ownerInstanceUrl: `http://${row.host}:${row.port}`,
  };
}

function pipeLogs(prefix: string, stream: NodeJS.ReadableStream | null): void {
  stream?.on("data", (chunk) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim().length > 0) console.log(`${prefix} ${line}`);
    }
  });
}

export async function startPendingManagedInstance(input: {
  sourcePort: number;
  directory?: string;
  title?: string;
}): Promise<PendingManagedInstance> {
  registerCleanupHandlers();
  reapStaleRows();
  const port = await allocatePort();
  const bin = opencodeBinary();
  const logLevel = process.env.OPENPORTAL_MANAGED_OPENCODE_LOG_LEVEL ?? "INFO";
  const args = [
    "--log-level",
    logLevel,
    "serve",
    "--hostname",
    MANAGED_HOST,
    "--port",
    String(port),
  ];
  const proc = spawn(bin, args, {
    cwd: input.directory || process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENCODE_URL: `http://${MANAGED_HOST}:${port}`,
    },
  });
  pipeLogs(`[managed-opencode:${port}:stdout]`, proc.stdout);
  pipeLogs(`[managed-opencode:${port}:stderr]`, proc.stderr);

  let spawnError: Error | null = null;
  proc.once("error", (err) => {
    spawnError = err;
  });
  const pid = proc.pid ?? null;
  if (pid) children.set(pid, proc);
  proc.once("exit", () => {
    if (pid) children.delete(pid);
  });

  await waitUntilReady(port).catch((err) => {
    try {
      proc.kill("SIGTERM");
    } catch {}
    throw spawnError ?? err;
  });

  const server = addServer({
    label: input.title ? `Managed: ${input.title}` : "Managed session",
    protocol: "http",
    host: MANAGED_HOST,
    port,
    ephemeral: false,
  });

  return {
    sourcePort: input.sourcePort,
    serverId: server.id,
    host: MANAGED_HOST,
    port,
    pid,
    directory: input.directory ?? null,
    proc,
  };
}

export function stopPendingManagedInstance(
  instance: PendingManagedInstance,
): void {
  removeServer(instance.serverId);
  try {
    instance.proc.kill("SIGTERM");
  } catch {}
}

export function stopManagedSession(sessionId: string): {
  found: boolean;
  stopped: boolean;
  removedSessions: number;
} {
  const row = getRow(sessionId);
  if (!row) return { found: false, stopped: false, removedSessions: 0 };

  if (row.parent_session_id) {
    deleteRow(sessionId);
    return { found: true, stopped: false, removedSessions: 1 };
  }

  const rows = [row, ...collectDescendants(sessionId)];
  const stopped = stopRowProcess(row);
  removeServer(row.server_id);
  for (const managedRow of rows) deleteRow(managedRow.session_id);
  return { found: true, stopped, removedSessions: rows.length };
}

export function bindManagedSession(input: {
  sessionId: string;
  parentSessionId?: string | null;
  instance: PendingManagedInstance | ManagedInstanceRow;
  sourcePort: number;
  directory?: string | null;
  title?: string | null;
}): ManagedInstanceRow {
  const row = upsertRow({
    sessionId: input.sessionId,
    parentSessionId: input.parentSessionId ?? null,
    sourcePort: input.sourcePort,
    serverId:
      "server_id" in input.instance
        ? input.instance.server_id
        : input.instance.serverId,
    host: input.instance.host,
    port: input.instance.port,
    pid: input.instance.pid,
    directory: input.directory ?? input.instance.directory ?? null,
  });
  if (input.title) {
    updateServer(row.server_id, { label: `Managed: ${input.title}` });
  } else {
    updateServer(row.server_id, {
      label: `Managed: ${input.sessionId.slice(0, 12)}`,
    });
  }
  return row;
}

export async function parentManagedInstance(
  parentSessionId: string,
  fallbackPort: number,
): Promise<ManagedInstanceRow | null> {
  return resolveManagedRow(parentSessionId, fallbackPort);
}

export function listManagedInstances(): ManagedInstanceRow[] {
  return db()
    .query("SELECT * FROM managed_opencode_instances ORDER BY created_at DESC")
    .all() as ManagedInstanceRow[];
}

export function listManagedInstanceStatus(): Array<
  ManagedInstanceRow & { live: boolean }
> {
  reapStaleRows();
  return listManagedInstances().map((row) => ({
    ...row,
    live: rowIsLive(row),
  }));
}
