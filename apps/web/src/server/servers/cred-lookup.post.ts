import { z } from "zod/v4";
import { defineHandler } from "nitro/h3";
import {
  startCredLookup,
  getCredStatusPublic,
} from "../lib/cred-lookup";
import { parseBody } from "../lib/validation";

// POST /api/servers/cred-lookup — start (or join an in-flight) credential
// probe for an explicit host:port. Returns the public lookup state. The
// UI calls this when the user opens the auth modal so even if no
// background probe ran yet, one starts immediately.
//
// `forceSsh: true` skips the no-auth HTTP probe and goes straight to
// SSH. Used after the first probe surfaced "needs-auth" and the user
// clicks "Try SSH again".

const schema = z.object({
  host: z.string().min(1),
  port: z.int().min(1).max(65535),
  protocol: z.enum(["http", "https"]).optional(),
  forceSsh: z.boolean().optional(),
  sshUser: z.string().optional(),
});

export default defineHandler(async (event) => {
  const body = await parseBody(event, schema);
  // Fire-and-forget: kick the probe but don't wait for it to finish.
  // The UI polls GET /cred-lookup for live state.
  void startCredLookup(
    body.host,
    body.port,
    body.protocol,
    {
      forceSsh: body.forceSsh,
      sshUser: body.sshUser,
    },
  );
  return getCredStatusPublic(body.host, body.port, body.protocol) ?? {
    state: "idle",
  };
});
