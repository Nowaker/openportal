import { HTTPError, defineHandler } from "nitro/h3";

import { getPromptById } from "../../lib/prompt-archive";
import { parseRouteParam } from "../../lib/validation";

export default defineHandler((event) => {
  const id = parseRouteParam(event, "id");
  const row = getPromptById(id);
  if (!row) throw new HTTPError("prompt not found", { status: 404 });
  return row;
});
