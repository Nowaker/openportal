import { defineHandler } from "nitro/h3";
import { diffAgainstSnapshot } from "../lib/mcp-pending-restart";
import { OPENCODE_CONFIG_PATH } from "../lib/opencode-config";

export default defineHandler(() => {
  const result = diffAgainstSnapshot();
  return {
    configPath: OPENCODE_CONFIG_PATH,
    ...result,
  };
});
