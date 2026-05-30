import { defineHandler } from "nitro/h3";
import { fetchOpencode } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";
import {
  clearOverlayField,
  setOverlayField,
} from "../../../../lib/session-overlay";
import { invalidateSessionsCache } from "../../../../lib/sessions-cache";

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionID = parseRouteParam(event, "id");
  const now = Date.now();

  // Reconciliation layer: record the user's intent the instant the
  // request hits portal, so any concurrent /sessions poll already sees
  // the row as archived even while opencode's PATCH is still in flight.
  // Architecture: ai-analysis-requests/MUTATION_RECONCILIATION_ARCHITECTURE.md
  setOverlayField(port, sessionID, "_pendingArchived", now);
  invalidateSessionsCache(port);

  try {
    const res = await fetchOpencode(port, `/session/${sessionID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: { archived: now } }),
    });
    if (!res.ok) {
      clearOverlayField(port, sessionID, "_pendingArchived");
      throw new Error(`archive failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  } catch (err) {
    clearOverlayField(port, sessionID, "_pendingArchived");
    throw err;
  }
});
