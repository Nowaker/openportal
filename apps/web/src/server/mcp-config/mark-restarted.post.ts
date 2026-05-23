import { defineHandler } from "nitro/h3";
import { captureRestartSnapshot } from "../lib/mcp-pending-restart";

export default defineHandler(() => {
  const result = captureRestartSnapshot();
  return { ok: true, capturedAt: result.capturedAt };
});
