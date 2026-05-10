import { z } from "zod/v4";
import { defineHandler, HTTPError } from "nitro/h3";
import { setAuth, clearAuth } from "../../lib/auth-store";
import {
  getServerById,
} from "../../lib/server-registry";
import { invalidateLiveEndpoint } from "../../lib/server-resolver";
import { probeOpencode } from "../../lib/server-discovery";
import { recordKnownGoodCreds } from "../../lib/cred-lookup";
import { parseBody, parseRouteParam } from "../../lib/validation";

// POST /api/servers/:id/auth — set (or clear) the persisted credentials
// for a configured server. Body schema:
//
//   { username: string, password: string }   set
//   { clear: true }                          remove
//
// On set: validates by probing /config/providers with the supplied
// creds. Refuses to persist invalid creds — saves the user from a
// "saved, but doesn't work" footgun.
//
// On clear: drops the auth-store entry and invalidates the resolver
// cache so the next request re-resolves with no auth.

const setSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  // If `skipValidation` is true, persist without probing first. Used
  // when the SSH probe already validated for us — saves a redundant
  // round-trip.
  skipValidation: z.boolean().optional(),
});

const clearSchema = z.object({
  clear: z.literal(true),
});

const bodySchema = z.union([setSchema, clearSchema]);

export default defineHandler(async (event) => {
  const id = parseRouteParam(event, "id");
  const server = getServerById(id);
  if (!server) {
    throw new HTTPError("server not in registry", { status: 404 });
  }
  const body = await parseBody(event, bodySchema);

  if ("clear" in body) {
    clearAuth(id);
    invalidateLiveEndpoint(id);
    return { ok: true, cleared: true };
  }

  const creds = { username: body.username, password: body.password };
  if (!body.skipValidation) {
    const ok = await probeOpencode(server.host, server.port, creds);
    if (!ok) {
      throw new HTTPError(
        "Server rejected those credentials. Double-check and try again.",
        { status: 401 },
      );
    }
  }
  setAuth(id, creds);
  invalidateLiveEndpoint(id);
  recordKnownGoodCreds(server.host, server.port, creds);
  return { ok: true, validated: !body.skipValidation };
});
