import { defineHandler, getQuery } from "nitro/h3";
import { resolve } from "node:path";
import {
  getInstanceDirectory,
  getOpencodeBaseUrl,
  getOpencodeClient,
} from "../../lib/opencode-client";
import { parsePort } from "../../lib/validation";
import { readPortalConfig } from "../../lib/portal-config";

type Session = { directory?: string; [k: string]: unknown };

function isUnder(sessionDir: string | undefined, scope: string): boolean {
  if (!sessionDir) return false;
  const s = resolve(scope);
  const d = resolve(sessionDir);
  return d === s || d.startsWith(s + "/");
}

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const query = getQuery(event);

  let sessions: Session[];
  try {
    const res = await fetch(`${getOpencodeBaseUrl(port)}/experimental/session`);
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    sessions = (await res.json()) as Session[];
  } catch {
    sessions = ((await getOpencodeClient(port).session.list()).data ?? []) as Session[];
  }

  const scopes = pickScopes(query, port);
  if (!scopes || scopes.length === 0) return sessions;

  return sessions.filter((s) =>
    scopes.some((scope) => isUnder(s.directory, scope)),
  );
});

function pickScopes(
  query: Record<string, unknown>,
  port: number,
): string[] | undefined {
  const explicitScope =
    typeof query.scope === "string" ? query.scope : undefined;
  if (explicitScope === "all") return undefined;

  const explicitDir =
    typeof query.directory === "string" ? query.directory : undefined;
  if (explicitDir) return [explicitDir];

  const portalConfig = readPortalConfig();
  if (portalConfig.directories.length > 0) return portalConfig.directories;

  const instanceDir = getInstanceDirectory(port);
  if (!instanceDir || instanceDir === "/") return undefined;
  return [instanceDir];
}
