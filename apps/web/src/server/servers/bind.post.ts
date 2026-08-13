import { z } from "zod/v4";
import { defineHandler } from "nitro/h3";
import {
  displayServerLabel,
  getActiveServerId,
  getServerById,
  setActiveServer,
} from "../lib/server-registry";
import { resolveLiveEndpoint } from "../lib/server-resolver";
import { probeOpencodeCached } from "../lib/probe-cache";
import { buildSelfPayload } from "../lib/self-instance";
import { parseBody } from "../lib/validation";

// POST /api/servers/bind — resolve a permalink's `?server=<id>` into an
// actually-usable binding, in one round-trip, before the browser has
// fired a single port-keyed request.
//
// Distinct from POST /api/servers/active, which is the operator gesture:
// "I clicked Open on this row, switch to it" - it trusts the caller and
// only checks registry membership. This endpoint answers a different
// question - "can this link be honoured at all?" - so it refuses to
// switch to a server that is not answering, and reports WHY. The
// frontend turns that reason into the /servers fallback.
//
// Three outcomes:
//   unknown      - no such id in the registry. Never activates.
//   unreachable  - in the registry, did not answer a probe. Never
//                  activates: switching the user onto a dead server
//                  would strand them there, and the whole point of the
//                  fallback is to let them fix or pick another.
//   ok           - activated (or already was), with the full
//                  /api/instance/self body so the client can seed its
//                  cache instead of re-asking.
//
// The already-active case deliberately short-circuits BEFORE the
// reachability check. A reload of the server you are already on must
// keep working while its opencode is down - that is the cached-data path
// the whole caching-proxy design exists for, and the yellow
// "OpenCode unreachable" banner is the correct UX there, not a bounce to
// the picker. It also means no registry write happens, so a permalink
// naming the current server costs nothing.

const schema = z.object({
  id: z.string().min(1),
});

export default defineHandler(async (event) => {
  const { id } = await parseBody(event, schema);

  const server = getServerById(id);
  if (!server) {
    return { ok: false, reason: "unknown" as const, requestedId: id };
  }

  if (getActiveServerId() === id) {
    return {
      ok: true,
      alreadyActive: true,
      self: await buildSelfPayload(event),
    };
  }

  const live = await resolveLiveEndpoint(server);
  // Ephemeral servers are re-discovered by the resolver on every read;
  // getting an endpoint back IS the liveness proof, same as
  // /api/instance/self treats them.
  const reachable = live
    ? server.ephemeral ||
      (
        await probeOpencodeCached(
          live.host,
          live.port,
          live.auth,
          live.protocol,
        )
      ).ok
    : false;

  if (!reachable) {
    return {
      ok: false,
      reason: "unreachable" as const,
      requestedId: id,
      label: displayServerLabel(server),
      host: live?.host ?? server.host,
      port: live?.port ?? server.port,
    };
  }

  setActiveServer(id);
  return {
    ok: true,
    alreadyActive: false,
    self: await buildSelfPayload(event),
  };
});
