import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import { setActiveServer } from "../lib/server-registry";
import { parseBody } from "../lib/validation";

// POST /api/servers/active — set the server this Portal UI binds to.
// Body: { id: string | null }. Passing null clears the active selection,
// which sends the user back to the server-list screen.

const schema = z.object({
  id: z.string().min(1).nullable(),
});

export default defineHandler(async (event) => {
  const body = await parseBody(event, schema);
  const ok = setActiveServer(body.id);
  if (!ok) {
    throw new HTTPError("server id not in registry", { status: 404 });
  }
  return { activeId: body.id };
});
