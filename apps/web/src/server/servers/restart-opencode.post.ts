import { defineHandler, readBody, setResponseStatus } from "nitro/h3";

import {
  detectOpencodeRestart,
  restartOpencodeUnit,
} from "../lib/opencode-restart-detect";
import { getActiveServer } from "../lib/server-registry";

interface RestartBody {
  unitName?: unknown;
}

export default defineHandler(async (event) => {
  const server = getActiveServer();
  if (!server) {
    setResponseStatus(event, 400);
    return {
      ok: false,
      reason: "no-active-server",
      message: "No active OpenCode server selected.",
    };
  }

  const body = (await readBody(event).catch(() => null)) as RestartBody | null;
  let unitName =
    typeof body?.unitName === "string" && body.unitName.length > 0
      ? body.unitName
      : null;

  if (unitName === null) {
    const detection = detectOpencodeRestart(server.host, server.port);
    if (detection.recommended) {
      unitName = detection.recommended.unitName;
    } else {
      setResponseStatus(event, 409);
      return {
        ok: false,
        reason: "no-unit",
        message:
          detection.candidates.length === 0
            ? "Could not detect any opencode-* systemd unit to restart."
            : "Multiple opencode units found; specify unitName in the request body.",
        candidates: detection.candidates,
      };
    }
  }

  const result = restartOpencodeUnit(unitName);
  if (!result.ok) {
    setResponseStatus(event, 500);
  }
  return {
    ok: result.ok,
    unitName,
    output: result.output,
    server: {
      id: server.id,
      host: server.host,
      port: server.port,
    },
  };
});
