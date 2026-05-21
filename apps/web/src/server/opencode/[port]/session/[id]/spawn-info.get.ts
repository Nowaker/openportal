import { defineHandler, setResponseStatus } from "nitro/h3";
import { fetchOpencode } from "../../../../lib/opencode-client";
import {
  parsePort,
  parseRouteParam,
} from "../../../../lib/validation";

interface RawMessage {
  info?: {
    id?: string;
    role?: string;
    time?: { created?: number; completed?: number };
  };
  parts?: Array<{
    id?: string;
    type?: string;
    tool?: string;
    state?: {
      status?: string;
      metadata?: Record<string, unknown>;
      time?: { start?: number; end?: number };
    };
  }>;
}

interface Spawn {
  parentSessionID: string;
  spawnMessageID: string | null;
  spawnToolPartID: string | null;
  finishMessageID: string | null;
}

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const childID = parseRouteParam(event, "id");

  const childRes = await fetchOpencode(
    port,
    `/session/${encodeURIComponent(childID)}`,
  );
  if (!childRes.ok) {
    setResponseStatus(event, childRes.status);
    return { error: `child session lookup failed: HTTP ${childRes.status}` };
  }
  const child = (await childRes.json()) as { parentID?: string };
  if (!child.parentID) {
    return {
      childID,
      parentSessionID: null,
      spawnMessageID: null,
      spawnToolPartID: null,
      finishMessageID: null,
    };
  }
  const parentID = child.parentID;

  const msgRes = await fetchOpencode(
    port,
    `/session/${encodeURIComponent(parentID)}/message?limit=10000`,
  );
  if (!msgRes.ok) {
    setResponseStatus(event, msgRes.status);
    return {
      error: `parent message fetch failed: HTTP ${msgRes.status}`,
    };
  }
  const messages = (await msgRes.json()) as RawMessage[];

  let spawn: Spawn = {
    parentSessionID: parentID,
    spawnMessageID: null,
    spawnToolPartID: null,
    finishMessageID: null,
  };
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const parts = m.parts ?? [];
    for (const p of parts) {
      if (p.type !== "tool" || p.tool !== "task") continue;
      const metadata = p.state?.metadata ?? {};
      const sid =
        (typeof metadata.sessionId === "string" && metadata.sessionId) ||
        (typeof metadata.taskId === "string" && metadata.taskId) ||
        null;
      if (sid !== childID) continue;
      spawn = {
        parentSessionID: parentID,
        spawnMessageID: m.info?.id ?? null,
        spawnToolPartID: p.id ?? null,
        finishMessageID: null,
      };
      for (let j = i + 1; j < messages.length; j++) {
        const after = messages[j];
        if (after.info?.role === "assistant" && after.info?.time?.completed) {
          spawn.finishMessageID = after.info.id ?? null;
          break;
        }
      }
      return { childID, ...spawn };
    }
  }
  return { childID, ...spawn };
});
