import { defineHandler } from "nitro/h3";
import { fetchOpencode } from "../../../lib/opencode-client";
import { parsePort } from "../../../lib/validation";

// opencode exposes GET /session/status -> a map keyed by sessionID with
// {type: "busy" | "retry" | "idle"} for any session that is currently
// executing (or waiting on a permission). Empty {} means every session
// is idle. Portal uses this as the SERVER-side source of truth for the
// 'Thinking...' indicator, since the local heuristic (last message is
// user-role with no completed time) can't tell the difference between
// 'AI is generating' and 'AI never received the dispatch'.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const response = await fetchOpencode(port, "/session/status");
  if (!response.ok) {
    return {};
  }
  return await response.json();
});
