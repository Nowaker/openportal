import { defineHandler, getQuery } from "nitro/h3";
import { resolve } from "node:path";
import {
  fetchOpencode,
  getInstanceDirectory,
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
    const res = await fetchOpencode(
      port,
      "/experimental/session?archived=true&limit=10000",
    );
    if (res.ok) {
      sessions = (await res.json()) as Session[];
    } else if (res.status === 502) {
      // fetchOpencode returns a synthetic 502 when the upstream is
      // unreachable. The SDK fallback would just hit the same dead
      // endpoint and throw; surface the 502 directly so the error
      // handler can rewrite it. Throwing here lets the existing
      // error-handler.ts pipeline pick it up consistently.
      throw new Error("ConnectionRefused");
    } else {
      throw new Error(`upstream ${res.status}`);
    }
  } catch {
    // Non-502 failures (experimental route missing on an older
    // opencode) fall through to the v1 SDK's session.list, which we
    // wrap so a connection error becomes the structured 502 rather
    // than an unhandled 500.
    try {
      sessions = (((await (await getOpencodeClient(port)).session.list()).data ?? [])) as Session[];
    } catch (e) {
      // Re-throw with a code the error-handler recognises so the
      // response shape stays consistent across both proxy paths.
      if (
        e instanceof Error &&
        (e.message.includes("ConnectionRefused") ||
          e.message.includes("Unable to connect"))
      ) {
        throw e;
      }
      throw e;
    }
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
