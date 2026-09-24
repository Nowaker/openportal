import { z } from "zod/v4";
import { defineHandler } from "nitro/h3";
import { getOpencodeClient } from "../../../lib/opencode-client";
import { parsePort, parseBody } from "../../../lib/validation";
import { invalidateSessionsCache } from "../../../lib/sessions-cache";
import {
  bindManagedSession,
  managedSessionSpawningEnabled,
  parentManagedInstance,
  startPendingManagedInstance,
  stopPendingManagedInstance,
  type PendingManagedInstance,
  type ManagedInstanceRow,
} from "../../../lib/managed-opencode";

const createSessionSchema = z.object({
  title: z.string().optional(),
  parentID: z.string().optional(),
  directory: z.string().optional(),
});

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const body = await parseBody(event, createSessionSchema);

  let targetPort = port;
  let pendingInstance: PendingManagedInstance | null = null;
  let parentInstance: ManagedInstanceRow | null = null;

  if (body.parentID) {
    parentInstance = await parentManagedInstance(body.parentID, port);
    if (parentInstance) targetPort = parentInstance.port;
  } else if (managedSessionSpawningEnabled(port)) {
    try {
      pendingInstance = await startPendingManagedInstance({
        sourcePort: port,
        directory: body.directory,
        title: body.title,
      });
      targetPort = pendingInstance.port;
    } catch (err) {
      console.warn(
        `[managed-opencode] failed to start managed session instance; falling back to port=${port}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const client = await getOpencodeClient(targetPort);
  let session;
  try {
    session = await client.session.create({
      body: { title: body.title, parentID: body.parentID },
      query: body.directory ? { directory: body.directory } : undefined,
    });
  } catch (err) {
    if (pendingInstance) stopPendingManagedInstance(pendingInstance);
    throw err;
  }

  const data = session.data as {
    id?: unknown;
    title?: unknown;
    directory?: unknown;
    parentID?: unknown;
  };
  const sessionId = typeof data.id === "string" ? data.id : null;
  const title = typeof data.title === "string" ? data.title : body.title;
  const directory =
    typeof data.directory === "string" ? data.directory : body.directory;
  if (sessionId && pendingInstance) {
    bindManagedSession({
      sessionId,
      instance: pendingInstance,
      sourcePort: port,
      directory,
      title,
    });
  } else if (sessionId && parentInstance) {
    bindManagedSession({
      sessionId,
      parentSessionId: body.parentID ?? null,
      instance: parentInstance,
      sourcePort: port,
      directory,
      title,
    });
  }

  invalidateSessionsCache(port);
  if (targetPort !== port) invalidateSessionsCache(targetPort);

  return session.data;
});
