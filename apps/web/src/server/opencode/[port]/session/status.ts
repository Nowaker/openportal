import { defineHandler } from "nitro/h3";
import { parsePort } from "../../../lib/validation";
import { getMergedSessionStatus } from "../../../lib/session-status";

// opencode exposes GET /session/status -> a map keyed by sessionID with
// {type: "busy" | "retry" | "idle"} for any session that is currently
// executing (or waiting on a permission). Empty {} means every session
// is idle. Portal uses this as the SERVER-side source of truth for the
// 'Thinking...' indicator and the sidebar amber-pulse, since the local
// heuristic (last message is user-role with no completed time) can't
// tell the difference between 'AI is generating' and 'AI never
// received the dispatch'.
//
// The bare opencode endpoint is scoped to the opencode-serve CWD, so it
// misses every session whose project.worktree differs from the CWD. We
// walk GET /project and fan out to /session/status?directory=<wt> per
// project, then merge the maps. See lib/session-status.ts.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  return await getMergedSessionStatus(port);
});
