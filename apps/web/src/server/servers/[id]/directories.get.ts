import { HTTPError, defineHandler } from "nitro/h3";

import { getServerById } from "../../lib/server-registry";
import { parseRouteParam } from "../../lib/validation";

export default defineHandler((event) => {
  const id = parseRouteParam(event, "id");
  const server = getServerById(id);
  if (!server) throw new HTTPError("server not found", { status: 404 });
  return {
    id,
    directories: server.directories ?? [],
    history: server.directoriesHistory ?? [],
  };
});
