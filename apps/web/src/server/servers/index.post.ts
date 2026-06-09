import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import { addServer } from "../lib/server-registry";
import { setAuth } from "../lib/auth-store";
import { recordKnownGoodCreds } from "../lib/cred-lookup";
import { parseBody } from "../lib/validation";

// POST /api/servers — add a manually-configured server. The user supplies
// host + port + label; we don't probe at this point, the next list
// request will report online/offline.
//
// `ephemeral` defaults to false. The user can flip it to true if the
// server's port is going to drift (e.g. they've added their own
// opencode-desktop with a one-time-known port and want re-discovery).
// `discoveryHint` lets a "promote this discovered entry" call carry the
// hint through; manual adds normally leave it empty.
//
// Optional `auth: {username, password}` writes the credentials to the
// auth-store and seeds the cred-lookup cache as `manual + succeeded`
// in one shot. Used by the inspect-host flow which already has
// validated credentials in hand and doesn't want the user to type
// them again.

const addSchema = z.object({
  label: z.string().max(120).nullable().optional(),
  protocol: z.enum(["http", "https"]).optional(),
  host: z.string().min(1).max(255),
  port: z.int().min(1).max(65535),
  webEndpoint: z.string().min(1).max(2048).optional(),
  ephemeral: z.boolean().optional(),
  discoveryHint: z
    .object({ kind: z.literal("opencode-desktop") })
    .optional(),
  auth: z
    .object({
      username: z.string().min(1),
      password: z.string().min(1),
    })
    .optional(),
});

export default defineHandler(async (event) => {
  const body = await parseBody(event, addSchema);
  try {
    const server = addServer({
      label: body.label,
      protocol: body.protocol,
      host: body.host,
      port: body.port,
      webEndpoint: body.webEndpoint,
      ephemeral: body.ephemeral,
      discoveryHint: body.discoveryHint,
    });
    if (body.auth) {
      setAuth(server.id, body.auth);
      recordKnownGoodCreds(server.host, server.port, body.auth, server.protocol);
    }
    return { server };
  } catch (e) {
    throw new HTTPError(
      e instanceof Error ? e.message : "Failed to add server",
      { status: 500 },
    );
  }
});
