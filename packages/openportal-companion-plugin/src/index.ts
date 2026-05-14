// Openportal companion plugin for opencode.
//
// Runs inside the opencode Node process. Observes every event / tool call /
// permission ask / chat message via opencode's hook surface and writes a
// rolling state snapshot to ~/.openportal/companion-plugin-state.json which
// the openportal web server reads back to enrich the Plugin Info modal.
//
// Cannot introspect peer plugins (PluginInput exposes no plugin registry),
// so the data attributed here is either: (a) about THIS plugin itself, or
// (b) about events flowing through opencode that any plugin can observe.

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const STATE_DIR = join(homedir(), ".openportal");
const FLUSH_DEBOUNCE_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_RECENT_EVENTS = 200;
const PLUGIN_ID = "@openportal/companion-plugin";
const PLUGIN_VERSION = "0.1.0";

interface ToolStats {
  callCount: number;
  errorCount: number;
  totalMs: number;
  lastFiredAt: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  recentMs: number[];
}

interface SessionStats {
  sessionId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  messageCount: number;
  toolCount: number;
  permissionAskCount: number;
  compactionCount: number;
}

interface PermissionEvent {
  at: number;
  sessionId: string;
  permission: string;
  patternCount: number;
}

interface RecentEventEntry {
  at: number;
  type: string;
}

interface SelfHookSubscriptions {
  event: boolean;
  config: boolean;
  "chat.message": boolean;
  "chat.params": boolean;
  "permission.ask": boolean;
  "command.execute.before": boolean;
  "tool.execute.before": boolean;
  "tool.execute.after": boolean;
  "tool.definition": boolean;
  "experimental.session.compacting": boolean;
}

interface CompanionState {
  schemaVersion: 1;
  identity: {
    id: string;
    version: string;
    spec?: string;
    loadedAt: number;
    options: Record<string, unknown>;
    hooks: SelfHookSubscriptions;
    initError: string | null;
  };
  context: {
    project: unknown;
    directory: string;
    worktree: string;
    serverUrl: string;
  };
  heartbeat: {
    lastWriteAt: number;
    intervalMs: number;
  };
  events: {
    totalSeen: number;
    byType: Record<string, number>;
    recent: RecentEventEntry[];
  };
  tools: Record<string, ToolStats>;
  toolDefinitionsSeen: string[];
  sessions: Record<string, SessionStats>;
  permissions: {
    totalAsked: number;
    recent: PermissionEvent[];
  };
  compactions: {
    total: number;
    recent: Array<{ at: number; sessionId: string }>;
  };
}

const subscribedHooks: SelfHookSubscriptions = {
  event: true,
  config: false,
  "chat.message": true,
  "chat.params": false,
  "permission.ask": true,
  "command.execute.before": true,
  "tool.execute.before": true,
  "tool.execute.after": true,
  "tool.definition": true,
  "experimental.session.compacting": true,
};

let state: CompanionState | null = null;
let stateFile: string = join(STATE_DIR, "companion-plugin-state.json");
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const inflightToolStartedAt = new Map<string, number>();

function ensureStateDir(): void {
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
  } catch {
    // If we can't make the dir, future writes will throw - swallow silently.
  }
}

// Each opencode instance owns its own state file keyed by the port it's
// listening on. Two opencodes (LAN + Tailscale, or two stand-alone projects)
// each running this plugin would otherwise race on a single file and corrupt
// each other's snapshot last-writer-wins; the port suffix gives openportal
// a deterministic way to fetch state from the instance it's currently
// bound to via /api/companion-plugin-state?port=N.
function deriveStateFile(serverUrl: URL | string | undefined): string {
  let port: string | null = null;
  try {
    if (serverUrl) {
      const url = typeof serverUrl === "string" ? new URL(serverUrl) : serverUrl;
      if (url.port) port = url.port;
    }
  } catch {
    port = null;
  }
  const suffix = port ? `-${port}` : "";
  return join(STATE_DIR, `companion-plugin-state${suffix}.json`);
}

function scheduleFlush(): void {
  if (!state) return;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, FLUSH_DEBOUNCE_MS);
}

