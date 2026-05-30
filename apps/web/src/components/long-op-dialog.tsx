import * as React from "react";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import {
  SparklesIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

export type LongOpKind = "clean" | "stuck-fix";

interface ProgressEvent {
  event: string;
  ts?: string;
  [key: string]: unknown;
}

interface LongOpDialogProps {
  kind: LongOpKind;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  sessionTitle: string | null;
  port: number;
  directory: string | null;
  onForkCreated?: (forkSessionId: string) => void;
}

type Phase = "idle" | "starting" | "running" | "completed" | "failed";

interface KindConfig {
  title: string;
  description: string;
  primaryCta: string;
  icon: React.ComponentType<{ className?: string }>;
  startPath: string;
  optionLabel: string;
  optionHint: string;
  optionRequestField: "aggressive" | "cleanBeforeCompaction";
}

type SessionDisposition = "archive" | "keep" | "delete" | "inline";

interface CleanDialogOptions {
  aggressive: boolean;
  keepIntermediateText: boolean;
  keepStepMarkers: boolean;
  stripUserSnapshots: boolean;
  stripSynthetic: boolean;
  pruneLoop: boolean;
  pruneTodowrite: boolean;
  pruneTask: boolean;
  pruneWebfetch: boolean;
  dropAfter: string;
  dropAfterPreserveUser: boolean;
  oldSessionDisposition: SessionDisposition;
}

const AGGRESSIVE_PRESET = {
  keepIntermediateText: false,
  keepStepMarkers: false,
  stripUserSnapshots: true,
  stripSynthetic: true,
} as const;

const DEFAULT_CLEAN_DIALOG_OPTIONS: CleanDialogOptions = {
  aggressive: false,
  keepIntermediateText: true,
  keepStepMarkers: true,
  stripUserSnapshots: false,
  stripSynthetic: false,
  pruneLoop: false,
  pruneTodowrite: false,
  pruneTask: false,
  pruneWebfetch: false,
  dropAfter: "",
  dropAfterPreserveUser: false,
  oldSessionDisposition: "archive",
};

const KIND_CONFIG: Record<LongOpKind, KindConfig> = {
  clean: {
    title: "Clean session",
    description:
      "Forks the session, drops duplicate \"continue\" prompts and " +
      "consecutive failed compaction summaries, blanks tool outputs + " +
      "reasoning + intermediate text, then archives the original. The " +
      "new (cleaned) fork inherits the original title. You'll be " +
      "navigated to it when done.",
    primaryCta: "Clean session",
    icon: SparklesIcon,
    startPath: "/api/session-ops/clean",
    optionLabel: "Aggressive mode",
    optionHint:
      "Also drop step markers + intermediate assistant text and strip user " +
      "snapshots. More savings, slightly more lossy.",
    optionRequestField: "aggressive",
  },
  "stuck-fix": {
    title: "Fix stuck compaction",
    description:
      "Recovers a session stuck on compaction-overflow. Picks a viable " +
      "revert point, forks at that point, dedups duplicate prompts + " +
      "failed compactions, triggers a fresh compaction, re-injects " +
      "completed turns past the revert point, resubmits any pending user " +
      "prompts. You'll be navigated to the recovered session when done.",
    primaryCta: "Run recovery",
    icon: WrenchScrewdriverIcon,
    startPath: "/api/session-ops/stuck-fix",
    optionLabel: "Pre-clean before compaction",
    optionHint:
      "Also run the session cleaner on the fork BEFORE compacting it. " +
      "Reduces the bytes handed to the LLM so the compaction cost is " +
      "smaller. Slower start, cheaper compaction.",
    optionRequestField: "cleanBeforeCompaction",
  },
};

const CLEAN_PHASE_LABEL: Record<string, string> = {
  spawned: "Starting clean-session...",
  started: "Analyzing session...",
  analyzed_before: "Analyzed. Preparing fork...",
  aborted: "Source session aborted",
  fork_resumed: "Resumed previous incomplete fork",
  fork_created: "Fork created",
  dedup_started: "Deduping duplicates...",
  dedup_completed: "Dedup done",
  cleaned: "Cleaning done",
  fork_renamed: "Renamed fork",
  disposition_applied: "Original session archived",
  moved_to_project: "Moved fork to project",
  prompt_resumed: "In-flight prompt resumed",
  done: "Done!",
};

const STUCK_FIX_PHASE_LABEL: Record<string, string> = {
  spawned: "Starting recovery...",
  started: "Initializing recovery...",
  overhead_measured: "Token overhead measured",
  walk_back_completed: "Revert point chosen",
  session_aborted: "Source session aborted",
  fork_created: "Fork created",
  audit_t0_injected: "Audit injected",
  dedup_started: "Deduping duplicates...",
  dedup_completed: "Dedup done",
  fork_cleaned: "Fork pre-cleaned",
  summarize_started: "Compaction call started...",
  summarize_returned: "Compaction call returned",
  summary_landed: "Compaction succeeded",
  completed_turns_injected: "Past turns injected",
  audit_t1_injected: "Audit finalized",
  fork_renamed: "Renamed fork",
  disposition_applied: "Original session archived",
  prompt_resubmitted: "Prompt resubmitted",
  waiting_for_pickup: "Waiting for fork to pick up prompt...",
  prompt_picked_up: "Fork picked up prompt",
  queue_timeout: "Prompt queued (pickup not yet observed)",
  done: "Done!",
};

function phaseLabel(kind: LongOpKind, event: string): string {
  const map = kind === "clean" ? CLEAN_PHASE_LABEL : STUCK_FIX_PHASE_LABEL;
  return map[event] ?? event;
}

function formatEventDetail(e: ProgressEvent): string | null {
  if (e.event === "dedup_completed") {
    const dups = (e.duplicates_dropped as number | undefined) ?? 0;
    const failed = (e.failed_compactions_dropped as number | undefined) ?? 0;
    if (dups === 0 && failed === 0) return "Nothing to dedup";
    const parts: string[] = [];
    if (dups > 0)
      parts.push(`${dups} duplicate prompt${dups === 1 ? "" : "s"}`);
    if (failed > 0)
      parts.push(`${failed} failed compaction${failed === 1 ? "" : "s"}`);
    return `Dropped: ${parts.join(", ")}`;
  }
  if (e.event === "fork_created" || e.event === "fork_resumed") {
    const fid = e.fork_session_id as string | undefined;
    if (fid) return `Fork: ${fid}`;
  }
  if (e.event === "cleaned") {
    const before = (e.bytes_before as number | undefined) ?? 0;
    const after = (e.bytes_after as number | undefined) ?? 0;
    if (before > 0) {
      const savedMb = ((before - after) / 1024 / 1024).toFixed(2);
      return `${savedMb} MB saved`;
    }
  }
  if (e.event === "summary_landed") {
    const tokens = e.compaction_tokens_used as number | undefined;
    if (tokens) return `${tokens.toLocaleString()} tokens used`;
  }
  return null;
}

export function LongOpDialog({
  kind,
  isOpen,
  onOpenChange,
  sessionId,
  sessionTitle,
  port,
  directory,
  onForkCreated,
}: LongOpDialogProps) {
  const config = KIND_CONFIG[kind];
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={false}
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm"
    >
      <Modal className="w-full max-w-xl flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col flex-1 min-h-0 outline-none">
          {({ close }) => (
            <Body
              kind={kind}
              config={config}
              sessionId={sessionId}
              sessionTitle={sessionTitle}
              port={port}
              directory={directory}
              onForkCreated={onForkCreated}
              onClose={close}
            />
          )}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

function Body({
  kind,
  config,
  sessionId,
  sessionTitle,
  port,
  directory,
  onForkCreated,
  onClose,
}: {
  kind: LongOpKind;
  config: KindConfig;
  sessionId: string;
  sessionTitle: string | null;
  port: number;
  directory: string | null;
  onForkCreated?: (forkSessionId: string) => void;
  onClose: () => void;
}) {
  const [option, setOption] = React.useState(false);
  const [cleanOptions, setCleanOptions] = React.useState<CleanDialogOptions>(
    DEFAULT_CLEAN_DIALOG_OPTIONS,
  );
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [events, setEvents] = React.useState<ProgressEvent[]>([]);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [forkId, setForkId] = React.useState<string | null>(null);
  const esRef = React.useRef<EventSource | null>(null);

  const lastEvent = events[events.length - 1] ?? null;
  const currentLabel = lastEvent
    ? phaseLabel(kind, lastEvent.event)
    : "Starting...";

  React.useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  const handleEvent = React.useCallback(
    (e: ProgressEvent) => {
      setEvents((prev) => [...prev, e]);

      if (
        (e.event === "fork_created" || e.event === "fork_resumed") &&
        typeof e.fork_session_id === "string"
      ) {
        setForkId(e.fork_session_id);
      }
      if (e.event === "done" && typeof e.fork_session_id === "string") {
        setForkId(e.fork_session_id);
      }

      if (e.event === "done") {
        const success = e.success !== false;
        if (success) {
          setPhase("completed");
        } else {
          setPhase("failed");
          const reason = (e.reason as string | undefined) ?? "Operation failed";
          setErrorMsg(reason);
        }
      }

      if (e.event === "process_exited" || e.event === "stream_end") {
        const code = e.code as number | null | undefined;
        const success = e.success === true;
        setPhase((current) => {
          if (current === "completed" || current === "failed") return current;
          if (success && code === 0) return "completed";
          setErrorMsg(
            code != null
              ? `Subprocess exited with code ${code}`
              : "Subprocess did not finish normally",
          );
          return "failed";
        });
      }

      if (e.event === "unknown_run") {
        setPhase("failed");
        setErrorMsg("Run not found on server (was the portal restarted?)");
      }
    },
    [],
  );

  const start = React.useCallback(async () => {
    setPhase("starting");
    setErrorMsg(null);
    setEvents([]);
    setForkId(null);
    try {
      const requestBody: Record<string, unknown> = {
        sessionId,
        port,
      };
      if (directory) requestBody.directory = directory;
      requestBody[config.optionRequestField] = option;
      if (kind === "clean") {
        requestBody.oldSessionDisposition = cleanOptions.oldSessionDisposition;
        requestBody.keepIntermediateText = cleanOptions.keepIntermediateText;
        requestBody.keepStepMarkers = cleanOptions.keepStepMarkers;
        requestBody.stripUserSnapshots = cleanOptions.stripUserSnapshots;
        requestBody.stripSynthetic = cleanOptions.stripSynthetic;
        requestBody.pruneLoop = cleanOptions.pruneLoop;
        requestBody.pruneTodowrite = cleanOptions.pruneTodowrite;
        requestBody.pruneTask = cleanOptions.pruneTask;
        requestBody.pruneWebfetch = cleanOptions.pruneWebfetch;
        requestBody.dropAfter = cleanOptions.dropAfter.trim();
        requestBody.dropAfterPreserveUser =
          cleanOptions.dropAfter.trim().length > 0 &&
          cleanOptions.dropAfterPreserveUser;
      }
      const res = await fetch(config.startPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; runId?: string; error?: string }
        | null;
      if (!res.ok || !json?.ok || !json.runId) {
        setPhase("failed");
        setErrorMsg(json?.error ?? `Failed to start (HTTP ${res.status})`);
        return;
      }
      const runId = json.runId;
      setPhase("running");
      const es = new EventSource(`/api/session-ops/${runId}/stream`);
      esRef.current = es;
      es.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as ProgressEvent;
          handleEvent(parsed);
        } catch {
          /* malformed line, skip */
        }
      };
      es.onerror = () => {
        es.close();
        esRef.current = null;
      };
    } catch (err) {
      setPhase("failed");
      setErrorMsg(err instanceof Error ? err.message : "Network error");
    }
  }, [
    cleanOptions,
    config,
    directory,
    handleEvent,
    kind,
    option,
    port,
    sessionId,
  ]);

  const setAggressive = React.useCallback((next: boolean) => {
    setOption(next);
    if (!next) return;
    setCleanOptions((prev) => ({
      ...prev,
      aggressive: true,
      keepIntermediateText: AGGRESSIVE_PRESET.keepIntermediateText,
      keepStepMarkers: AGGRESSIVE_PRESET.keepStepMarkers,
      stripUserSnapshots: AGGRESSIVE_PRESET.stripUserSnapshots,
      stripSynthetic: AGGRESSIVE_PRESET.stripSynthetic,
    }));
  }, []);

  const setCleanFlag = React.useCallback(
    (key: keyof CleanDialogOptions, value: boolean | SessionDisposition) => {
      setCleanOptions((prev) => {
        const next = { ...prev, [key]: value } as CleanDialogOptions;
        const aggressiveMatches =
          next.keepIntermediateText === AGGRESSIVE_PRESET.keepIntermediateText &&
          next.keepStepMarkers === AGGRESSIVE_PRESET.keepStepMarkers &&
          next.stripUserSnapshots === AGGRESSIVE_PRESET.stripUserSnapshots &&
          next.stripSynthetic === AGGRESSIVE_PRESET.stripSynthetic;
        const aggressive = option && aggressiveMatches;
        return { ...next, aggressive };
      });
      if (
        key === "keepIntermediateText" ||
        key === "keepStepMarkers" ||
        key === "stripUserSnapshots" ||
        key === "stripSynthetic"
      ) {
        setOption((current) => {
          if (!current) return current;
          const merged = {
            ...cleanOptions,
            [key]: value,
          } as CleanDialogOptions;
          const stillMatches =
            merged.keepIntermediateText === AGGRESSIVE_PRESET.keepIntermediateText &&
            merged.keepStepMarkers === AGGRESSIVE_PRESET.keepStepMarkers &&
            merged.stripUserSnapshots === AGGRESSIVE_PRESET.stripUserSnapshots &&
            merged.stripSynthetic === AGGRESSIVE_PRESET.stripSynthetic;
          return stillMatches;
        });
      }
    },
    [cleanOptions, option],
  );

  const busy = phase === "starting" || phase === "running";
  const completed = phase === "completed";
  const failed = phase === "failed";

  React.useEffect(() => {
    if (completed && forkId && onForkCreated) {
      const t = setTimeout(() => onForkCreated(forkId), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [completed, forkId, onForkCreated]);

  const Icon = config.icon;

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Icon className="size-4 text-muted-fg" />
          {config.title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          disabled={busy}
          className="inline-flex items-center justify-center size-7 rounded text-muted-fg hover:bg-muted hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
      <div className="flex flex-col gap-3 p-4 max-h-[70vh] overflow-y-auto">
        {phase === "idle" && (
          <>
            <p className="text-xs text-muted-fg whitespace-pre-line">
              {config.description}
            </p>
            <div className="rounded-md border border-border bg-bg/60 p-2 text-xs">
              <div className="text-muted-fg uppercase tracking-wide text-[10px]">
                Session
              </div>
              <div className="font-medium break-all mt-0.5">
                {sessionTitle ?? sessionId}
              </div>
              {sessionTitle && (
                <div className="font-mono text-muted-fg text-[11px] mt-0.5 break-all">
                  {sessionId}
                </div>
              )}
            </div>
            <label className="flex items-start gap-2 cursor-pointer rounded-md border border-border bg-bg/60 p-2">
              <input
                type="checkbox"
                checked={option}
                onChange={(e) => setAggressive(e.target.checked)}
                className="mt-0.5 size-4 accent-primary shrink-0"
                data-test={`portal-long-op-${kind}-option`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{config.optionLabel}</div>
                <div className="text-xs text-muted-fg mt-0.5">
                  {config.optionHint}
                </div>
              </div>
            </label>
            {kind === "clean" && (
              <div className="space-y-2 rounded-md border border-border bg-bg/60 p-2">
                <div className="text-xs font-medium">Mode-applied clean flags</div>
                <FlagCheckbox
                  checked={!cleanOptions.keepIntermediateText}
                  label="Prune intermediate assistant text"
                  hint="Aggressive enables this"
                  onChange={(checked) =>
                    setCleanFlag("keepIntermediateText", !checked)
                  }
                />
                <FlagCheckbox
                  checked={!cleanOptions.keepStepMarkers}
                  label="Prune step markers"
                  hint="Aggressive enables this"
                  onChange={(checked) => setCleanFlag("keepStepMarkers", !checked)}
                />
                <FlagCheckbox
                  checked={cleanOptions.stripUserSnapshots}
                  label="Strip user snapshots"
                  hint="Aggressive enables this"
                  onChange={(checked) =>
                    setCleanFlag("stripUserSnapshots", checked)
                  }
                />
                <FlagCheckbox
                  checked={cleanOptions.stripSynthetic}
                  label="Strip synthetic messages/parts"
                  hint="Aggressive enables this"
                  onChange={(checked) => setCleanFlag("stripSynthetic", checked)}
                />
              </div>
            )}
            {kind === "clean" && (
              <div className="space-y-2 rounded-md border border-border bg-bg/60 p-2">
                <div className="text-xs font-medium">Additional pruning flags</div>
                <FlagCheckbox
                  checked={cleanOptions.pruneLoop}
                  label="Prune compaction loops"
                  hint="Adds --prune-loop"
                  onChange={(checked) => setCleanFlag("pruneLoop", checked)}
                />
                <FlagCheckbox
                  checked={cleanOptions.pruneTodowrite}
                  label="Prune todowrite outputs"
                  hint="Adds --prune-todowrite"
                  onChange={(checked) => setCleanFlag("pruneTodowrite", checked)}
                />
                <FlagCheckbox
                  checked={cleanOptions.pruneTask}
                  label="Prune task/subagent outputs"
                  hint="Adds --prune-task"
                  onChange={(checked) => setCleanFlag("pruneTask", checked)}
                />
                <FlagCheckbox
                  checked={cleanOptions.pruneWebfetch}
                  label="Prune webfetch outputs"
                  hint="Adds --prune-webfetch"
                  onChange={(checked) => setCleanFlag("pruneWebfetch", checked)}
                />
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Drop after message id</span>
                  <input
                    type="text"
                    value={cleanOptions.dropAfter}
                    onChange={(e) =>
                      setCleanOptions((prev) => {
                        const nextDropAfter = e.target.value;
                        return {
                          ...prev,
                          dropAfter: nextDropAfter,
                          dropAfterPreserveUser:
                            nextDropAfter.trim().length > 0
                              ? prev.dropAfterPreserveUser
                              : false,
                        };
                      })
                    }
                    placeholder="msg_..."
                    className="h-9 rounded-md border border-input bg-bg px-2 text-xs font-mono"
                    data-test="portal-clean-drop-after"
                  />
                </label>
                <FlagCheckbox
                  checked={cleanOptions.dropAfterPreserveUser}
                  label="Preserve user prompts past drop-after"
                  hint="Adds --drop-after-preserve=user"
                  onChange={(checked) =>
                    setCleanFlag("dropAfterPreserveUser", checked)
                  }
                  disabled={cleanOptions.dropAfter.trim().length === 0}
                />
              </div>
            )}
            {kind === "clean" && (
              <div className="space-y-2 rounded-md border border-border bg-bg/60 p-2">
                <div>
                  <div className="text-xs font-medium">Old session disposition</div>
                  <p className="text-[11px] text-muted-fg">
                    Controls what happens to the original session after cleanup.
                  </p>
                </div>
                <Select
                  selectedKey={cleanOptions.oldSessionDisposition}
                  onSelectionChange={(key) => {
                    if (typeof key !== "string") return;
                    if (
                      key !== "archive" &&
                      key !== "keep" &&
                      key !== "delete" &&
                      key !== "inline"
                    ) {
                      return;
                    }
                    setCleanFlag("oldSessionDisposition", key);
                  }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    {cleanOptions.oldSessionDisposition}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem id="archive">archive (default)</SelectItem>
                    <SelectItem id="keep">keep original session</SelectItem>
                    <SelectItem id="delete">delete original session</SelectItem>
                    <SelectItem id="inline">inline (no fork)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        )}

        {(busy || completed || failed) && (
          <>
            <div className="rounded-md border border-border bg-bg/60 p-2 text-xs">
              <div className="text-muted-fg uppercase tracking-wide text-[10px]">
                Session
              </div>
              <div className="font-medium break-all mt-0.5">
                {sessionTitle ?? sessionId}
              </div>
            </div>

            <div
              className={`rounded-lg border p-3 space-y-2 ${
                completed
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : failed
                    ? "border-red-500/30 bg-red-500/5"
                    : "border-primary/30 bg-primary/5"
              }`}
            >
              <div className="flex items-center gap-2">
                {completed && (
                  <CheckCircleIcon className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                )}
                {failed && (
                  <ExclamationTriangleIcon className="size-5 text-red-600 dark:text-red-400 shrink-0" />
                )}
                {busy && <Loader className="size-5 text-primary shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg">
                    {completed
                      ? forkId
                        ? "Done! Opening the new session..."
                        : "Done."
                      : failed
                        ? "Failed"
                        : currentLabel}
                  </p>
                  {busy && (
                    <p className="text-xs text-muted-fg mt-0.5">
                      Hang tight - the work runs server-side and continues even
                      if you close this dialog. We'll open the new session as
                      soon as it's ready.
                    </p>
                  )}
                  {failed && errorMsg && (
                    <p className="text-xs text-red-700 dark:text-red-300 mt-0.5 break-words">
                      {errorMsg}
                    </p>
                  )}
                  {forkId && (
                    <p className="text-[11px] text-muted-fg font-mono mt-1 break-all">
                      New session: {forkId}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {events.length > 0 && (
              <div className="rounded border border-border bg-bg/40 p-2 text-[11px] font-mono space-y-0.5 max-h-48 overflow-y-auto">
                {events.map((e, i) => {
                  const detail = formatEventDetail(e);
                  return (
                    <div key={i} className="flex gap-2 text-muted-fg">
                      <span className="text-muted-fg/60 shrink-0">
                        {(i + 1).toString().padStart(2, " ")}
                      </span>
                      <span className="break-all">
                        <span className="text-fg/80">{phaseLabel(kind, e.event)}</span>
                        {detail && (
                          <span className="text-muted-fg/80 ml-1">— {detail}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
        {phase === "idle" && (
          <>
            <Button intent="outline" size="sm" onPress={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onPress={() => void start()}
              data-test={`portal-long-op-${kind}-confirm`}
            >
              <Icon className="size-4" data-slot="icon" />
              {config.primaryCta}
            </Button>
          </>
        )}
        {busy && (
          <Button intent="outline" size="sm" isDisabled>
            Working...
          </Button>
        )}
        {completed && (
          <Button intent="outline" size="sm" onPress={onClose}>
            Close
          </Button>
        )}
        {failed && (
          <>
            <Button intent="outline" size="sm" onPress={onClose}>
              Close
            </Button>
            <Button size="sm" onPress={() => void start()}>
              Retry
            </Button>
          </>
        )}
      </div>
    </>
  );
}

function FlagCheckbox({
  checked,
  label,
  hint,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-2 rounded border border-border/80 bg-bg/40 p-2 ${
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-primary shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[11px] text-muted-fg mt-0.5">{hint}</div>
      </div>
    </label>
  );
}
