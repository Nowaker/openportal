import { z } from "zod/v4";
import { defineHandler, getQuery } from "nitro/h3";
import { HTTPError } from "nitro/h3";
import { getCredStatusPublic } from "../lib/cred-lookup";

// GET /api/servers/cred-lookup?host=...&port=... — return the current
// lookup state for a (host,port). Used by the auth modal as a polling
// surface so the spinner status updates every ~750ms while a probe is
// in flight.

const schema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
});

export default defineHandler((event) => {
  const parsed = schema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw new HTTPError("invalid query", { status: 400 });
  }
  return (
    getCredStatusPublic(parsed.data.host, parsed.data.port) ?? {
      state: "idle",
    }
  );
});
