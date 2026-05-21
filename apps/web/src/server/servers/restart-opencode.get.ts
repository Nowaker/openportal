import { defineHandler } from "nitro/h3";

import { detectOpencodeRestart } from "../lib/opencode-restart-detect";
import { getActiveServer } from "../lib/server-registry";

export default defineHandler(() => {
  const server = getActiveServer();
  if (!server) {
    return {
      ok: false,
      reason: "no-active-server",
      message: "No active opencode server selected.",
      candidates: [],
      recommended: null,
    };
  }
  const detection = detectOpencodeRestart(server.host, server.port);
  return {
    ok: true,
    server: {
      id: server.id,
      host: server.host,
      port: server.port,
      label: server.label ?? null,
    },
    detection,
    candidates: detection.candidates,
    recommended: detection.recommended,
    source: detection.source,
  };
});
