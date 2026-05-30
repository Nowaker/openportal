import { defineHandler, readBody } from "nitro/h3";
import { z } from "zod/v4";
import { fetchOpencode } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";
import {
  clearOverlayField,
  setOverlayField,
} from "../../../../lib/session-overlay";
import { invalidateSessionsCache } from "../../../../lib/sessions-cache";

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
});

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionID = parseRouteParam(event, "id");
  const raw = (await readBody(event)) as unknown;
  const body = updateSchema.parse(raw ?? {});

  // Reconciliation layer: stage the new title before opencode's slow PATCH
  // returns, so any concurrent /sessions poll (sidebar, nav, multi-tab)
  // sees the renamed row immediately. Architecture:
  // ai-analysis-requests/MUTATION_RECONCILIATION_ARCHITECTURE.md
  const pendingTitle = body.title;
  if (pendingTitle !== undefined) {
    setOverlayField(port, sessionID, "_pendingTitle", pendingTitle);
    invalidateSessionsCache(port);
  }

  try {
    const res = await fetchOpencode(port, `/session/${sessionID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (pendingTitle !== undefined) {
        clearOverlayField(port, sessionID, "_pendingTitle");
      }
      throw new Error(`session update failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  } catch (err) {
    if (pendingTitle !== undefined) {
      clearOverlayField(port, sessionID, "_pendingTitle");
    }
    throw err;
  }
});