function flushNow(): void {
  if (!state) return;
  state.heartbeat.lastWriteAt = Date.now();
  try {
    writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.warn(
      "[openportal-companion] failed to write state file:",
      err instanceof Error ? err.message : err,
    );
  }
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function bumpEvent(type: string): void {
  if (!state) return;
  state.events.totalSeen += 1;
  state.events.byType[type] = (state.events.byType[type] ?? 0) + 1;
  state.events.recent.push({ at: Date.now(), type });
  if (state.events.recent.length > MAX_RECENT_EVENTS) {
    state.events.recent.splice(0, state.events.recent.length - MAX_RECENT_EVENTS);
  }
  scheduleFlush();
}

function ensureSession(sessionId: string): SessionStats {
  if (!state) {
    throw new Error("state not initialized");
  }
  let s = state.sessions[sessionId];
  if (!s) {
    s = {
      sessionId,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      messageCount: 0,
      toolCount: 0,
      permissionAskCount: 0,
      compactionCount: 0,
    };
    state.sessions[sessionId] = s;
  } else {
    s.lastSeenAt = Date.now();
  }
  return s;
}

function ensureTool(tool: string): ToolStats {
  if (!state) throw new Error("state not initialized");
  let t = state.tools[tool];
  if (!t) {
    t = {
      callCount: 0,
      errorCount: 0,
      totalMs: 0,
      lastFiredAt: null,
      p50Ms: null,
      p95Ms: null,
      recentMs: [],
    };
    state.tools[tool] = t;
  }
  return t;
}

interface MinimalPluginInput {
  client?: unknown;
  project?: unknown;
  directory?: string;
  worktree?: string;
  serverUrl?: URL | string;
}

export default async function openportalCompanion(
  input: MinimalPluginInput,
  options?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  stateFile = deriveStateFile(input.serverUrl);
  ensureStateDir();

  state = {
    schemaVersion: 1,
    identity: {
      id: PLUGIN_ID,
      version: PLUGIN_VERSION,
      spec: typeof options?.spec === "string" ? (options.spec as string) : undefined,
      loadedAt: Date.now(),
      options: options ?? {},
      hooks: subscribedHooks,
      initError: null,
    },
    context: {
      project: input.project ?? null,
      directory: input.directory ?? "",
      worktree: input.worktree ?? "",
      serverUrl: input.serverUrl ? String(input.serverUrl) : "",
    },
    heartbeat: {
      lastWriteAt: 0,
      intervalMs: HEARTBEAT_INTERVAL_MS,
    },
    events: {
      totalSeen: 0,
      byType: {},
      recent: [],
    },
    tools: {},
    toolDefinitionsSeen: [],
    sessions: {},
    permissions: {
      totalAsked: 0,
      recent: [],
    },
    compactions: {
      total: 0,
      recent: [],
    },
  };

  flushNow();
  heartbeatTimer = setInterval(() => {
    flushNow();
  }, HEARTBEAT_INTERVAL_MS);

  return {
    event: async ({ event }: { event: { type?: string } }) => {
      const t =
        typeof event?.type === "string" ? event.type : "<unknown>";
      bumpEvent(t);
    },
    "chat.message": async (input: { sessionID: string }) => {
      if (!state) return;
      const s = ensureSession(input.sessionID);
      s.messageCount += 1;
      scheduleFlush();
    },
    "permission.ask": async (
      permInput: { sessionID?: string; permission?: string; patterns?: unknown },
    ) => {
      if (!state) return;
      state.permissions.totalAsked += 1;
      const entry: PermissionEvent = {
        at: Date.now(),
        sessionId: permInput.sessionID ?? "",
        permission: permInput.permission ?? "",
        patternCount: Array.isArray(permInput.patterns)
          ? permInput.patterns.length
          : 0,
      };
      state.permissions.recent.push(entry);
      if (state.permissions.recent.length > MAX_RECENT_EVENTS) {
        state.permissions.recent.splice(
          0,
          state.permissions.recent.length - MAX_RECENT_EVENTS,
        );
      }
      if (permInput.sessionID) {
        const s = ensureSession(permInput.sessionID);
        s.permissionAskCount += 1;
      }
      scheduleFlush();
    },
    "command.execute.before": async (
      cmdInput: { command?: string; sessionID?: string },
    ) => {
      if (!state || !cmdInput.sessionID) return;
      ensureSession(cmdInput.sessionID);
      scheduleFlush();
    },
    "tool.execute.before": async (
      toolInput: { tool?: string; sessionID?: string; callID?: string },
    ) => {
      if (!state) return;
      if (toolInput.callID) {
        inflightToolStartedAt.set(toolInput.callID, Date.now());
      }
      if (toolInput.tool) {
        const t = ensureTool(toolInput.tool);
        t.callCount += 1;
        t.lastFiredAt = Date.now();
      }
      if (toolInput.sessionID) {
        const s = ensureSession(toolInput.sessionID);
        s.toolCount += 1;
      }
      scheduleFlush();
    },
    "tool.execute.after": async (
      toolInput: { tool?: string; callID?: string },
      toolOutput?: {
        title?: string;
        output?: string;
        metadata?: unknown;
      },
    ) => {
      if (!state || !toolInput.tool) return;
      const t = ensureTool(toolInput.tool);
      const started = toolInput.callID
        ? inflightToolStartedAt.get(toolInput.callID)
        : undefined;
      if (typeof started === "number") {
        const elapsed = Date.now() - started;
        t.totalMs += elapsed;
        t.recentMs.push(elapsed);
        if (t.recentMs.length > 100) {
          t.recentMs.splice(0, t.recentMs.length - 100);
        }
        t.p50Ms = percentile(t.recentMs, 0.5);
        t.p95Ms = percentile(t.recentMs, 0.95);
        if (toolInput.callID) inflightToolStartedAt.delete(toolInput.callID);
      }
      if (toolOutput) {
        const meta = toolOutput.metadata;
        const metaError =
          meta && typeof meta === "object"
            ? Boolean((meta as { error?: unknown }).error)
            : false;
        const outputText =
          typeof toolOutput.output === "string" ? toolOutput.output : "";
        const outputLooksLikeError =
          /^\s*error[:\s]/i.test(outputText) ||
          /^\s*exception[:\s]/i.test(outputText) ||
          /^\s*failed[:\s]/i.test(outputText);
        if (metaError || outputLooksLikeError) {
          t.errorCount += 1;
        }
      }
      scheduleFlush();
    },
    "tool.definition": async (defInput: { toolID?: string }) => {
      if (!state || !defInput.toolID) return;
      if (!state.toolDefinitionsSeen.includes(defInput.toolID)) {
        state.toolDefinitionsSeen.push(defInput.toolID);
      }
      scheduleFlush();
    },
    "experimental.session.compacting": async (compInput: {
      sessionID?: string;
    }) => {
      if (!state || !compInput.sessionID) return;
      state.compactions.total += 1;
      state.compactions.recent.push({
        at: Date.now(),
        sessionId: compInput.sessionID,
      });
      if (state.compactions.recent.length > 50) {
        state.compactions.recent.splice(
          0,
          state.compactions.recent.length - 50,
        );
      }
      const s = ensureSession(compInput.sessionID);
      s.compactionCount += 1;
      scheduleFlush();
    },
  };
}

void heartbeatTimer;
