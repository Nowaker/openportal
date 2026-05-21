import { useMemo } from "react";
import {
  useSessionMessages,
} from "@/hooks/use-session-messages";
import { useProviders } from "@/hooks/use-opencode";

// Small circle-progress indicator mirroring the opencode web UI dial in
// packages/ui/src/components/session-turn.tsx. Shows the active session's
// context-window usage in the title bar: thin ring filling clockwise as
// tokens accumulate, percentage on hover.
//
// Math: stroke-dasharray = full circumference, stroke-dashoffset =
// circumference * (1 - usage). r=7, circumference = 2*pi*7 = 43.9823.
//
// Same source as session-info-modal.tsx: tokens come from the LAST
// assistant message (opencode reports cumulative-session-totals there,
// NOT per-message), context limit from the active model's
// limit.context in the providers feed.
const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface RawProviderConfig {
  id?: string;
  name?: string;
  models?: Record<
    string,
    {
      id?: string;
      name?: string;
      limit?: { context?: number };
    }
  >;
}

interface AssistantTokens {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

interface AssistantMessageLike {
  info: {
    role?: string;
    providerID?: string;
    modelID?: string;
    tokens?: AssistantTokens;
    time?: { completed?: number };
  };
}

export function SessionContextDial({
  sessionId,
}: {
  sessionId: string | null;
}) {
  const { messages } = useSessionMessages(sessionId ?? undefined, {
    enabled: sessionId !== null,
  });
  const { data: providersData } = useProviders();

  const { usage, contextLimit, totalTokens } = useMemo(() => {
    const list = (messages ?? []) as AssistantMessageLike[];
    let lastAssistant: AssistantMessageLike["info"] | null = null;
    for (const m of list) {
      if (m.info?.role === "assistant" && m.info.time?.completed) {
        lastAssistant = m.info;
      }
    }
    if (!lastAssistant) {
      return { usage: null, contextLimit: null, totalTokens: null };
    }
    const t = lastAssistant.tokens ?? {};
    const knownTokens = [
      t.input,
      t.output,
      t.reasoning,
      t.cache?.read,
      t.cache?.write,
    ].filter((n): n is number => typeof n === "number");
    if (knownTokens.length === 0) {
      return { usage: null, contextLimit: null, totalTokens: null };
    }
    const total = knownTokens.reduce((sum, n) => sum + n, 0);

    const raw = (providersData ?? null) as
      | { providers?: RawProviderConfig[] }
      | null;
    const provider = raw?.providers?.find(
      (p) => p.id === lastAssistant!.providerID,
    );
    const model = provider?.models?.[lastAssistant!.modelID ?? ""];
    const limit = model?.limit?.context;
    if (!limit || limit <= 0) {
      return { usage: null, contextLimit: null, totalTokens: total };
    }
    return {
      usage: Math.min(1, total / limit),
      contextLimit: limit,
      totalTokens: total,
    };
  }, [messages, providersData]);

  if (sessionId === null || usage === null) return null;

  const dashOffset = CIRCUMFERENCE * (1 - usage);
  const usagePct = Math.round(usage * 100);
  const tone =
    usage >= 0.95 ? "danger" : usage >= 0.85 ? "warning" : "default";
  const ringClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : "text-muted-fg";
  const formattedTokens = totalTokens
    ? new Intl.NumberFormat("en-US").format(totalTokens)
    : "?";
  const formattedLimit = contextLimit
    ? new Intl.NumberFormat("en-US").format(contextLimit)
    : "?";

  return (
    <button
      type="button"
      aria-label={`Context usage: ${usagePct}% (${formattedTokens} / ${formattedLimit} tokens)`}
      title={`${usagePct}%  ${formattedTokens} / ${formattedLimit} tokens`}
      data-test="portal-session-context-dial"
      className="shrink-0 inline-flex items-center justify-center size-6 rounded hover:bg-muted/40"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        className={ringClass}
      >
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeWidth={2}
          fill="none"
        />
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          stroke="currentColor"
          strokeWidth={2}
          fill="none"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 8 8)"
        />
      </svg>
    </button>
  );
}
