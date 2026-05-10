import { HTTPError, defineHandler } from "nitro/h3";
import { invalidateLiveEndpoint } from "../../lib/server-resolver";
import { removeServer } from "../../lib/server-registry";
import { clearAuth } from "../../lib/auth-store";
import { parseRouteParam } from "../../lib/validation";

// DELETE /api/servers/:id — remove a configured server. If it was the
// active one, that activeServerId is cleared by removeServer(); the
// frontend bounce-back logic will redirect to /servers.

export default defineHandler(async (event) => {
  const id = parseRouteParam(event, "id");
  const removed = removeServer(id);
  if (!removed) {
    throw new HTTPError("server not in registry", { status: 404 });
  }
  // Drop in-memory live-endpoint cache + persisted auth. Auth must
  // not outlive the server it belongs to — a future server with a
  // recycled id (extremely unlikely; ids are 8-char random) wouldn't
  // be safe to reuse, but more importantly: orphaned auth entries
  // accumulate and look weird in the file.
  invalidateLiveEndpoint(id);
  clearAuth(id);
  return { removed: true };
});
