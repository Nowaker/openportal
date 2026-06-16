// Shared permission reply + audit recording. Two callers:
//
//   1. The HTTP route at /api/opencode/{port}/permission/{requestId}/reply
//      (user-driven manual approvals from the chat UI).
//   2. The auto-approve worker plugin (server-side, fired when a pending
//      permission is polled and the effective auto-approve flag is on).
//
// opencode 1.16.x stores pending permissions per-directory (InstanceState)
// and both the list (GET /permission) and reply (POST /permission/:id/reply)
// routes run through opencode's WorkspaceRoutingMiddleware, which resolves
// the target instance from the `directory` query param (falling back to
// opencode's process.cwd when absent). A reply sent WITHOUT the session's
// directory therefore lands on a different (usually empty) pending map and
// no-ops, leaving the session blocked forever. We MUST scope every call to
// the session's directory - the same thing opencode's own web UI does
// (client.permission.list({ directory }) / reply with directory).
//
// The audit snapshot is captured BEFORE replying (opencode reaps replied
// requests on reply); the worker passes the already-known permission so we
// skip the extra lookup.

import { fetchOpencode, resolveSessionDirectory } from "./opencode-client";
import { recordResolved } from "./permission-log";
import { getServerByPort } from "./server-registry";

export type ReplyDecision = "once" | "always" | "reject";

export interface KnownPermission {
  id?: string;
  sessionID?: string;
  permission?: string;
  patterns?: string[];
  metadata?: { description?: string } | null;
  tool?: { messageID?: string; callID?: string; name?: string } | null;
}

export interface ReplyOptions {
  message?: string;
  auto?: boolean;
  // The session whose directory scopes the permission. Required for the
  // reply to reach the correct opencode instance. The manual HTTP route
  // forwards it from the browser; the worker has it from the poll.
  sessionId?: string;
  // Pre-resolved directory + permission, supplied by the worker to avoid
  // redundant lookups. When omitted, derived from sessionId.
  directory?: string;
  known?: KnownPermission | null;
}

function permissionsFromResponse(body: unknown): KnownPermission[] {
  const data =
    body && typeof body === "object" && "data" in body
      ? (body as { data?: unknown }).data
      : body;
  return Array.isArray(data) ? (data as KnownPermission[]) : [];
}

function dirQuery(dir: string | undefined): string {
  return dir ? `?directory=${encodeURIComponent(dir)}` : "";
}

export async function replyToPermission(
  port: number,
  requestId: string,
  decision: ReplyDecision,
  options: ReplyOptions = {},
): Promise<unknown> {
  let directory = options.directory;
  if (!directory && options.sessionId) {
    directory = await resolveSessionDirectory(port, options.sessionId);
  }

  // Capture metadata for the durable audit log BEFORE replying.
  let match: KnownPermission | null = options.known ?? null;
  if (!match) {
    try {
      const res = await fetchOpencode(
        port,
        `/permission${dirQuery(directory)}`,
      );
      const all = res.ok
        ? permissionsFromResponse(await res.json().catch(() => null))
        : [];
      match = all.find((p) => p.id === requestId) ?? null;
    } catch {
      // Best-effort capture - never block the reply.
    }
  }

  // V1 reply scoped to the session's directory - the live path opencode's
  // own web UI uses. The legacy V2-SDK reply (no directory, separate store)
  // silently no-ops in this opencode version.
  const res = await fetchOpencode(
    port,
    `/permission/${encodeURIComponent(requestId)}/reply${dirQuery(directory)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: decision, message: options.message }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`permission reply failed (${res.status}): ${text}`);
  }
  const result = await res.json().catch(() => true);

  const sessionId = match?.sessionID ?? options.sessionId;
  if (sessionId) {
    recordResolved({
      serverId: getServerByPort(port)?.id ?? null,
      sessionId,
      requestId,
      messageId: match?.tool?.messageID ?? null,
      callId: match?.tool?.callID ?? null,
      toolName: match?.tool?.name ?? null,
      permissionType:
        typeof match?.permission === "string" ? match.permission : null,
      patterns: Array.isArray(match?.patterns) ? match.patterns : [],
      title:
        typeof match?.metadata?.description === "string"
          ? match.metadata.description
          : null,
      decision,
      auto: options.auto === true,
    });
  }

  return result;
}
