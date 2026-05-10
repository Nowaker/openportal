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

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const client = await getOpencodeClientV2(port);
  const method = getMethod(event);
  if (method === "GET") {
    const result = await client.mcp.status();
    void prefetchAllMcpDetails(port);
    return result.data;
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
  return result.data;
});
