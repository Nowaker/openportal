import { defineHandler, getQuery } from "nitro/h3";
import {
  fetchOpencode,
  resolveSessionDirectory,
} from "../../lib/opencode-client";
import { parsePort } from "../../lib/validation";

// opencode 1.16.x scopes pending permissions per-directory and a bare
// GET /permission resolves opencode's process.cwd instance, which under
// the systemd unit is an unrelated directory that returns [] (or hangs on
// cold lazy-init). The permission a session is blocked on lives in that
// session's directory instance, so we MUST forward the directory. The
// caller passes ?sessionId= (preferred) or ?directory=; without either we
// have no directory to scope to and return [] rather than hang.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const q = getQuery(event);
  const sessionId = typeof q.sessionId === "string" ? q.sessionId : undefined;
  let directory = typeof q.directory === "string" ? q.directory : undefined;
  if (!directory && sessionId) {
    directory = await resolveSessionDirectory(port, sessionId);
  }
  if (!directory) return [];

  const result = await fetchOpencode(
    port,
    `/permission?directory=${encodeURIComponent(directory)}`,
  );
  if (!result.ok) {
    return new Response(await result.text(), { status: result.status });
  }
  return result.json();
});
