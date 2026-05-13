import { HTTPError, defineHandler, readBody } from "nitro/h3";

import { clearPortalConfigCache } from "../../lib/portal-config";
import {
  setServerDirectories,
  type ServerDirectoryEntry,
} from "../../lib/server-registry";
import { parseRouteParam } from "../../lib/validation";

function normalize(raw: unknown): ServerDirectoryEntry | null {
  if (typeof raw === "string") {
    const t = raw.trim();
    return t ? t : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const path = typeof obj.path === "string" ? obj.path.trim() : "";
  if (!path) return null;
  const out: { path: string; level?: number; level1?: string[] } = { path };
  if (
    typeof obj.level === "number" &&
    Number.isInteger(obj.level) &&
    obj.level >= 1
  ) {
    out.level = obj.level;
  }
  if (Array.isArray(obj.level1)) {
    out.level1 = (obj.level1 as unknown[]).filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
  }
  return out;
}

export default defineHandler(async (event) => {
  const id = parseRouteParam(event, "id");
  const body = (await readBody(event)) as unknown;
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as { directories?: unknown }).directories)
  ) {
    throw new HTTPError("body.directories must be an array", { status: 400 });
  }
  const raw = (body as { directories: unknown[] }).directories;
  const cleaned: ServerDirectoryEntry[] = [];
  for (const r of raw) {
    const e = normalize(r);
    if (e) cleaned.push(e);
  }
  const updated = setServerDirectories(id, cleaned);
  if (!updated) {
    throw new HTTPError("server not found", { status: 404 });
  }
  clearPortalConfigCache();
  return {
    id,
    directories: updated.directories ?? [],
    history: updated.directoriesHistory ?? [],
  };
});
