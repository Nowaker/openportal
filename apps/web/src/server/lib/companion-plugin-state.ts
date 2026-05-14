import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".openportal");
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

function stateFileFor(port: number | null): string {
  const suffix = port ? `-${port}` : "";
  return join(STATE_DIR, `companion-plugin-state${suffix}.json`);
}

export interface CompanionPluginState {
  schemaVersion: 1;
  identity: {
    id: string;
    version: string;
    spec?: string;
    loadedAt: number;
    options: Record<string, unknown>;
    hooks: Record<string, boolean>;
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
    recent: Array<{ at: number; type: string }>;
  };
  tools: Record<
    string,
    {
      callCount: number;
      errorCount: number;
      totalMs: number;
      lastFiredAt: number | null;
      p50Ms: number | null;
      p95Ms: number | null;
      recentMs: number[];
    }
  >;
  toolDefinitionsSeen: string[];
  sessions: Record<
    string,
    {
      sessionId: string;
      firstSeenAt: number;
      lastSeenAt: number;
      messageCount: number;
      toolCount: number;
      permissionAskCount: number;
      compactionCount: number;
    }
  >;
  permissions: {
    totalAsked: number;
    recent: Array<{
      at: number;
      sessionId: string;
      permission: string;
      patternCount: number;
    }>;
  };
  compactions: {
    total: number;
    recent: Array<{ at: number; sessionId: string }>;
  };
}

export interface CompanionStateSummary {
  available: boolean;
  stale: boolean;
  state: CompanionPluginState | null;
  filePath: string;
}

export function readCompanionState(port: number | null): CompanionStateSummary {
  const filePath = stateFileFor(port);
  if (!existsSync(filePath)) {
    return { available: false, stale: false, state: null, filePath };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const state = JSON.parse(raw) as CompanionPluginState;
    const lastWrite = state.heartbeat?.lastWriteAt ?? 0;
    const stale = lastWrite > 0 && Date.now() - lastWrite > STALE_THRESHOLD_MS;
    return { available: true, stale, state, filePath };
  } catch {
    return { available: false, stale: false, state: null, filePath };
  }
}
