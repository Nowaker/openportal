import { defineHandler } from "nitro/h3";
import { getOpencodeClient } from "../../../../lib/opencode-client";
import { stopManagedSession } from "../../../../lib/managed-opencode";
import { resolveOwner } from "../../../../lib/prompt-routing";
import { invalidateSessionsCache } from "../../../../lib/sessions-cache";
import { parsePort, parseRouteParam } from "../../../../lib/validation";

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");

  const owner = await resolveOwner(id, port);
  const targetPort = owner?.port ?? port;
  const client = await getOpencodeClient(targetPort);
  const result = await client.session.delete({ path: { id } });

  stopManagedSession(id);
  invalidateSessionsCache(port);
  if (targetPort !== port) invalidateSessionsCache(targetPort);

  return result.data;
});
