import { defineHandler } from "nitro/h3";

import { detectClient } from "../lib/client-detection";
import { readPortalConfig } from "../lib/portal-config";
import { getMappingFor } from "../lib/vscode-mapping-store";

export default defineHandler((event) => {
  const client = detectClient(event);
  const config = readPortalConfig();
  return {
    requestor: client.ip,
    isLocal: client.isLocal,
    workspaceDirs: config.directories ?? [],
    mapping: client.isLocal ? {} : getMappingFor(client.ip),
  };
});
