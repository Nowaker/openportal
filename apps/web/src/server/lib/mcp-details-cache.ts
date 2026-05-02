import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getOpencodeClientV2 } from "./opencode-client";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpDetails {
  name: string;
  type: "local" | "remote" | "unknown";
  url?: string;
  command?: string[];
  status?: string;
  serverInfo?: { name?: string; version?: string };
  instructions?: string;
  tools?: McpToolInfo[];
  toolsError?: string;
  fetchedAt: number;
}

interface McpConfigEntry {
  type?: "local" | "remote";
  command?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

// Tool definitions are essentially static between MCP-server upgrades. The
// only sources of change are: (a) the user upgrades the MCP package, (b) the
// MCP signals notifications/tools/list_changed (we don't subscribe yet),
// (c) the user toggles the MCP off/on. Cache invalidates on (c) explicitly;
// (a) and (b) are caught by the manual refresh button + server restart. Set
// the TTL to effectively-forever (7 days) so the modal is instant after the
// first prefetch and we never spawn duplicate processes for stdio MCPs.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 10_000;

const cache = new Map<string, McpDetails>();
const inflight = new Map<string, Promise<McpDetails>>();
let prefetchedForPort: number | null = null;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return (await Promise.race([p, timeout])) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function introspectMcp(port: number, name: string): Promise<McpDetails> {
  const opencode = getOpencodeClientV2(port);
  const cfgResp = await opencode.config.get();
  const cfg =
    (cfgResp.data as { mcp?: Record<string, McpConfigEntry> } | undefined)?.mcp?.[name] ?? null;

  let status: string | undefined;
  try {
    const statusResp = await opencode.mcp.status();
    const map = statusResp.data as Record<string, { status?: string }> | undefined;
    status = map?.[name]?.status;
  } catch {}

  const result: McpDetails = {
    name,
    type: cfg?.type === "local" ? "local" : cfg?.type === "remote" ? "remote" : "unknown",
    url: cfg?.url,
    command: cfg?.command,
    status,
    fetchedAt: Date.now(),
  };

  if (status === "disabled") {
    result.toolsError = "MCP is disabled. Enable it from the hamburger menu to introspect tools.";
    return result;
  }

  const sdkClient = new Client(
    { name: "openportal-mcp-introspect", version: "0.0.1" },
    { capabilities: {} },
  );
  let transport:
    | StdioClientTransport
    | SSEClientTransport
    | StreamableHTTPClientTransport
    | null = null;

  try {
    if (cfg?.type === "remote" && cfg.url) {
      const url = new URL(cfg.url);
      const headers = cfg.headers;
      if (cfg.url.includes("/sse")) {
        transport = new SSEClientTransport(url, {
          requestInit: headers ? { headers } : undefined,
        });
      } else {
        transport = new StreamableHTTPClientTransport(url, {
          requestInit: headers ? { headers } : undefined,
        });
      }
    } else if (cfg?.type === "local" && cfg.command && cfg.command.length > 0) {
      const [head, ...args] = cfg.command;
      transport = new StdioClientTransport({
        command: head,
        args,
        env: cfg.env
          ? { ...(process.env as Record<string, string>), ...cfg.env }
          : (process.env as Record<string, string>),
      });
    } else {
      result.toolsError = "Cannot introspect: missing command (local) or url (remote) in config.";
      return result;
    }

    await withTimeout(sdkClient.connect(transport), CONNECT_TIMEOUT_MS, "MCP connect");

    const serverInfo = sdkClient.getServerVersion();
    if (serverInfo) result.serverInfo = serverInfo;
    const instructions = sdkClient.getInstructions();
    if (instructions) result.instructions = instructions;

    const toolsResp = await withTimeout(
      sdkClient.listTools(),
      CONNECT_TIMEOUT_MS,
      "tools/list",
    );
    result.tools = toolsResp.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  } catch (err) {
    result.toolsError = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      await sdkClient.close();
    } catch {}
    if (transport) {
      try {
        await transport.close();
      } catch {}
    }
  }

  return result;
}

export function getCachedMcpDetails(name: string): McpDetails | null {
  const cached = cache.get(name);
  if (!cached) return null;
  return cached;
}

export function listCachedMcpNames(): string[] {
  return Array.from(cache.keys()).sort();
}

export function invalidateMcpDetails(name: string): void {
  cache.delete(name);
}

export async function refreshMcpDetails(
  port: number,
  name: string,
): Promise<McpDetails> {
  const existing = inflight.get(name);
  if (existing) return existing;
  const p = (async () => {
    try {
      const details = await introspectMcp(port, name);
      cache.set(name, details);
      return details;
    } finally {
      inflight.delete(name);
    }
  })();
  inflight.set(name, p);
  return p;
}

// Reads cache; if missing or older than TTL, kicks off a background refresh
// and returns the stale data (or null if never fetched). Frontend sees the
// cache, polls while null, then renders once populated.
export async function getMcpDetails(
  port: number,
  name: string,
): Promise<{ details: McpDetails | null; refreshing: boolean }> {
  const cached = cache.get(name);
  if (!cached) {
    void refreshMcpDetails(port, name).catch(() => null);
    return { details: null, refreshing: true };
  }
  if (Date.now() - cached.fetchedAt > TTL_MS) {
    void refreshMcpDetails(port, name).catch(() => null);
    return { details: cached, refreshing: true };
  }
  return { details: cached, refreshing: false };
}

// Eager prefetch of every MCP listed in the running opencode's config. Idempotent
// per port: only the first call kicks off the parallel fanout. Triggered from
// /mcp status endpoint so it happens the first time the hamburger menu opens.
export async function prefetchAllMcpDetails(port: number): Promise<void> {
  if (prefetchedForPort === port) return;
  prefetchedForPort = port;
  try {
    const opencode = getOpencodeClientV2(port);
    const cfgResp = await opencode.config.get();
    const mcp =
      (cfgResp.data as { mcp?: Record<string, unknown> } | undefined)?.mcp ?? {};
    const names = Object.keys(mcp);
    await Promise.all(
      names.map((name) =>
        refreshMcpDetails(port, name).catch(() => null),
      ),
    );
  } catch {
    prefetchedForPort = null;
  }
}
