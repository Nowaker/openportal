import { defineHandler, getMethod, getQuery, readBody } from "nitro/h3";
import {
  getMcpDetails,
  invalidateMcpDetails,
  refreshMcpDetails,
} from "../../lib/mcp-details-cache";
import { parsePort } from "../../lib/validation";

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const method = getMethod(event);

  if (method === "POST") {
    const body = (await readBody(event)) as { name?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name : "";
    if (!name) return { error: "Missing 'name' in body" };
    invalidateMcpDetails(name);
    const details = await refreshMcpDetails(port, name);
    return { details, refreshing: false };
  }

  const query = getQuery(event);
  const name = typeof query.name === "string" ? query.name : "";
  if (!name) {
    return { error: "Missing 'name' query parameter" };
  }
  const { details, refreshing } = await getMcpDetails(port, name);
  return { details, refreshing };
});
