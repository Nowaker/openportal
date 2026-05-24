import { defineHandler } from "nitro/h3";
import { getOpencodeClient } from "../../../../lib/opencode-client";
import { resolveOwner } from "../../../../lib/prompt-routing";
import { parsePort, parseRouteParam } from "../../../../lib/validation";

// session.abort MUST hit the instance currently running the live runner,
// not the user's selected active-server port. If the runner is on
// instance B but we abort on A, A no-ops (no runner to abort) and the
// runner on B keeps generating, billing the model, and writing parts.
// Same bug class as prompt-routing P0 - cross-instance cohort
// correctness via plugin owner_instance_url.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");

  const owner = await resolveOwner(id);
  const targetPort = owner?.port ?? port;
  const client = await getOpencodeClient(targetPort);
  const result = await client.session.abort({ path: { id } });

  return result.data;
});
