import { formatDuration } from "@/lib/format-time";
import type { MessageWithParts } from "@/hooks/use-session-messages";

export interface ProvidersData {
  providers?: Array<{
    id: string;
    name?: string;
    models?: Record<string, { id?: string; name?: string }>;
  }>;
}

export interface MessageMeta {
  parts: string[];
  title: string;
}

export function computeMessageMeta(
  info: MessageWithParts["info"],
  nextAssistantInfo: MessageWithParts["info"] | null,
  isFinalAssistant: boolean,
  providersData: ProvidersData | undefined,
  turnStartTime: number | undefined,
): MessageMeta | null {
  type SourceShape = {
    agent?: string;
    modelID?: string;
    providerID?: string;
    variant?: string;
  };
  let source: SourceShape | null = null;
  if (info.role === "assistant") {
    source = info as unknown as SourceShape;
  } else if (nextAssistantInfo && nextAssistantInfo.role === "assistant") {
    source = nextAssistantInfo as unknown as SourceShape;
  }
  if (!source) return null;
  const agent = typeof source.agent === "string" && source.agent ? source.agent : null;
  const modelID = source.modelID;
  const providerID = source.providerID;
  const variant =
    typeof source.variant === "string" && source.variant ? source.variant : null;

  const provider = providersData?.providers?.find((p) => p.id === providerID);
  const modelEntry = provider?.models?.[modelID ?? ""];
  const modelName = modelEntry?.name || modelID || null;
  const providerName = provider?.name || providerID || null;

  let stepDuration: string | null = null;
  let totalDuration: string | null = null;
  if (info.role === "assistant" && isFinalAssistant) {
    const a = info as unknown as {
      time?: { created?: number; completed?: number };
    };
    const created = a.time?.created;
    const completed = a.time?.completed;
    let stepDurationMs: number | null = null;
    if (
      typeof created === "number" &&
      typeof completed === "number" &&
      completed > created
    ) {
      stepDurationMs = completed - created;
    }
    let totalDurationMs: number | null = null;
    if (
      typeof turnStartTime === "number" &&
      typeof completed === "number" &&
      completed > turnStartTime
    ) {
      totalDurationMs = completed - turnStartTime;
    }
    const showTotal =
      totalDurationMs !== null &&
      (stepDurationMs === null || totalDurationMs - stepDurationMs >= 1000);
    stepDuration = stepDurationMs !== null ? formatDuration(stepDurationMs) : null;
    totalDuration =
      showTotal && totalDurationMs !== null ? formatDuration(totalDurationMs) : null;
  }

  const parts: string[] = [];
  if (agent) parts.push(agent);
  if (modelName) parts.push(modelName);
  if (variant) parts.push(variant);
  if (stepDuration) parts.push(stepDuration);
  if (totalDuration) parts.push(totalDuration);
  if (parts.length === 0) return null;

  const titleSegments: string[] = [];
  if (info.role === "user") {
    titleSegments.push("Assistant settings for the following response");
  }
  if (agent) titleSegments.push(`Agent: ${agent}`);
  if (providerName && modelName)
    titleSegments.push(`Model: ${providerName} / ${modelName}`);
  else if (modelName) titleSegments.push(`Model: ${modelName}`);
  if (variant) titleSegments.push(`Thinking effort: ${variant}`);
  if (stepDuration) titleSegments.push(`Final step: ${stepDuration}`);
  if (totalDuration)
    titleSegments.push(`Total since user prompt: ${totalDuration}`);

  return { parts, title: titleSegments.join("\n") };
}
