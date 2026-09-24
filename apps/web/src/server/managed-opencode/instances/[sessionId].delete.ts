import { defineHandler } from "nitro/h3";

import { stopManagedSession } from "../../lib/managed-opencode";
import { parseRouteParam } from "../../lib/validation";

export default defineHandler((event) => {
  const sessionId = parseRouteParam(event, "sessionId");
  return stopManagedSession(sessionId);
});
