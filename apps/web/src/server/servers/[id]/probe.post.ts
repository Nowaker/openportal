import { defineHandler } from "nitro/h3";
import {
  invalidateLiveEndpoint,
  resolveLiveEndpointById,
} from "../../lib/server-resolver";
import { probeOpencode } from "../../lib/server-discovery";
import { parseRouteParam } from "../../lib/validation";

// POST /api/servers/:id/probe — force a fresh probe (and, for ephemeral
// servers, fresh re-discovery). Used by the UI's "refresh" button and
// internally when the connection-monitor decides the live endpoint has
// drifted. Always invalidates the cached endpoint first so we don't
// happily report "online" against a stale entry.

export default defineHandler(async (event) => {
  const id = parseRouteParam(event, "id");
  invalidateLiveEndpoint(id);
  const live = await resolveLiveEndpointById(id);
  if (!live) {
    return { online: false, reason: "no-live-endpoint" };
  }
  const online = await probeOpencode(
    live.host,
    live.port,
    live.auth,
    undefined,
    live.protocol,
  );
  return {
    online,
    protocol: live.protocol,
    host: live.host,
    port: live.port,
  };
});
