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

  // Reconciliation layer: 0 is the sentinel for "not archived" in
  // opencode's session.time map and matches what the PATCH below sends.
  setOverlayField(port, sessionID, "_pendingArchived", 0);
  invalidateSessionsCache(port);

  try {
    const res = await fetchOpencode(port, `/session/${sessionID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: { archived: 0 } }),
    });
    if (!res.ok) {
      clearOverlayField(port, sessionID, "_pendingArchived");
      throw new Error(`unarchive failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  } catch (err) {
    clearOverlayField(port, sessionID, "_pendingArchived");
    throw err;
  }
});
