import { defineHandler } from "nitro/h3";
import { fetchOpencode } from "../../../../lib/opencode-client";
import {
  parsePort,
  parseRouteParam,
} from "../../../../lib/validation";

interface RawMessage {
  info?: {
    id?: string;
    role?: string;
    cost?: number;
    time?: { created?: number; completed?: number };
    tokens?: {
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: { read?: number; write?: number };
    };
    modelID?: string;
    providerID?: string;
  };
}

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionID = parseRouteParam(event, "id");
  const res = await fetchOpencode(
    port,
    `/session/${encodeURIComponent(sessionID)}/message?limit=10000`,
  );
  if (!res.ok) {
    throw new Error(`messages fetch failed: ${res.status}`);
  }
  const raw = (await res.json()) as RawMessage[];
  let totalCost = 0;
  let messagesWithCost = 0;
  let assistantCount = 0;
  const perModel: Record<
    string,
    { cost: number; messages: number; lastInput: number; lastOutput: number }
  > = {};
  let lastInput = 0;
  let lastOutput = 0;
  let lastReasoning = 0;
  for (const m of raw) {
    const info = m.info;
    if (!info || info.role !== "assistant") continue;
    assistantCount += 1;
    if (typeof info.cost === "number") {
      totalCost += info.cost;
      messagesWithCost += 1;
    }
    const modelKey = info.providerID
      ? `${info.providerID}/${info.modelID ?? "?"}`
      : (info.modelID ?? "?");
    if (!perModel[modelKey]) {
      perModel[modelKey] = {
        cost: 0,
        messages: 0,
        lastInput: 0,
        lastOutput: 0,
      };
    }
    perModel[modelKey].messages += 1;
    if (typeof info.cost === "number") perModel[modelKey].cost += info.cost;
    if (typeof info.tokens?.input === "number") {
      lastInput = info.tokens.input;
      perModel[modelKey].lastInput = info.tokens.input;
    }
    if (typeof info.tokens?.output === "number") {
      lastOutput = info.tokens.output;
      perModel[modelKey].lastOutput = info.tokens.output;
    }
    if (typeof info.tokens?.reasoning === "number") {
      lastReasoning = info.tokens.reasoning;
    }
  }
  return {
    sessionID,
    totalCost,
    messagesWithCost,
    assistantCount,
    missingCount: assistantCount - messagesWithCost,
    lastTokens: { input: lastInput, output: lastOutput, reasoning: lastReasoning },
    perModel,
  };
});
