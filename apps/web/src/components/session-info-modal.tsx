import { useMemo, useState } from "react";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import {
  ArrowDownTrayIcon,
  AdjustmentsHorizontalIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useSessionMessages } from "@/hooks/use-session-messages";
import { useSessions, useProviders } from "@/hooks/use-opencode";
import { useMcpStatus, useToggleMcp } from "@/hooks/use-mcp";
import { useSessionVerdict } from "@/hooks/use-session-verdict";
import { useHashValue } from "@/hooks/use-hash-open";
import { useInstanceStore } from "@/stores/instance-store";
import { useCohort, type CohortWorker } from "@/stores/cohort-store";
import { formatFullDateTime } from "@/lib/format-time";
import { useDateFormatStore, type DateFormat } from "@/stores/date-format-store";
import { McpRow } from "@/components/app-sidebar-nav";
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

function fmtDate(
  ms: number | undefined | null,
  format: DateFormat,
): string {
  if (typeof ms !== "number" || !ms) return "—";
  return formatFullDateTime(ms, format);
}

interface OwnerInfo {
  display: string;
  detail: string | null;
  workerID: string | null;
}

// Resolve the human-friendly owner label from the plugin verdict +
// cohort registry. owner_instance_url is the canonical signal (the
// only thing in the system that knows which opencode instance is
// currently dispatching this session across multi-instance cohorts).
// When the verdict reports an owner URL that matches a known cohort
// worker (by host:port), show the worker's stable label
// (<host>-<pid>-<port>); otherwise fall back to plain host:port.
function deriveOwnerInfo(
  verdict: { owner_instance_url?: string | null } | null,
  workers: CohortWorker[],
  verdictNotFound: boolean,
): OwnerInfo {
  if (verdictNotFound) {
    return { display: "no current runner", detail: null, workerID: null };
  }
  const url = verdict?.owner_instance_url;
  if (!url || typeof url !== "string") {
    return verdict
      ? { display: "no current runner", detail: null, workerID: null }
      : { display: "—", detail: null, workerID: null };
  }
  let host = "";
  let port = 0;
  try {
    const u = new URL(url);
    host = u.hostname;
    port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  } catch {
    return { display: url, detail: null, workerID: null };
  }
  const match = workers.find((w) => w.host === host && w.port === port);
  if (match) {
    return {
      display: `${host}:${port}`,
      detail: match.workerID,
      workerID: match.workerID,
    };
  }
  return { display: `${host}:${port}`, detail: null, workerID: null };
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
  const dateFormat = useDateFormatStore((s) => s.format);
  const {
    messages,
    isLoading: messagesLoading,
  } = useSessionMessages(sessionId, { loadAll: true });
  const { data: sessions, isLoading: sessionsLoading } = useSessions();
  const { data: providersData, isLoading: providersLoading } = useProviders();
  // Per user spec: 'show immediately all that is already known, and each
  // value that needs an update from server, an individual spinner as a
  // value, before it populated.' We render the modal body unconditionally
  // and use per-field loading flags below.
  const sessionPending = sessionsLoading && !sessions;
  const messagesPending = messagesLoading && (!messages || messages.length === 0);
  const modelPending =
    messagesPending || (providersLoading && !providersData);
  const session = useMemo(
    () =>
      ((sessions ?? []) as Array<{
        id: string;
        title?: string;
        time?: { created?: number; updated?: number; archived?: number };
      }>).find((s) => s.id === sessionId),
    [sessions, sessionId],
  );
  const isArchived =
    typeof session?.time?.archived === "number" && session.time.archived > 0;
  const { verdict, isLoading: verdictLoading, notFound: verdictNotFound } =
    useSessionVerdict(sessionId, undefined, { enabled: !isArchived });
  const { cohort, isLoading: cohortLoading } = useCohort();
  const ownerInfo = useMemo(
    () => deriveOwnerInfo(verdict, cohort.workers, verdictNotFound),
    [verdict, cohort.workers, verdictNotFound],
  );
  const cohortLabel = useMemo(() => {
    if (cohort.workers.length === 0) {
      return cohort.pluginReachable ? "1 instance" : "—";
    }
    const n = cohort.workers.length;
    return `${n} instance${n === 1 ? "" : "s"}`;
  }, [cohort.workers, cohort.pluginReachable]);
  const verdictLabel = useMemo(() => {
    if (isArchived) return "n/a (archived)";
    if (verdictNotFound) return "idle (no verdict cached)";
    if (!verdict) return "—";
    const v = typeof verdict.verdict === "string" ? verdict.verdict : null;
    if (!v) return "—";
    if (verdict.cause && (v === "stuck" || v === "in-progress")) {
      return `${v} (${verdict.cause})`;
    }
    return v;
  }, [verdict, verdictNotFound, isArchived]);

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
        {finishReason && (
          <div className="rounded-md border border-danger/40 bg-danger-subtle/30 p-3 text-xs text-danger-subtle-fg">
            <div className="font-semibold">{finishReason.title}</div>
            {finishReason.detail && (
              <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
                {finishReason.detail}
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <Field
            label="Title"
            value={session?.title ?? "—"}
            loading={sessionPending && !session}
          />
          <Field label="Session ID" value={sessionId} />
          <Field
            label="Messages"
            value={fmt(stats.messages)}
            loading={messagesPending}
          />
          <Field
            label="Provider"
            value={modelInfo?.providerName ?? "—"}
            loading={modelPending && !modelInfo}
          />
          <Field
            label="Model"
            value={modelInfo?.modelName ?? "—"}
            loading={modelPending && !modelInfo}
          />
          <Field
            label="Context Limit"
            value={fmt(modelInfo?.contextLimit)}
            loading={modelPending && !modelInfo}
          />
          <Field
            label="Total Tokens"
            value={fmt(stats.totalTokens)}
            loading={messagesPending}
          />
          <Field
            label="Usage"
            value={usagePct === null ? "—" : `${usagePct}%`}
            loading={messagesPending}
          />
          <Field
            label="Input Tokens"
            value={fmt(stats.inputSum)}
            loading={messagesPending}
          />
          <Field
            label="Output Tokens"
            value={fmt(stats.outputSum)}
            loading={messagesPending}
          />
          <Field
            label="Reasoning Tokens"
            value={fmt(stats.reasoningSum)}
            loading={messagesPending}
          />
          <Field
            label="Cache Tokens (read/write)"
            value={`${fmt(stats.cacheReadSum)} / ${fmt(stats.cacheWriteSum)}`}
            loading={messagesPending}
          />
          <Field
            label="User Messages"
            value={fmt(stats.userCount)}
            loading={messagesPending}
          />
          <Field
            label="Assistant Messages"
            value={fmt(stats.assistantCount)}
            loading={messagesPending}
          />
          <Field
            label="Total Cost"
            value={fmtMoney(stats.totalCost)}
            loading={messagesPending}
          />
          <Field
            label="Session Created"
            value={fmtDate(session?.time?.created, dateFormat)}
            loading={sessionPending && !session}
          />
          <Field
            label="Last Activity"
            value={fmtDate(session?.time?.updated, dateFormat)}
            loading={sessionPending && !session}
          />
          <Field
            label="Owner instance"
            value={
              isArchived ? (
                "n/a (archived)"
              ) : (
                <span title={ownerInfo.detail ?? undefined}>
                  {ownerInfo.display}
                  {ownerInfo.workerID && (
                    <span className="ml-2 text-[10px] text-muted-fg">
                      {ownerInfo.workerID}
                    </span>
                  )}
                </span>
              )
            }
            loading={verdictLoading}
          />
          <Field
            label="Verdict"
            value={verdictLabel}
            loading={verdictLoading}
          />
          <Field
            label="Cohort"
            value={cohortLabel}
            loading={cohortLoading}
          />
        </div>
        {breakdown.length > 0 && (
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
        <McpSection />
        <ExportSection sessionId={sessionId} />
      </div>
    </>
  );
}

function McpSection() {
  const { data: status } = useMcpStatus();
  const toggleMcp = useToggleMcp();
  const setMcpInfoName = useHashValue("mcp")[1];
  if (!status) return null;
  const entries = Object.entries(status);
  if (entries.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
        MCP servers
      </div>
      <ul className="space-y-1.5">
        {entries.map(([name, s]) => (
          <li key={name} className="px-1">
            <McpRow
              name={name}
              kind={s.status}
              onToggle={toggleMcp}
              onOpenInfo={() => setMcpInfoName(name)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExportSection({
  sessionId,
  alwaysExpanded = false,
}: {
  sessionId: string;
  alwaysExpanded?: boolean;
}) {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const [showCustom, setShowCustom] = useState(alwaysExpanded);
  if (!port) return null;
  const base = `/api/opencode/${port}/session/${encodeURIComponent(sessionId)}/export`;
  const presets = [
    { label: "All messages", kind: "all" as const },
    { label: "User prompts only", kind: "prompts" as const },
    { label: "Last 50 messages", kind: "all" as const, limit: 50 },
  ];
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
        Export session
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((l) => {
          const params = new URLSearchParams({ kind: l.kind });
          if ("limit" in l && l.limit) params.set("limit", String(l.limit));
          const href = `${base}?${params.toString()}`;
          return (
            <a
              key={l.label}
              href={href}
              download
              data-test={`portal-session-export-${l.kind}${"limit" in l && l.limit ? `-${l.limit}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs hover:bg-muted/40 hover:text-fg"
            >
              <ArrowDownTrayIcon className="size-3.5" />
              {l.label}
            </a>
          );
        })}
        {!alwaysExpanded && (
          <button
            type="button"
            onClick={() => setShowCustom((v) => !v)}
            data-test="portal-session-export-custom-toggle"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/40 hover:text-fg ${
              showCustom
                ? "border-accent bg-accent/10 text-accent-fg"
                : "border-border bg-bg"
            }`}
          >
            <AdjustmentsHorizontalIcon className="size-3.5" />
            Custom
          </button>
        )}
      </div>
      {showCustom && (
        <ExportCustomForm sessionId={sessionId} port={port} base={base} />
      )}
    </div>
  );
}

function ExportCustomForm({
  port: _port,
  base,
}: {
  sessionId: string;
  port: number;
  base: string;
}) {
  const [format, setFormat] = useState<"md" | "json">("md");
  const [last, setLast] = useState<"10" | "25" | "50" | "100" | "all">("all");
  const [users, setUsers] = useState(true);
  const [aiFinal, setAiFinal] = useState(true);
  const [aiAll, setAiAll] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [tools, setTools] = useState(false);

  const params = new URLSearchParams();
  params.set("format", format);
  params.set("kind", "all");
  if (last !== "all") params.set("last", last);
  params.set("users", users ? "1" : "0");
  params.set("ai-all", aiAll ? "1" : "0");
  params.set("ai-final", aiFinal ? "1" : "0");
  params.set("thinking", thinking ? "1" : "0");
  params.set("tools", tools ? "1" : "0");
  const href = `${base}?${params.toString()}`;

  return (
    <div className="space-y-3 rounded-md border border-border bg-bg p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-muted-fg">Format</span>
        {(["md", "json"] as const).map((f) => (
          <label key={f} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="export-format"
              value={f}
              checked={format === f}
              onChange={() => setFormat(f)}
              className="size-3 accent-accent"
            />
            <span>{f === "md" ? "Markdown" : "JSON"}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-muted-fg">Last</span>
        {(["10", "25", "50", "100", "all"] as const).map((n) => (
          <label key={n} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="export-last"
              value={n}
              checked={last === n}
              onChange={() => setLast(n)}
              className="size-3 accent-accent"
            />
            <span>{n === "all" ? "all" : n}</span>
          </label>
        ))}
      </div>
      <div className="space-y-1.5">
        <span className="font-medium text-muted-fg">Include</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <CheckRow checked={users} onChange={setUsers} label="User prompts" />
          <CheckRow
            checked={aiFinal}
            onChange={setAiFinal}
            label="Final AI response"
          />
          <CheckRow checked={aiAll} onChange={setAiAll} label="All AI messages" />
          <CheckRow
            checked={thinking}
            onChange={setThinking}
            label="AI thinking"
          />
          <CheckRow checked={tools} onChange={setTools} label="Tool calls" />
        </div>
      </div>
      <div className="pt-1">
        <a
          href={href}
          download
          data-test="portal-session-export-custom-download"
          className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent/90"
        >
          <ArrowDownTrayIcon className="size-3.5" />
          Download {format === "md" ? "Markdown" : "JSON"}
        </a>
      </div>
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-accent"
      />
      <span>{label}</span>
    </label>
  );
}

export function ExportSessionModal({
  isOpen,
  sessionId,
  onOpenChange,
}: {
  isOpen: boolean;
  sessionId: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm"
    >
      <Modal className="w-full max-w-xl max-h-[85dvh] flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col flex-1 min-h-0 outline-none">
          {({ close }) => (
            <div className="flex flex-col flex-1 min-h-0">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold">Export session</h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="text-muted-fg hover:text-fg"
                >
                  <XMarkIcon className="size-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <ExportSection sessionId={sessionId} alwaysExpanded />
              </div>
            </div>
          )}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

function Field({
  label,
  value,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-fg">{label}</div>
      <div className="text-sm font-mono tabular-nums break-all">
        {loading ? <Loader className="size-3 inline-block" /> : value}
      </div>
    </div>
  );
}
