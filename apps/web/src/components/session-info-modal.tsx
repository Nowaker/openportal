import { useMemo } from "react";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useSessionMessages } from "@/hooks/use-session-messages";
import { useSessions, useProviders } from "@/hooks/use-opencode";
import { Loader } from "@/components/ui/loader";

interface Props {
  isOpen: boolean;
  sessionId: string;
  onOpenChange: (open: boolean) => void;
}

interface AssistantTokens {
  total?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

interface AssistantMessageInfo {
  id?: string;
  cost?: number;
  modelID?: string;
  providerID?: string;
  tokens?: AssistantTokens;
  time?: { created?: number; completed?: number };
  finish?: string;
}

interface RawProviderConfig {
  id: string;
  name?: string;
  models?: Record<
    string,
    {
      id: string;
      name?: string;
      limit?: { context?: number; output?: number };
    }
  >;
}

// Mirrors opencode's session-context-breakdown logic. Estimates token
// attribution from message PART content (chars / 4, rounded up), not from
// any provider-side telemetry. Returns the visible non-zero buckets in
// declared order. If the bucket sum exceeds the last-assistant's reported
// input tokens, scale every bucket proportionally so the bar fits.
type BucketKey = "system" | "user" | "assistant" | "tool" | "other";

interface PartLike {
  type?: string;
  text?: string;
  source?: {
    text?: { value?: string };
    value?: string;
  };
  input?: unknown;
  state?: { output?: unknown; input?: unknown };
}

interface MessageLike {
  info: { role: string; system?: string };
  parts: PartLike[];
}

function partLen(p: PartLike, role: "user" | "assistant"): {
  user: number;
  assistant: number;
  tool: number;
} {
  const z = { user: 0, assistant: 0, tool: 0 };
  if (!p || typeof p !== "object") return z;
  const t = p.type;
  if (role === "user") {
    if (t === "text" && typeof p.text === "string") {
      return { ...z, user: p.text.length };
    }
    if (t === "file") {
      const v = p.source?.text?.value;
      return { ...z, user: typeof v === "string" ? v.length : 0 };
    }
    if (t === "agent") {
      const v = p.source?.value;
      return { ...z, user: typeof v === "string" ? v.length : 0 };
    }
    return z;
  }
  if (t === "text" && typeof p.text === "string") {
    return { ...z, assistant: p.text.length };
  }
  if (t === "reasoning" && typeof p.text === "string") {
    return { ...z, assistant: p.text.length };
  }
  if (t === "tool") {
    const inputLen = p.input ? JSON.stringify(p.input).length : 0;
    const outputLen = p.state?.output
      ? typeof p.state.output === "string"
        ? p.state.output.length
        : JSON.stringify(p.state.output).length
      : 0;
    return { ...z, tool: inputLen + outputLen };
  }
  return z;
}

const BUCKET_LABEL: Record<BucketKey, string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
  tool: "Tool Calls",
  other: "Other",
};

const BUCKET_COLOR: Record<BucketKey, string> = {
  system: "bg-blue-500",
  user: "bg-green-500",
  assistant: "bg-orange-400",
  tool: "bg-amber-500",
  other: "bg-zinc-400",
};

