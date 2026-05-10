import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import { addServer } from "../lib/server-registry";
import {
  discoverAll,
  type BasicAuthCreds,
} from "../lib/server-discovery";
import { setAuth } from "../lib/auth-store";
import {
  getCredStatus,
  recordKnownGoodCreds,
  startCredLookup,
} from "../lib/cred-lookup";
import {
  dropInspectFinding,
  getInspectFindingById,
} from "../lib/inspect-pool";
import { parseBody } from "../lib/validation";

// POST /api/servers/promote — adopt a currently-discovered server as a
// configured entry. The frontend sends the discovery `id`; we resolve
// it back to a live discovery result, copy the relevant fields into the
// registry, and return the new configured entry.
//
// Three sources of discovery, all resolved here:
//   1. Process scan / mDNS (live discoverAll() result). Carries
//      auth via env for local-process entries.
//   2. inspect-pool: server-side cache populated by /api/servers/
//      inspect-host. Lives across polls so the Discovered section
//      can surface inspect findings alongside the live ones. Auth
//      lives here too.

const schema = z.object({
  discoveredId: z.string().min(1),
  label: z.string().min(1).max(120).optional(),
});

export default defineHandler(async (event) => {
  const body = await parseBody(event, schema);

  // First try the live discovery list (process scan + mDNS). Then
  // fall back to the inspect-pool. Both share the synthetic-id
  // pattern (`disc-*` vs `inspect-*`), so we look in both
  // unconditionally and use whichever hits.
  let match:
    | {
        host: string;
        port: number;
        label: string;
        auth?: BasicAuthCreds;
        discoveryHint?: { kind: "opencode-desktop" };
        source: "live" | "inspect";
      }
    | null = null;

  const live = (await discoverAll()).find((d) => d.id === body.discoveredId);
  if (live) {
    match = {
      host: live.host,
      port: live.port,
      label: live.label,
      auth: live.auth,
      discoveryHint: live.discoveryHint,
      source: "live",
    };
  } else {
    const pooled = getInspectFindingById(body.discoveredId);
    if (pooled) {
      match = {
        host: pooled.host,
        port: pooled.port,
        label: pooled.label,
        auth: pooled.auth,
        discoveryHint: undefined,
        source: "inspect",
      };
    }
  }

  if (!match) {
    throw new HTTPError(
      "discovered server no longer present (probably stopped or relaunched)",
      { status: 404 },
    );
  }
  const isEphemeral = match.discoveryHint?.kind === "opencode-desktop";
  const server = addServer({
    label: body.label ?? match.label,
    host: match.host,
    port: match.port,
    ephemeral: isEphemeral,
    discoveryHint: match.discoveryHint,
  });

  // Promotion path: figure out whether we already have creds for this
  // server. Three sources, in order:
  //   1. Auth attached to the discovery match (process-scan env OR
  //      inspect-pool SSH-harvested). Only relevant for non-ephemeral
  //      servers we promote — ephemeral ones don't persist auth.
  //   2. cred-lookup cache: a background SSH probe that already ran
  //      against this host:port. We grab its creds straight from
  //      memory so the user sees the new server land already
  //      authenticated.
  //   3. Nothing: fall through. The /servers UI surfaces a
  //      `needs-auth` state and offers the modal.
  if (!isEphemeral) {
    let creds = match.auth;
    if (!creds) {
      const cached = getCredStatus(match.host, match.port);
      if (cached?.creds) creds = cached.creds;
    }
    if (creds) {
      setAuth(server.id, creds);
      recordKnownGoodCreds(match.host, match.port, creds);
    } else {
      // No creds yet — kick a probe in the background so the modal
      // either pops with creds-already-known or with mid-flight state.
      void startCredLookup(match.host, match.port);
    }
  }

  // The inspect-pool entry has done its job (server promoted to
  // Configured). Drop it so we don't keep showing it in Discovered.
  if (match.source === "inspect") {
    dropInspectFinding(match.host, match.port);
  }

  return { server };
});
