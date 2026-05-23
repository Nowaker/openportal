import { defineHandler, readBody, setResponseStatus } from "nitro/h3";
import { writeMcpEntry, type McpEntry } from "../lib/mcp-config";
import { diffAgainstSnapshot } from "../lib/mcp-pending-restart";

interface PutBody {
  name?: unknown;
  entry?: unknown;
}

export default defineHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as PutBody | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    setResponseStatus(event, 400);
    return { ok: false, error: "missing 'name' in body" };
  }
  const entry =
    body?.entry === null
      ? null
      : body && typeof body.entry === "object"
        ? (body.entry as McpEntry)
        : undefined;
  if (entry === undefined) {
    setResponseStatus(event, 400);
    return { ok: false, error: "missing 'entry' in body (object or null to delete)" };
  }
  const result = writeMcpEntry(name, entry);
  if (!result.ok) {
    setResponseStatus(event, 500);
    return { ok: false, error: result.error ?? "write failed" };
  }
  const diff = diffAgainstSnapshot();
  return {
    ok: true,
    configPath: result.configPath,
    changed: result.changed,
    ...diff,
  };
});