function fmt(n: number | undefined | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

function fmtMoney(n: number | undefined | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtDate(ms: number | undefined | null): string {
  if (typeof ms !== "number" || !ms) return "—";
  return new Date(ms).toLocaleString();
}

function describeFinishReason(finish: string): { title: string; detail?: string } {
  switch (finish) {
    case "content-filter":
      return {
        title: "Blocked by content filter",
        detail:
          "Provider's safety classifier rejected this response. The conversation contains content the model refuses to engage with — try editing the last user message or starting a fresh session.",
      };
    case "length":
      return {
        title: "Response cut off",
        detail: "Model hit its max output tokens before finishing.",
      };
    case "error":
      return {
        title: "Model error",
        detail: "Model stopped due to an error.",
      };
    case "other":
      return {
        title: "Stopped (other)",
        detail: "Model stopped for an unspecified reason.",
      };
    default:
      return {
        title: `Stopped (${finish})`,
        detail:
          "Unexpected finish reason — open the model's response in raw view to inspect.",
      };
  }
}

export function SessionInfoModal({ isOpen, sessionId, onOpenChange }: Props) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm"
    >
      <Modal className="w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col flex-1 min-h-0 outline-none">
          {({ close }) => <Body sessionId={sessionId} onClose={close} />}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

function Body({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const {
    messages,
    isLoading: messagesLoading,
  } = useSessionMessages(sessionId, { loadAll: true });
  const { data: sessions, isLoading: sessionsLoading } = useSessions();
  const { data: providersData, isLoading: providersLoading } = useProviders();
  const isLoading =
    (messagesLoading && (!messages || messages.length === 0)) ||
    (sessionsLoading && !sessions) ||
    (providersLoading && !providersData);

  const session = useMemo(
    () =>
      ((sessions ?? []) as Array<{
        id: string;
        title?: string;
        time?: { created?: number; updated?: number };
      }>).find((s) => s.id === sessionId),
    [sessions, sessionId],
  );

  const stats = useMemo(() => {
    let userCount = 0;
    let assistantCount = 0;
    let totalCost: number | undefined = undefined;
    let lastAssistant: AssistantMessageInfo | null = null;
    let systemChars = 0;
    let userChars = 0;
    let assistantChars = 0;
    let toolChars = 0;
    const list = (messages ?? []) as unknown as MessageLike[];
    for (const m of list) {
      const role = m.info.role;
      if (role === "user") {
        userCount += 1;
        for (const p of m.parts ?? []) {
          const c = partLen(p, "user");
          userChars += c.user;
        }
      } else if (role === "assistant") {
        assistantCount += 1;
        const a = m.info as AssistantMessageInfo;
        if (typeof a.cost === "number") {
          totalCost = (totalCost ?? 0) + a.cost;
        }
        if (typeof m.info.system === "string") {
          systemChars += m.info.system.length;
        }
        for (const p of m.parts ?? []) {
          const c = partLen(p, "assistant");
          assistantChars += c.assistant;
          toolChars += c.tool;
        }
        if (a.time?.completed) {
          lastAssistant = a;
        }
      }
    }
    // Per opencode: token totals come from the LAST assistant message,
    // not summed across the whole session. cost IS summed across all.
    // Leave undefined when opencode did not report a value so fmt()
    // renders "—" instead of a misleading 0. The Field row distinguishes
    // "we don't know" from "actually zero" for the operator.
    const inputSum = lastAssistant?.tokens?.input;
    const outputSum = lastAssistant?.tokens?.output;
    const reasoningSum = lastAssistant?.tokens?.reasoning;
    const cacheReadSum = lastAssistant?.tokens?.cache?.read;
    const cacheWriteSum = lastAssistant?.tokens?.cache?.write;
    const knownTokens = [
      inputSum,
      outputSum,
      reasoningSum,
      cacheReadSum,
      cacheWriteSum,
    ].filter((n): n is number => typeof n === "number");
    const totalTokens =
      knownTokens.length === 0
        ? undefined
        : knownTokens.reduce((sum, n) => sum + n, 0);
    return {
      messages: list.length,
      userCount,
      assistantCount,
      totalCost,
      inputSum,
      outputSum,
      reasoningSum,
      cacheReadSum,
      cacheWriteSum,
      totalTokens,
      lastAssistant,
      breakdownChars: {
        system: systemChars,
        user: userChars,
        assistant: assistantChars,
        tool: toolChars,
      },
    };
  }, [messages]);

  const modelInfo = useMemo(() => {
    const a = stats.lastAssistant;
    if (!a) return null;
    const raw = (providersData ?? null) as
      | { providers?: RawProviderConfig[] }
      | null;
    const provider = raw?.providers?.find((p) => p.id === a.providerID);
    const model = provider?.models?.[a.modelID ?? ""];
    return {
      providerName: provider?.name ?? a.providerID ?? "—",
      modelName: model?.name ?? a.modelID ?? "—",
      contextLimit: model?.limit?.context,
    };
  }, [providersData, stats.lastAssistant]);

  const usagePct = useMemo(() => {
    if (!modelInfo?.contextLimit) return null;
    return Math.min(
      100,
      Math.round((stats.totalTokens / modelInfo.contextLimit) * 100),
    );
  }, [stats.totalTokens, modelInfo]);

  const breakdown = useMemo<
    { key: BucketKey; tokens: number; percent: number; width: number }[]
  >(() => {
    const input = stats.inputSum;
    if (input <= 0) return [];
    const estimateTokens = (chars: number) => Math.ceil(chars / 4);
    const raw = {
      system: estimateTokens(stats.breakdownChars.system),
      user: estimateTokens(stats.breakdownChars.user),
      assistant: estimateTokens(stats.breakdownChars.assistant),
      tool: estimateTokens(stats.breakdownChars.tool),
    };
    const estimated = raw.system + raw.user + raw.assistant + raw.tool;
    let scaled = raw;
    let other: number;
    if (estimated <= input) {
      other = input - estimated;
    } else {
      const k = input / estimated;
      scaled = {
        system: Math.floor(raw.system * k),
        user: Math.floor(raw.user * k),
        assistant: Math.floor(raw.assistant * k),
        tool: Math.floor(raw.tool * k),
      };
      const sum =
        scaled.system + scaled.user + scaled.assistant + scaled.tool;
      other = Math.max(0, input - sum);
    }
    const buckets: { key: BucketKey; tokens: number }[] = [
      { key: "system", tokens: scaled.system },
      { key: "user", tokens: scaled.user },
      { key: "assistant", tokens: scaled.assistant },
      { key: "tool", tokens: scaled.tool },
      { key: "other", tokens: other },
    ];
    return buckets
      .filter((b) => b.tokens > 0)
      .map((b) => {
        const width = (b.tokens / input) * 100;
        return {
          key: b.key,
          tokens: b.tokens,
          percent: Math.round(width * 10) / 10,
          width,
        };
      });
  }, [stats.breakdownChars, stats.inputSum]);

  const finishReason = useMemo(() => {
    const finish = stats.lastAssistant?.finish;
    if (finish && finish !== "stop" && finish !== "tool-calls") {
      return describeFinishReason(finish);
    }
    return null;
  }, [stats.lastAssistant]);

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold">Session info</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-muted-fg hover:text-fg hover:bg-muted/40"
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
      <div className="overflow-y-auto p-4 space-y-5">
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-fg">
            <Loader className="size-5" />
            <span>Loading session info…</span>
          </div>
        )}
        {!isLoading && finishReason && (
          <div className="rounded-md border border-danger/40 bg-danger-subtle/30 p-3 text-xs text-danger-subtle-fg">
            <div className="font-semibold">{finishReason.title}</div>
            {finishReason.detail && (
              <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
                {finishReason.detail}
              </div>
            )}
          </div>
        )}
        {!isLoading && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <Field label="Title" value={session?.title ?? "—"} />
          <Field label="Session ID" value={sessionId} />
          <Field label="Messages" value={fmt(stats.messages)} />
          <Field label="Provider" value={modelInfo?.providerName ?? "—"} />
          <Field label="Model" value={modelInfo?.modelName ?? "—"} />
          <Field label="Context Limit" value={fmt(modelInfo?.contextLimit)} />
          <Field label="Total Tokens" value={fmt(stats.totalTokens)} />
          <Field
            label="Usage"
            value={usagePct === null ? "—" : `${usagePct}%`}
          />
          <Field label="Input Tokens" value={fmt(stats.inputSum)} />
          <Field label="Output Tokens" value={fmt(stats.outputSum)} />
          <Field
            label="Reasoning Tokens"
            value={fmt(stats.reasoningSum)}
          />
          <Field
            label="Cache Tokens (read/write)"
            value={`${fmt(stats.cacheReadSum)} / ${fmt(stats.cacheWriteSum)}`}
          />
          <Field label="User Messages" value={fmt(stats.userCount)} />
          <Field
            label="Assistant Messages"
            value={fmt(stats.assistantCount)}
          />
          <Field label="Total Cost" value={fmtMoney(stats.totalCost)} />
          <Field
            label="Session Created"
            value={fmtDate(session?.time?.created)}
          />
          <Field
            label="Last Activity"
            value={fmtDate(session?.time?.updated)}
          />
        </div>
        )}
        {!isLoading && breakdown.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-muted-fg">Context Breakdown</div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              {breakdown.map((seg) => (
                <div
                  key={seg.key}
                  className={`h-full ${BUCKET_COLOR[seg.key]}`}
                  style={{ width: `${seg.width}%` }}
                  title={`${BUCKET_LABEL[seg.key]} ${seg.percent}%`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {breakdown.map((seg) => (
                <div
                  key={seg.key}
                  className="flex items-center gap-1.5"
                >
                  <span
                    className={`inline-block size-2 rounded-full ${BUCKET_COLOR[seg.key]}`}
                  />
                  <span>{BUCKET_LABEL[seg.key]}</span>
                  <span className="text-muted-fg">
                    {seg.percent.toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                    %
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-fg">{label}</div>
      <div className="text-sm font-mono tabular-nums break-all">{value}</div>
    </div>
  );
}
