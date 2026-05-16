import { defineHandler, getQuery } from "nitro/h3";
import { getTodosForSession } from "../../../../lib/session-todo";
import { parsePort, parseRouteParam } from "../../../../lib/validation";

// Proxies opencode's GET /session/:id/todo, which reads from the
// TodoTable SQLite store directly. Independent of the 50-message tail
// window the previous extractLatestTodos() approach scanned, so the
// sidebar/strip stays correct even on long-running sessions where the
// latest todowrite tool part has drifted out of range.
//
// ?directory=<worktree> is forwarded when present. Without it, the
// helper iterates known project worktrees + "/" and returns the first
// non-empty list (opencode's todo store is per-session, so worktree
// collisions are impossible).
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");
  const query = getQuery(event);
  const directory =
    typeof query.directory === "string" && query.directory.length > 0
      ? query.directory
      : undefined;
  return await getTodosForSession(port, id, directory);
});
