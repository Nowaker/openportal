import { defineHandler, getQuery } from "nitro/h3";
import { getOpencodeClient } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";

const DEFAULT_INITIAL_LIMIT = 50;
const MAX_LIMIT = 1000;

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");
  const query = getQuery(event);

  const limit = parseLimit(query.limit);

  const client = getOpencodeClient(port);
  const messages = await client.session.messages({
    path: { id },
    query: limit !== undefined ? { limit } : undefined,
  });

  return messages.data;
});

function parseLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_INITIAL_LIMIT;
  }
  if (raw === "all" || raw === "0") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_INITIAL_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}
