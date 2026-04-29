import { useMemo } from "react";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useSessionMessages } from "@/hooks/use-session-messages";
import { useSessions, useProviders } from "@/hooks/use-opencode";

interface Props {
  isOpen: boolean;
  sessionId: string;
  onOpenChange: (open: boolean) => void;
}

interface AssistantMessageInfo {
  cost?: number;
  modelID?: string;
  providerID?: string;
  tokens?: {
    total?: number;
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  time?: { created?: number; completed?: number };
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
  const { messages } = useSessionMessages(sessionId, { loadAll: true });
  const { data: sessions } = useSessions();
  const { data: providersData } = useProviders();

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
    let totalCost = 0;
    let inputSum = 0;
    let outputSum = 0;
    let reasoningSum = 0;
    let cacheReadSum = 0;
    let cacheWriteSum = 0;
    let lastAssistant: AssistantMessageInfo | null = null;
    type AnyMsg = { info: { role: string } & Partial<AssistantMessageInfo> };
    const list = (messages ?? []) as unknown as AnyMsg[];
    for (const m of list) {
      const role = m.info.role;
      if (role === "user") {
        userCount += 1;
      } else if (role === "assistant") {
        assistantCount += 1;
        const a = m.info as AssistantMessageInfo;
        if (typeof a.cost === "number") totalCost += a.cost;
        if (a.tokens) {
          inputSum += a.tokens.input ?? 0;
          outputSum += a.tokens.output ?? 0;
          reasoningSum += a.tokens.reasoning ?? 0;
          cacheReadSum += a.tokens.cache?.read ?? 0;
          cacheWriteSum += a.tokens.cache?.write ?? 0;
        }
        lastAssistant = a;
      }
    }
    const totalTokens = inputSum + outputSum + reasoningSum + cacheReadSum + cacheWriteSum;
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
    const a = stats.lastAssistant;
    if (!a || !modelInfo?.contextLimit) return null;
    const used = (a.tokens?.input ?? 0) + (a.tokens?.cache?.read ?? 0);
    if (!modelInfo.contextLimit) return null;
    return Math.min(100, Math.round((used / modelInfo.contextLimit) * 100));
  }, [stats.lastAssistant, modelInfo]);

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
      <div className="overflow-y-auto p-4 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <Field label="Session" value={session?.title ?? "—"} />
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
        <Field label="Reasoning Tokens" value={fmt(stats.reasoningSum)} />
        <Field
          label="Cache Tokens (read/write)"
          value={`${fmt(stats.cacheReadSum)} / ${fmt(stats.cacheWriteSum)}`}
        />
        <Field label="User Messages" value={fmt(stats.userCount)} />
        <Field label="Assistant Messages" value={fmt(stats.assistantCount)} />
        <Field label="Total Cost" value={fmtMoney(stats.totalCost)} />
        <Field label="Session Created" value={fmtDate(session?.time?.created)} />
        <Field label="Last Activity" value={fmtDate(session?.time?.updated)} />
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
