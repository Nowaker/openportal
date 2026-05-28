import { defineHandler, readBody, getMethod } from "nitro/h3";
import { getOpencodeClientV2 } from "../../lib/opencode-client";
import {
  invalidateMcpDetails,
  prefetchAllMcpDetails,
  refreshMcpDetails,
} from "../../lib/mcp-details-cache";
import { parsePort } from "../../lib/validation";

interface McpToggleBody {
  name?: unknown;
  action?: unknown;
}

// opencode 1.15.6 emits snake_case for the multi-word MCP states
// ("needs_auth", "needs_client_registration") while openportal's
// McpStatusKind type + all matching code expects camelCase. Without
// this rewrite, McpRow's `kind === "needsAuth"` check fails, the
// row renders with the default gray slider, and the user can't open
// the OAuth handshake. Normalize at the proxy edge so every
// downstream consumer (sidebar, modal, status display) sees one
// canonical shape.
const STATUS_REWRITES: Record<string, string> = {
  needs_auth: "needsAuth",
  needs_client_registration: "needsClientRegistration",
};

function normalizeStatus<T extends Record<string, unknown>>(raw: T): T {
  if (!raw || typeof raw !== "object") return raw;
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value && typeof value === "object" && "status" in value) {
      const v = value as { status?: unknown; [k: string]: unknown };
      const rewritten = typeof v.status === "string" && v.status in STATUS_REWRITES
        ? { ...v, status: STATUS_REWRITES[v.status] }
        : v;
      out[name] = rewritten;
    } else {
      out[name] = value;
    }
  }
  return out as T;
}

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const client = await getOpencodeClientV2(port);
  const method = getMethod(event);
  if (method === "GET") {
    const result = await client.mcp.status();
    void prefetchAllMcpDetails(port);
    return normalizeStatus(result.data as Record<string, unknown>);
  }
  const body = (await readBody(event)) as McpToggleBody | null;
  const name = typeof body?.name === "string" ? body.name : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!name) return { ok: false };
  if (action === "connect") {
    await client.mcp.connect({ name });
  } else if (action === "disconnect") {
    await client.mcp.disconnect({ name });
  } else {
    return { ok: false };
  }
  invalidateMcpDetails(name);
  void refreshMcpDetails(port, name).catch(() => null);
  const result = await client.mcp.status();
  return normalizeStatus(result.data as Record<string, unknown>);
});
