import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Ripples } from "ldrs/react";
import "ldrs/react/Ripples.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader } from "@/components/ui/loader";
import { AgentSelect } from "@/components/agent-select";
import { ModelSelect } from "@/components/model-select";
import {
  FileMentionPopover,
  useFileMention,
} from "@/components/file-mention-popover";
import IconBadgeSparkle from "@/components/icons/badge-sparkle-icon";
import IconUser from "@/components/icons/user-icon";
import IconMagnifier from "@/components/icons/magnifier-icon";
import IconEye from "@/components/icons/eye-icon";
import IconPen from "@/components/icons/pen-icon";
import IconSquareFeather from "@/components/icons/feather-icon";
import SendIcon from "@/components/icons/send-icon";
import { PaperClipIcon, PhotoIcon } from "@heroicons/react/24/outline";
import {
  PlayIcon,
  StopIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronDoubleDownIcon,
} from "@heroicons/react/24/solid";
import { useAgentStore } from "@/stores/agent-store";
import { useComposerStore } from "@/stores/composer-store";
import { useInstanceStore } from "@/stores/instance-store";
import { useModelStore } from "@/stores/model-store";
import { useBreadcrumb } from "@/contexts/breadcrumb-context";
import {
  useSessionMessages,
  addOptimisticMessage,
  mutateSessionMessages,
  type MessageWithParts,
  type Part,
  type ToolPart,
  type FilePart,
  type PermissionRequest,
  type QuestionAnswer,
  type QuestionInfo,
  type QuestionRequest,
} from "@/hooks/use-session-messages";
import { useSessions } from "@/hooks/use-opencode";
import useMediaQuery from "@/hooks/use-media-query";
import type { Session } from "@opencode-ai/sdk";

export const Route = createFileRoute("/_app/session/$id")({
  component: SessionPage,
});

export interface PromptAttachment {
  mime: string;
  filename?: string;
  url: string;
}

// Mirrors DEFAULT_INITIAL_LIMIT in
// apps/web/src/server/opencode/[port]/session/[id]/messages.ts. Kept in
// sync manually since the value crosses the client/server boundary; if
// the server raises its limit, this only affects when the "Load earlier
// messages" button stops appearing on otherwise-fully-loaded sessions.
const INITIAL_MESSAGE_LIMIT = 50;

type PermissionReply = "once" | "always" | "reject";



function isToolPart(part: Part): part is ToolPart {
  return part.type === "tool";
}

function isFilePart(part: Part): part is FilePart {
  return part.type === "file";
}

function safeJsonParse(
  text: string,
): { message?: unknown; error?: unknown; statusMessage?: unknown } | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `Failed to send message (HTTP ${response.status})`;
  try {
    const text = await response.text();
    if (!text) return fallback;
    const parsed = safeJsonParse(text);
    const fromJson =
      parsed &&
      ((typeof parsed.message === "string" && parsed.message) ||
        (typeof parsed.statusMessage === "string" && parsed.statusMessage) ||
        (typeof parsed.error === "string" && parsed.error));
    return fromJson || text;
  } catch {
    return fallback;
  }
}

function parseToolQuestions(part: ToolPart): QuestionInfo[] {
  const input = (part.state?.input || {}) as Record<string, unknown>;
  const rawQuestions = input.questions;

  console.log("[parseToolQuestions] raw input:", JSON.stringify(input, null, 2));

  if (!Array.isArray(rawQuestions)) {
    return [];
  }

  return rawQuestions
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    )
    .map((item) => {
      console.log("[parseToolQuestions] raw question item:", JSON.stringify(item, null, 2));
      console.log("[parseToolQuestions] custom field:", item.custom, "type:", typeof item.custom);
      return {
        question: String(item.question || ""),
        header: String(item.header || ""),
        options: Array.isArray(item.options)
          ? item.options
              .filter(
                (opt): opt is Record<string, unknown> =>
                  typeof opt === "object" && opt !== null,
              )
              .map((opt) => ({
                label: String(opt.label || ""),
                description: String(opt.description || ""),
              }))
              .filter((opt) => !!opt.label)
          : [],
        multiple: Boolean(item.multiple),
        custom: item.custom !== false,
      };
    })
    .filter((q) => !!q.question);
}

function formatToolCall(part: ToolPart): {
  icon: React.ReactNode;
  label: string;
  details?: string;
} {
  const toolName = part.tool?.toLowerCase() || "";
  const input = (part.state?.input || {}) as Record<string, unknown>;

  switch (toolName) {
    case "edit": {
      const filePath = input.filePath || input.file || "";
      const oldStr = String(input.oldString || "");
      const newStr = String(input.newString || "");
      const additions = newStr.split("\n").length;
      const deletions = oldStr.split("\n").length;
      return {
        icon: <IconPen size="12px" />,
        label: `edit ${filePath}`,
        details: `(+${additions}-${deletions})`,
      };
    }
    case "read": {
      const filePath = input.filePath || input.file || "";
      return {
        icon: <IconEye size="12px" />,
        label: `read ${filePath}`,
      };
    }
    case "write": {
      const filePath = input.filePath || input.file || "";
      const content = String(input.content || "");
      const lines = content.split("\n").length;
      return {
        icon: <IconSquareFeather size="12px" />,
        label: `write ${filePath}`,
        details: `(${lines} lines)`,
      };
    }
    case "bash": {
      const command = String(input.command || input.cmd || "");
      const shortCmd = command.split("\n")[0]?.slice(0, 50) || "";
      return {
        icon: "$",
        label: `bash ${shortCmd}${command.length > 50 ? "..." : ""}`,
        details: input.description ? `# ${input.description}` : undefined,
      };
    }
    case "glob": {
      const pattern = input?.pattern || "";
      const path = input?.path || "";
      return {
        icon: <IconMagnifier size="12px" />,
        label: `glob ${pattern}`,
        details: path ? `in ${path}` : undefined,
      };
    }
    case "grep": {
      const pattern = input.pattern || "";
      const path = input.path || "";
      return {
        icon: "◼︎",
        label: `grep "${pattern}"`,
        details: path ? `in ${path}` : undefined,
      };
    }
    case "question": {
      const questions = Array.isArray(input.questions) ? input.questions : [];
      const count = questions.length;
      return {
        icon: "?",
        label: count === 1 ? "Asked 1 question" : `Asked ${count} questions`,
      };
    }
    default: {
      // The previous fallback was: `${key}: ${String(value).slice(0,30)}...`,
      // which produced "questions: [object Object],[object Object]..." for any
      // tool whose first argument is a non-primitive (the question tool, but
      // also any future tool with array/object inputs). Show only primitive
      // first-args; otherwise omit details and let the tool body render below
      // tell the story.
      const firstArg = Object.entries(input).find(
        ([, value]) =>
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean",
      );
      return {
        icon: "◼︎",
        label: toolName || "unknown",
        details: firstArg
          ? `${firstArg[0]}: ${String(firstArg[1]).slice(0, 30)}...`
          : undefined,
      };
    }
  }
}

function QuestionDisplay({
  questions,
  partKey,
}: {
  questions: QuestionInfo[];
  partKey: string;
}) {
  return (
    <>
      {questions.map((q, idx) => (
        <div key={`${partKey}-q-${idx}`} className="space-y-1">
          {(q.header || q.multiple) && (
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-fg">
              {q.header && <span>{q.header}</span>}
              {q.multiple && (
                <span className="rounded border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                  Multi-select
                </span>
              )}
            </div>
          )}
          <p className="text-xs leading-relaxed">{q.question}</p>

          {q.options.length > 0 && (
            <ul className="space-y-1 ml-3 list-disc text-muted-fg">
              {q.options.map((opt, optIdx) => (
                <li key={`opt-${idx}-${optIdx}`}>
                  <span className="text-fg">{opt.label}</span>
                  {opt.description && (
                    <span className="text-muted-fg"> - {opt.description}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {(q.multiple || q.custom) && (
            <div className="text-[11px] text-muted-fg">
              {q.multiple && "You can select multiple options"}
              {q.multiple && q.custom && " | "}
              {q.custom && "Custom answer allowed"}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function getMessageContent(parts: Part[]): string {
  return parts
    .filter(
      (part): part is Part & { type: "text"; text: string } =>
        part.type === "text" && "text" in part && !!part.text?.trim(),
    )
    .map((part) => part.text)
    .join("\n\n");
}

function QuestionAnswerForm({
  questions,
  partKey,
  port,
  sessionId,
  callID,
  isAssistantBusy,
  onAbort,
}: {
  questions: QuestionInfo[];
  partKey: string;
  port: number;
  sessionId: string;
  callID: string;
  isAssistantBusy: boolean;
  onAbort: () => void;
}) {
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [freeformInputs, setFreeformInputs] = useState<Record<number, string>>({});
  const [isPosting, setIsPosting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const toggleOption = (qIdx: number, label: string, isMulti: boolean) => {
    setSelections((prev) => {
      const current = prev[qIdx] || [];
      if (isMulti) {
        return {
          ...prev,
          [qIdx]: current.includes(label)
            ? current.filter((l) => l !== label)
            : [...current, label],
        };
      }
      return { ...prev, [qIdx]: current.includes(label) ? [] : [label] };
    });
  };

  const handleSubmit = async () => {
    setIsPosting(true);
    setSubmitError(null);

    try {
      const listRes = await fetch(`/api/opencode/${port}/questions`);
      if (!listRes.ok) throw new Error("Failed to fetch pending questions");
      const pendingQuestions = (await listRes.json()) as QuestionRequest[];

      const match =
        pendingQuestions.find((q) => q.tool?.callID === callID) ??
        pendingQuestions.find((q) => q.sessionID === sessionId);

      if (!match) {
        throw new Error("Question request not found - it may have already been answered");
      }

      const answers: QuestionAnswer[] = questions.map((_, i) => {
        const selected = selections[i] || [];
        const freeform = freeformInputs[i]?.trim() || "";
        if (selected.length > 0) return selected;
        if (freeform) return [freeform];
        return [];
      });

      const replyRes = await fetch(
        `/api/opencode/${port}/question/${match.id}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        },
      );

      if (!replyRes.ok) {
        throw new Error(await readErrorMessage(replyRes));
      }

      mutateSessionMessages(port, sessionId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit answers");
    } finally {
      setIsPosting(false);
    }
  };

  const hasAnswersForAllQuestions =
    questions.length > 0 &&
    questions.every((_, i) => {
      const selected = selections[i] || [];
      const freeform = freeformInputs[i]?.trim() || "";
      return selected.length > 0 || freeform.length > 0;
    });

  return (
    <div className="mt-2 space-y-3 text-fg/90">
      {questions.map((q, idx) => {
        const selected = selections[idx] || [];

        return (
          <div key={`${partKey}-q-${idx}`} className="space-y-1.5">
            {(q.header || q.multiple) && (
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-fg">
                {q.header && <span>{q.header}</span>}
                {q.multiple && (
                  <span className="rounded border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                    Multi-select
                  </span>
                )}
              </div>
            )}
            <p className="text-xs leading-relaxed">{q.question}</p>

            {q.options.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt, optIdx) => {
                  const isSelected = selected.includes(opt.label);
                  return (
                    <button
                      key={`opt-${idx}-${optIdx}`}
                      type="button"
                      disabled={isPosting || isAssistantBusy}
                      onClick={() => toggleOption(idx, opt.label, !!q.multiple)}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-bg hover:border-fg/30 text-fg/80"
                      } ${isPosting || isAssistantBusy ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <span>{opt.label}</span>
                      {opt.description && (
                        <span className="opacity-60"> - {opt.description}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {(q.options.length === 0 || q.custom) && (
              <input
                type="text"
                disabled={isPosting || isAssistantBusy}
                placeholder="Type your answer..."
                value={freeformInputs[idx] || ""}
                onChange={(e) =>
                  setFreeformInputs((prev) => ({ ...prev, [idx]: e.target.value }))
                }
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg placeholder:text-muted-fg focus:outline-none focus:border-primary"
              />
            )}

            {q.multiple && (
              <div className="text-[11px] text-warning/90">
                You can select more than one option
              </div>
            )}
          </div>
        );
      })}

      {submitError && (
        <div className="text-[11px] text-danger">{submitError}</div>
      )}

      <div className="mt-1 flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          isDisabled={!hasAnswersForAllQuestions || isPosting || isAssistantBusy}
          onPress={handleSubmit}
          className="text-xs"
        >
          <SendIcon size="12px" />
          {isPosting ? "Sending..." : "Submit Answers"}
        </Button>
        {isAssistantBusy && !isPosting && (
          <Button
            type="button"
            size="sm"
            intent="danger"
            onPress={onAbort}
            aria-label="Stop the current run"
            className="text-xs"
          >
            <StopIcon className="size-3" />
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}

function PermissionRequestForm({
  permission,
  port,
  onResolved,
}: {
  permission: PermissionRequest;
  port: number;
  onResolved: (requestId: string) => void;
}) {
  const [submitting, setSubmitting] = useState<PermissionReply | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleReply = async (reply: PermissionReply) => {
    setSubmitting(reply);
    setSubmitError(null);

    try {
      const response = await fetch(
        `/api/opencode/${port}/permission/${permission.id}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to reply to permission request");
      }

      onResolved(permission.id);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to reply to permission",
      );
      setSubmitting(null);
    }
  };

  const firstPattern = permission.patterns[0];

  return (
    <div className="mt-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs space-y-2">
      <div className="font-medium text-warning">Permission required</div>
      <div className="text-fg/90">
        Tool requests <span className="font-mono">{permission.permission}</span>
      </div>
      {firstPattern && (
        <div className="text-muted-fg break-all">
          Path: <span className="font-mono">{firstPattern}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <Button
          type="button"
          size="sm"
          isDisabled={!!submitting}
          onPress={() => handleReply("once")}
        >
          {submitting === "once" ? "Allowing..." : "Allow once"}
        </Button>
        <Button
          type="button"
          size="sm"
          isDisabled={!!submitting}
          onPress={() => handleReply("always")}
          className="bg-success/20 text-success hover:bg-success/25"
        >
          {submitting === "always" ? "Saving..." : "Allow always"}
        </Button>
        <Button
          type="button"
          size="sm"
          isDisabled={!!submitting}
          onPress={() => handleReply("reject")}
          className="bg-danger/20 text-danger hover:bg-danger/25"
        >
          {submitting === "reject" ? "Rejecting..." : "Reject"}
        </Button>
      </div>
      {submitError && <div className="text-danger">{submitError}</div>}
    </div>
  );
}

const ToolCallItem = memo(function ToolCallItem({
  part,
  port,
  sessionId,
  isAssistantBusy,
  onAbort,
}: {
  part: ToolPart;
  port: number;
  sessionId: string;
  isAssistantBusy: boolean;
  onAbort: () => void;
}) {
  const { icon, label, details } = formatToolCall(part);
  const isQuestionTool = (part.tool || "").toLowerCase() === "question";
  const questions = isQuestionTool ? parseToolQuestions(part) : [];
  const hasQuestions = questions.length > 0;
  const isCompleted = part.state.status === "completed";
  const isError = part.state.status === "error";
  const isPending =
    part.state.status === "pending" || part.state.status === "running";

  if (hasQuestions) {
    return (
      <div
        className={`rounded-md border px-3 py-2 text-xs ${
          isError
            ? "border-danger/40 bg-danger-subtle/30"
            : isCompleted
              ? "border-border bg-muted/25"
              : "border-warning/40 bg-warning/10"
        }`}
      >
        <div className="font-mono text-xs flex items-center gap-1.5 min-w-0">
          <span className="opacity-60 shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
          {details && <span className="opacity-60 shrink-0">{details}</span>}
          {isPending && <span className="animate-pulse shrink-0">...</span>}
        </div>

        {isPending && port ? (
          <QuestionAnswerForm
            questions={questions}
            partKey={part.callID || part.id}
            port={port}
            sessionId={sessionId}
            callID={part.callID || ""}
            isAssistantBusy={isAssistantBusy}
            onAbort={onAbort}
          />
        ) : (
          <div className="mt-2 space-y-2 text-fg/90">
            <QuestionDisplay
              questions={questions}
              partKey={part.callID || part.id}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`font-mono text-xs flex items-center gap-1.5 py-0.5 min-w-0 ${
        isError
          ? "text-danger"
          : isCompleted
            ? "text-muted-fg"
            : isPending
              ? "text-warning"
              : "text-fg"
      }`}
    >
      <span className="opacity-60 shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {details && <span className="opacity-60 shrink-0">{details}</span>}
      {isPending && <span className="animate-pulse shrink-0">...</span>}
    </div>
  );
});

// "Thinking... 3m ago" - rough wall-clock since the last message arrived.
// When opencode hangs (thinks it's still running but stopped emitting), the
// number keeps growing past the model's typical response time, giving the
// user a clear signal something is wrong without having to know the
// expected latency for their model.
//
// Refresh cadence: every 15s for the first minute (so the user sees
// "15s ago" / "30s ago" / "45s ago" instead of nothing for the
// suspicious-but-not-yet-broken window), then every 60s once we tip into
// the minutes / hours / days range. The interval is torn down on unmount.
//
// We pick the cadence based on the CURRENT staleness, then the effect
// re-runs whenever that bucket changes - so the timer rate self-adjusts
// as the gap grows. No tight 1Hz polling on mobile.
function ThinkingStaleness({ messages }: { messages: MessageWithParts[] }) {
  const [now, setNow] = useState(() => Date.now());
  const last = messages[messages.length - 1];
  const lastTime = last?.info.time.created;
  const elapsed = lastTime ? now - lastTime : 0;
  const useFastTick = elapsed < 60_000;

  useEffect(() => {
    const period = useFastTick ? 15_000 : 60_000;
    const id = window.setInterval(() => setNow(Date.now()), period);
    return () => window.clearInterval(id);
  }, [useFastTick]);

  if (!lastTime) return null;
  // Don't render until at least 15s has passed; below that the user has
  // no reason to wonder if something's off.
  if (elapsed < 15_000) return null;

  let label: string;
  if (elapsed < 60_000) {
    // 15 / 30 / 45 second buckets.
    const seconds = Math.floor(elapsed / 15_000) * 15;
    label = `${seconds}s ago`;
  } else {
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 60) {
      label = `${minutes}m ago`;
    } else if (minutes < 1440) {
      label = `${Math.floor(minutes / 60)}h ago`;
    } else {
      label = `${Math.floor(minutes / 1440)}d ago`;
    }
  }
  return <span className="text-xs text-muted-fg/70">{label}</span>;
}

function RevertIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className={className}
    >
      <path
        d="M5.83333 4.16406L2.5 7.4974L5.83333 10.8307M3.33333 7.4974H17.9167V15.4141H10"
        stroke="currentColor"
        strokeLinecap="square"
      />
    </svg>
  );
}

function AttachmentChip({ part }: { part: FilePart }) {
  const isImage = part.mime?.startsWith("image/");
  const Icon = isImage ? PhotoIcon : PaperClipIcon;
  const label = part.filename || (isImage ? "image" : part.mime || "attachment");
  return (
    <a
      href={part.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 max-w-full rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-fg/90 hover:border-fg/30 hover:bg-muted transition-colors"
      title={label}
    >
      <Icon className="size-3 shrink-0 text-muted-fg" />
      <span className="truncate">{label}</span>
    </a>
  );
}

const MessageItem = memo(function MessageItem({
  message,
  port,
  sessionId,
  pendingPermissions,
  onPermissionResolved,
  isAssistantBusy,
  onAbort,
  pendingDelete,
  onRevertRequest,
}: {
  message: MessageWithParts;
  port: number;
  sessionId: string;
  pendingPermissions: PermissionRequest[];
  onPermissionResolved: (requestId: string) => void;
  isAssistantBusy: boolean;
  onAbort: () => void;
  pendingDelete: boolean;
  onRevertRequest: (message: MessageWithParts, text: string) => void;
}) {
  const textContent = getMessageContent(message.parts);
  const isAssistant = message.info.role === "assistant";
  const toolCalls = message.parts.filter(isToolPart);
  const fileParts = message.parts.filter(isFilePart);
  const messagePermissions = pendingPermissions.filter(
    (perm) => perm.tool?.messageID === message.info.id,
  );
  const messageError =
    message.info.role === "assistant" ? message.info.error : null;
  const errorDescription = messageError
    ? describeMessageError(messageError)
    : null;

  const hasHeaderRow = textContent || fileParts.length > 0;
  // Visual decoration when a revert is staged: gray tone + strike-through.
  // Nothing is destroyed in the backend yet - the actual truncate happens
  // only when the user submits a new message.
  const decoration = pendingDelete
    ? "opacity-50 line-through"
    : "";
  return (
    <div
      className={`py-3 px-6 ${decoration}`}
      // The role + id pair lets the prompt-nav buttons (prev / next user
      // message) find each user message in the DOM and scroll it into view
      // without lifting the message list into a controlled-scroll system.
      data-role={message.info.role}
      data-message-id={message.info.id}
    >
      {hasHeaderRow && (
        <div className="flex gap-2">
          <div className="shrink-0 mt-1 flex flex-col items-center gap-1">
            {isAssistant ? (
              <IconBadgeSparkle size="16px" />
            ) : (
              <IconUser size="16px" />
            )}
            <button
              type="button"
              onClick={() => onRevertRequest(message, textContent)}
              className="text-muted-fg hover:text-fg transition-colors"
              aria-label={
                isAssistant
                  ? "Revert to right after this message"
                  : "Revert to before this message"
              }
              title={
                isAssistant
                  ? "Revert to right after this message"
                  : "Revert to before this message"
              }
            >
              <RevertIcon className="size-3.5" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            {!isAssistant && message.isQueued && (
              <Badge intent="warning" className="mb-1">
                Queued
              </Badge>
            )}
            {textContent && (
              <div
                className={`prose prose-sm dark:prose-invert max-w-none break-words [&_pre]:overflow-x-auto [&_code]:break-words [&_code]:[overflow-wrap:anywhere] ${!isAssistant ? "text-muted-fg" : ""}`}
              >
                <Markdown
                  remarkPlugins={
                    isAssistant ? [remarkGfm] : [remarkGfm, remarkBreaks]
                  }
                >
                  {textContent}
                </Markdown>
              </div>
            )}
            {fileParts.length > 0 && (
              <div
                className={`${textContent ? "mt-2" : ""} flex flex-wrap gap-1.5`}
              >
                {fileParts.map((part) => (
                  <AttachmentChip key={part.id} part={part} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {toolCalls.length > 0 && (
        <div
          className={`${hasHeaderRow ? "mt-2 ml-6" : ""} space-y-0.5`}
        >
          {toolCalls.map((part) => (
            <ToolCallItem
              key={part.callID || part.id}
              part={part}
              port={port}
              sessionId={sessionId}
              isAssistantBusy={isAssistantBusy}
              onAbort={onAbort}
            />
          ))}
        </div>
      )}
      {messagePermissions.length > 0 && (
        <div className={`${textContent ? "mt-2 ml-6" : ""} space-y-2`}>
          {messagePermissions.map((permission) => (
            <PermissionRequestForm
              key={permission.id}
              permission={permission}
              port={port}
              onResolved={onPermissionResolved}
            />
          ))}
        </div>
      )}
      {errorDescription && (
        <div
          className={`${textContent || toolCalls.length > 0 ? "mt-2 ml-6" : ""} rounded-md border border-danger/40 bg-danger-subtle/30 p-3 text-xs text-danger-subtle-fg`}
        >
          <div className="font-semibold">{errorDescription.title}</div>
          {errorDescription.detail && (
            <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
              {errorDescription.detail}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function hasVisibleContent(message: MessageWithParts): boolean {
  const textContent = getMessageContent(message.parts);
  const hasToolCalls = message.parts.some(isToolPart);
  const hasFiles = message.parts.some(isFilePart);
  // An assistant turn that fails before producing any text or tool call still
  // carries info.error and must remain visible, otherwise a failed prompt
  // looks indistinguishable from the assistant being idle.
  const hasError =
    message.info.role === "assistant" && message.info.error != null;
  return !!(textContent || hasToolCalls || hasFiles || hasError);
}

function describeMessageError(
  error: NonNullable<
    Extract<MessageWithParts["info"], { role: "assistant" }>["error"]
  >,
): { title: string; detail?: string } {
  switch (error.name) {
    case "APIError": {
      const status = error.data.statusCode;
      return {
        title: status
          ? `Provider API error (HTTP ${status})`
          : "Provider API error",
        detail: error.data.message,
      };
    }
    case "ProviderAuthError":
      return {
        title: `Provider auth error (${error.data.providerID})`,
        detail: error.data.message,
      };
    case "MessageAbortedError":
      return { title: "Aborted", detail: error.data.message };
    case "MessageOutputLengthError":
      return {
        title: "Output length exceeded",
        detail: "The model response hit its maximum length.",
      };
    case "UnknownError":
    default:
      return { title: "Unknown error", detail: error.data?.message };
  }
}

function ModelOverrideControl({
  isOverriding,
  sessionId,
  instanceId,
}: {
  isOverriding: boolean;
  sessionId: string;
  instanceId: string | null;
}) {
  return (
    <div
      className={`w-full min-w-0${
        isOverriding ? " rounded-lg ring-1 ring-primary/50" : ""
      }`}
    >
      <ModelSelect sessionId={sessionId} instanceId={instanceId} />
    </div>
  );
}

const DRAFT_KEY_PREFIX = "opencode-composer-draft:";
const DRAFT_MIN_BYTES = 10;

function getDraftKey(sessionId: string) {
  return `${DRAFT_KEY_PREFIX}${sessionId}`;
}

function readDraft(sessionId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(getDraftKey(sessionId)) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(sessionId: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(getDraftKey(sessionId), value);
    } else {
      window.localStorage.removeItem(getDraftKey(sessionId));
    }
  } catch {
    // localStorage can throw under quota / privacy modes; the draft is
    // best-effort, never a hard requirement.
  }
}

function SessionPage() {
  const { id: sessionId } = Route.useParams();
  const instance = useInstanceStore((s) => s.instance);
  const port = instance?.port ?? 0;

  const [loadAllMessages, setLoadAllMessages] = useState(false);
  const {
    messages,
    isLoading: loading,
    error: messagesError,
  } = useSessionMessages(sessionId, { loadAll: loadAllMessages });
  const { data: sessionsData, mutate: mutateSessions } = useSessions();
  const instanceId = instance?.id ?? null;
  const resolveModel = useModelStore((s) => s.resolveModel);
  const isOverridingDefaultFn = useModelStore((s) => s.isOverridingDefault);
  const selectedModel = resolveModel(sessionId, instanceId);
  const isOverridingDefault = useCallback(
    () => isOverridingDefaultFn(sessionId, instanceId),
    [isOverridingDefaultFn, sessionId, instanceId],
  );
  const selectedAgent = useAgentStore((s) => s.getSelectedAgent(sessionId));
  const enterKeyAction = useComposerStore((s) => s.enterKeyAction);
  const { isMobile } = useMediaQuery();
  const { setPageTitle } = useBreadcrumb();

  const sessions: Session[] = sessionsData ?? [];
  const currentSession = sessions.find((s) => s.id === sessionId);

  useEffect(() => {
    if (currentSession?.title) {
      setPageTitle(currentSession.title);
    }
    return () => setPageTitle(null);
  }, [currentSession?.title, setPageTitle]);

  const [sendError, setSendError] = useState<string | null>(null);
  const [hasContent, setHasContent] = useState(false);
  const [revertTarget, setRevertTarget] = useState<{
    mode: "user" | "assistant";
    messageId: string;
  } | null>(null);
  const [sending, setSending] = useState(false);

  // The assistant is "busy" whenever the most recent message is from the
  // user (not yet answered) or from the assistant but missing
  // `time.completed`, which OpenCode only sets when the turn fully
  // finishes. This drives the Stop button + Thinking indicator and is
  // independent of `sending`, which only covers the brief POST round-trip.
  const isAssistantBusy = useMemo(() => {
    if (messages.length === 0) return false;
    const last = messages[messages.length - 1];
    if (!last) return false;
    if (last.info.role === "user") return true;
    const completed = (last.info as { time?: { completed?: number } }).time
      ?.completed;
    return !completed;
  }, [messages]);
  const [pendingPermissions, setPendingPermissions] = useState<
    PermissionRequest[]
  >([]);
  const [hasScrolledInitially, setHasScrolledInitially] = useState(false);
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<
    PromptAttachment[]
  >([]);
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesListRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileAttachInputRef = useRef<HTMLInputElement>(null);
  const isStuckToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const fileMention = useFileMention();

  const error = messagesError?.message || sendError;

  const refreshPendingPermissions = useCallback(async () => {
    if (!port || !sessionId) {
      setPendingPermissions([]);
      return;
    }

    try {
      const response = await fetch(`/api/opencode/${port}/permissions`);
      if (!response.ok) return;
      const data = (await response.json()) as PermissionRequest[];
      setPendingPermissions(
        data.filter((item) => item.sessionID === sessionId),
      );
    } catch {
      // Keep current UI state on transient permission polling failures.
    }
  }, [port, sessionId]);

  const handlePermissionResolved = useCallback(
    (requestId: string) => {
      setPendingPermissions((prev) => prev.filter((p) => p.id !== requestId));
      if (port && sessionId) {
        mutateSessionMessages(port, sessionId);
      }
      refreshPendingPermissions();
    },
    [port, sessionId, refreshPendingPermissions],
  );

  useEffect(() => {
    refreshPendingPermissions();

    if (!port || !sessionId) return;

    const interval = window.setInterval(refreshPendingPermissions, 2000);
    return () => window.clearInterval(interval);
  }, [port, sessionId, refreshPendingPermissions]);

  const visibleMessageIds = useMemo(
    () => new Set(messages.map((m) => m.info.id)),
    [messages],
  );
  const unlinkedPermissions = pendingPermissions.filter(
    (perm) => !perm.tool?.messageID || !visibleMessageIds.has(perm.tool.messageID),
  );

  // Sticky-bottom semantics:
  //   - If the user is at the very bottom (within STICK_EPSILON pixels), we
  //     are 'stuck' and any new content auto-scrolls to keep them at the
  //     bottom. Any upward scroll, even by 1px, unsticks. Scrolling all the
  //     way down re-sticks.
  //   - Auto-scroll is keyed off a ResizeObserver on the message list, not
  //     just messages.length, so a growing assistant turn (same message id,
  //     text expanding as the model streams) keeps the viewport pinned.
  const STICK_EPSILON = 1;

  const scrollToBottom = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, []);

  const recomputeStuck = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) {
      return isStuckToBottomRef.current;
    }
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isStuck = distanceFromBottom <= STICK_EPSILON;
    isStuckToBottomRef.current = isStuck;
    setShowJumpToBottom(!isStuck);
    return isStuck;
  }, []);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const handleScroll = () => recomputeStuck();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [recomputeStuck]);

  useEffect(() => {
    const list = messagesListRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (isStuckToBottomRef.current) {
        scrollToBottom();
      }
      recomputeStuck();
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [recomputeStuck, scrollToBottom]);

  useEffect(() => {
    if (!hasScrolledInitially && !loading && messages.length > 0) {
      setTimeout(() => {
        scrollToBottom();
        setHasScrolledInitially(true);
        isStuckToBottomRef.current = true;
        setShowJumpToBottom(false);
      }, 100);
    }
  }, [hasScrolledInitially, loading, messages.length, scrollToBottom]);

  useEffect(() => {
    setHasScrolledInitially(false);
    isStuckToBottomRef.current = true;
    setShowJumpToBottom(false);
  }, [sessionId]);

  const handleJumpToBottom = useCallback(() => {
    scrollToBottom();
    isStuckToBottomRef.current = true;
    setShowJumpToBottom(false);
  }, [scrollToBottom]);

  // Walk the message list (DOM-side, by data-role attribute) to find the
  // nearest user message above or below the current scroll position. We
  // anchor on the top edge of each message: previous = highest top that's
  // still above the viewport's top; next = lowest top that's still below
  // the viewport's top. A small epsilon (1px) prevents getting stuck on
  // the user message that's currently at the top of the viewport when the
  // user clicks "previous".
  const handleJumpUserPrompt = useCallback(
    (direction: "previous" | "next") => {
      const container = chatContainerRef.current;
      if (!container) return;
      const userNodes = Array.from(
        container.querySelectorAll<HTMLElement>('[data-role="user"]'),
      );
      if (userNodes.length === 0) return;

      const containerRect = container.getBoundingClientRect();
      const offsets = userNodes.map(
        (node) => node.getBoundingClientRect().top - containerRect.top,
      );

      const epsilon = 4;
      let target: HTMLElement | null = null;
      if (direction === "previous") {
        for (let i = userNodes.length - 1; i >= 0; i--) {
          if ((offsets[i] ?? 0) < -epsilon) {
            target = userNodes[i] ?? null;
            break;
          }
        }
        // If nothing is above, jump to the first user message anyway so
        // the button is always responsive.
        target ??= userNodes[0] ?? null;
      } else {
        for (let i = 0; i < userNodes.length; i++) {
          if ((offsets[i] ?? 0) > epsilon) {
            target = userNodes[i] ?? null;
            break;
          }
        }
        // If nothing is below, jump to the last user message.
        target ??= userNodes[userNodes.length - 1] ?? null;
      }
      if (!target) return;

      const targetTop =
        target.getBoundingClientRect().top - containerRect.top + container.scrollTop;
      // Leave a tiny gap so the message header doesn't get clipped by
      // any sticky chrome at the top of the chat area.
      container.scrollTo({ top: Math.max(0, targetTop - 8), behavior: "smooth" });
      // We're no longer pinned to the bottom; the scroll listener will
      // recompute the jump-to-bottom visibility on its own.
      isStuckToBottomRef.current = false;
    },
    [],
  );

  const draftSaveTimerRef = useRef<number | null>(null);

  // Restore the draft for this session into the textarea on mount and on
  // session change. The textarea is uncontrolled, so we set .value directly.
  useEffect(() => {
    if (!sessionId) return;
    const draft = readDraft(sessionId);
    if (textareaRef.current) {
      textareaRef.current.value = draft;
      setHasContent(draft.length > 0);
    }
  }, [sessionId]);

  // Persist the draft only after the user has stopped typing for 2 seconds,
  // so we don't thrash localStorage on every keystroke. The unmount /
  // session-change effect still flushes whatever the textarea currently
  // holds, so an interrupted typing session loses at most ~2s of typing.
  //
  // Cross-tab safety: a typing-path write only happens when the textarea
  // has at least DRAFT_MIN_BYTES of content. If a user opens a second tab
  // and clears the textarea there, that empty/short value does NOT
  // overwrite the stored draft - the original tab's draft survives.
  // Empty drafts are only written via the acknowledged-submit path
  // (handleSubmit), which calls writeDraft directly with "" to clear.
  const scheduleDraftSave = useCallback(
    (value: string) => {
      if (!sessionId) return;
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
      }
      if (value.length < DRAFT_MIN_BYTES) return;
      draftSaveTimerRef.current = window.setTimeout(() => {
        writeDraft(sessionId, value);
        draftSaveTimerRef.current = null;
      }, 2000);
    },
    [sessionId],
  );

  useEffect(() => {
    return () => {
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      if (sessionId && textareaRef.current) {
        const value = textareaRef.current.value;
        if (value.length >= DRAFT_MIN_BYTES) {
          writeDraft(sessionId, value);
        }
      }
    };
  }, [sessionId]);

  const handleRevertRequest = useCallback(
    (message: MessageWithParts, text: string) => {
      const isUser = message.info.role === "user";
      // If clicking the same message that's already targeted, treat it as a
      // toggle-off so the user can dismiss a staged revert without
      // submitting.
      if (revertTarget?.messageId === message.info.id) {
        setRevertTarget(null);
        return;
      }
      setRevertTarget({
        mode: isUser ? "user" : "assistant",
        messageId: message.info.id,
      });
      // For a user-message revert, copy its text into the composer so the
      // user can edit and resubmit. Assistant-message reverts leave the
      // composer untouched - the user types fresh.
      if (isUser && textareaRef.current) {
        textareaRef.current.value = text;
        setHasContent(text.length > 0);
      }
    },
    [revertTarget],
  );

  const handleAbort = useCallback(async () => {
    if (!port || !sessionId) return;
    try {
      await fetch(`/api/opencode/${port}/session/${sessionId}/abort`, {
        method: "POST",
      });
    } catch {
      // Best-effort abort.
    }
  }, [port, sessionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || !port) return;
    const rawValue = textareaRef.current?.value ?? "";
    const messageText = rawValue.trim();
    if (!messageText && pendingAttachments.length === 0) return;

    const attachmentsForMessage = pendingAttachments;
    const messageId = `temp-${Date.now()}`;
    setPendingAttachments([]);
    setSendError(null);

    const optimisticMessage: MessageWithParts = {
      info: {
        id: messageId,
        sessionID: sessionId,
        role: "user",
        time: { created: Date.now() },
        agent: "user",
        model: { providerID: "", modelID: "" },
      },
      parts: [
        ...attachmentsForMessage.map((a, i) => ({
          id: `${messageId}-file-${i}`,
          sessionID: sessionId,
          messageID: messageId,
          type: "file" as const,
          mime: a.mime,
          filename: a.filename,
          url: a.url,
        })),
        {
          id: `${messageId}-part`,
          sessionID: sessionId,
          messageID: messageId,
          type: "text",
          text: messageText,
        },
      ],
    };
    addOptimisticMessage(port, sessionId, optimisticMessage);
    isStuckToBottomRef.current = true;
    setShowJumpToBottom(false);
    scrollToBottom();

    setSending(true);
    try {
      // If the user has staged a revert, execute it before the prompt so the
      // backend truncation lands first and the new prompt picks up where the
      // truncated history left off.
      //
      // opencode's `revert` API takes `messageID` = the FIRST message to
      // remove (everything from there to the end of history is reverted).
      //   user-mode:      we delete the target user message itself + below
      //                   so we send `target.messageId` directly.
      //   assistant-mode: we keep the target assistant message and only
      //                   delete what came AFTER it - so we have to pick
      //                   the message immediately following the target.
      //                   If there is none (target was already the last),
      //                   there's nothing to revert; skip the call.
      if (revertTarget) {
        let revertMessageId: string | null = null;
        if (revertTarget.mode === "user") {
          revertMessageId = revertTarget.messageId;
        } else {
          const targetIdx = messages.findIndex(
            (m) => m.info.id === revertTarget.messageId,
          );
          if (targetIdx >= 0 && targetIdx < messages.length - 1) {
            revertMessageId = messages[targetIdx + 1]!.info.id;
          }
        }
        if (revertMessageId) {
          const revertResponse = await fetch(
            `/api/opencode/${port}/session/${sessionId}/revert`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messageID: revertMessageId }),
            },
          );
          if (!revertResponse.ok) {
            throw new Error(
              `Revert failed: ${await readErrorMessage(revertResponse)}`,
            );
          }
        }
        setRevertTarget(null);
      }
      const response = await fetch(
        `/api/opencode/${port}/session/${sessionId}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: messageText,
            attachments: attachmentsForMessage.length
              ? attachmentsForMessage
              : undefined,
            model: isOverridingDefault() ? selectedModel : undefined,
            agent: selectedAgent,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      // Acknowledged. Now it's safe to clear the textarea and the persisted
      // draft. If the network or backend had failed before this point, the
      // user's text would still be both in the textarea and in localStorage.
      if (textareaRef.current) {
        textareaRef.current.value = "";
      }
      setHasContent(false);
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      writeDraft(sessionId, "");
      mutateSessionMessages(port, sessionId);
      mutateSessions();
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Failed to send message",
      );
      // Restore attachments so the user can retry; the textarea retained
      // the message text since we never cleared it.
      setPendingAttachments(attachmentsForMessage);
    } finally {
      setSending(false);
    }
  };

  const messageNodes = useMemo(() => {
    // Two layers of "reverted":
    //
    //   1. PERSISTED revert (`session.revert.messageID` returned by opencode)
    //      means the user has already submitted a revert+prompt: those messages
    //      must be HIDDEN entirely. opencode keeps them in the DB so a future
    //      `unrevert` could restore them, but the visible thread should match
    //      what the TUI shows.
    //
    //   2. STAGED revert (`revertTarget` client state) means the user has
    //      clicked the revert icon but not submitted yet: those messages stay
    //      visible but get the gray+strike preview so the user sees what's
    //      about to be removed.
    const persistedRevertId = currentSession?.revert?.messageID;
    const visible = messages
      .filter((message) => hasVisibleContent(message))
      .filter((message) => {
        if (!persistedRevertId) return true;
        // Hide the reverted message and everything chronologically after it.
        // We can't rely on array order alone because optimistic local inserts
        // may temporarily appear after the persisted revert pointer; fall
        // back to the absolute time if both messages have it.
        const revertedTime = messages.find(
          (m) => m.info.id === persistedRevertId,
        )?.info.time.created;
        if (revertedTime == null) return true;
        return message.info.time.created < revertedTime;
      });
    // Compute pending-delete flags based on the staged revertTarget.
    //   user-mode: target message and everything below it are pending delete.
    //   assistant-mode: only messages strictly below the target.
    const targetIndex = revertTarget
      ? visible.findIndex((m) => m.info.id === revertTarget.messageId)
      : -1;
    return visible.map((message, idx) => {
      let pendingDelete = false;
      if (revertTarget && targetIndex >= 0) {
        if (revertTarget.mode === "user") {
          pendingDelete = idx >= targetIndex;
        } else {
          pendingDelete = idx > targetIndex;
        }
      }
      // CodeNomad-style queue badge: a user message is "queued" if there is
      // no assistant reply between it and the next user message (or end of
      // history). If the assistant turn is busy, the LAST user message is
      // "in progress" rather than "queued" - so we skip the badge for it.
      let isQueued = false;
      if (message.info.role === "user") {
        let answered = false;
        for (let j = idx + 1; j < visible.length; j++) {
          const next = visible[j];
          if (!next) break;
          if (next.info.role === "user") break;
          if (next.info.role === "assistant") {
            answered = true;
            break;
          }
        }
        const isLastVisible = idx === visible.length - 1;
        isQueued = !answered && !(isLastVisible && isAssistantBusy);
      }
      // Stamp the flag onto the message reference so the existing
      // <MessageItem> Badge render picks it up without a new prop.
      const messageWithQueueFlag = isQueued
        ? { ...message, isQueued: true }
        : message;
      return (
        <MessageItem
          key={message.info.id}
          message={messageWithQueueFlag}
          port={port}
          sessionId={sessionId}
          pendingPermissions={pendingPermissions}
          onPermissionResolved={handlePermissionResolved}
          isAssistantBusy={isAssistantBusy}
          onAbort={handleAbort}
          pendingDelete={pendingDelete}
          onRevertRequest={handleRevertRequest}
        />
      );
    });
  }, [
    messages,
    port,
    sessionId,
    pendingPermissions,
    handlePermissionResolved,
    isAssistantBusy,
    handleAbort,
    revertTarget,
    handleRevertRequest,
    currentSession?.revert?.messageID,
  ]);

  const handleAttachFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const reads = await Promise.all(
      list.map(
        (file) =>
          new Promise<PromptAttachment | null>((resolve) => {
            if (!file.type.startsWith("image/")) {
              resolve(null);
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result;
              if (typeof result !== "string") {
                resolve(null);
                return;
              }
              resolve({
                mime: file.type,
                filename: file.name,
                url: result,
              });
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }),
      ),
    );

    const valid = reads.filter(
      (a): a is PromptAttachment => a !== null,
    );
    if (valid.length === 0) return;
    setPendingAttachments((prev) => [...prev, ...valid]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <div className="flex h-full flex-col -m-4">
      <div className="relative flex-1 min-h-0">
      <div
        className="absolute inset-0 overflow-auto overflow-x-hidden"
        ref={chatContainerRef}
      >
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader className="size-6" />
          </div>
        )}

        {error && (
          <div className="rounded-md bg-danger-subtle p-4 m-4 text-danger-subtle-fg">
            Error: {error}
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-muted-fg">No messages yet</div>
          </div>
        )}

        <div
          ref={messagesListRef}
          className="divide-y divide-dashed divide-border overflow-x-hidden"
        >
          {!loading &&
            !loadAllMessages &&
            messages.length >= INITIAL_MESSAGE_LIMIT && (
              <div className="px-6 py-3 text-center">
                <button
                  type="button"
                  onClick={() => setLoadAllMessages(true)}
                  className="rounded-md border border-border bg-bg px-3 py-1 text-xs text-muted-fg hover:border-fg/30 hover:text-fg transition-colors"
                >
                  Load earlier messages
                </button>
              </div>
            )}
          {messageNodes}
          {unlinkedPermissions.length > 0 && (
            <div className="px-6 py-4 space-y-2 border-t border-dashed border-border">
              {unlinkedPermissions.map((permission) => (
                <PermissionRequestForm
                  key={permission.id}
                  permission={permission}
                  port={port}
                  onResolved={handlePermissionResolved}
                />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {isAssistantBusy && (
          <div className="py-3 px-6">
            <div className="flex items-center gap-2">
              <Ripples size="30" speed="2" color="var(--color-primary)" />
              <span className="text-sm text-muted-fg">Thinking...</span>
              <ThinkingStaleness messages={messages} />
            </div>
          </div>
        )}
      </div>
        {/* Vertical stack of nav buttons in the bottom-right of the chat
            scroll area:
              - prev user prompt
              - next user prompt
              - jump to very bottom (only when not already pinned)
            The first two are always visible whenever the session has any
            user messages; the third hides itself once you're at the bottom
            (the user wanted >> to disappear when redundant). */}
        {messages.some((m) => m.info.role === "user") && (
          <div className="absolute bottom-3 right-3 z-30 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => handleJumpUserPrompt("previous")}
              className="flex size-10 items-center justify-center rounded-full border border-border bg-bg/95 text-fg shadow-lg hover:bg-muted transition-colors"
              aria-label="Previous user message"
              title="Previous user message"
            >
              <ChevronUpIcon className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => handleJumpUserPrompt("next")}
              className="flex size-10 items-center justify-center rounded-full border border-border bg-bg/95 text-fg shadow-lg hover:bg-muted transition-colors"
              aria-label="Next user message"
              title="Next user message"
            >
              <ChevronDownIcon className="size-5" />
            </button>
            {showJumpToBottom && (
              <button
                type="button"
                onClick={handleJumpToBottom}
                className="flex size-10 items-center justify-center rounded-full border border-border bg-bg/95 text-fg shadow-lg hover:bg-muted transition-colors"
                aria-label="Jump to bottom"
                title="Jump to bottom"
              >
                <ChevronDoubleDownIcon className="size-5" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border shrink-0 relative max-h-[50dvh] overflow-hidden flex flex-col">
        {composerCollapsed && (
          <button
            type="button"
            onClick={() => setComposerCollapsed(false)}
            className="absolute right-1 -top-9 z-20 flex size-8 items-center justify-center rounded-full border border-border bg-bg/90 text-muted-fg shadow hover:bg-muted hover:text-fg transition-colors"
            aria-label="Show composer"
            title="Show composer"
          >
            <ChevronUpIcon className="size-4" />
          </button>
        )}
        {!composerCollapsed && (
          <>
            <div className="flex items-center gap-1 px-2 py-1 border-b border-border/60 bg-muted/30 text-xs sm:text-sm [&_button[data-slot=control]]:py-1 [&_button[data-slot=control]]:text-xs sm:[&_button[data-slot=control]]:text-sm">
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <div className="min-w-0 flex-1 max-w-40">
                  <AgentSelect sessionId={sessionId} />
                </div>
                <div className="min-w-0 flex-[1.2] max-w-48">
                  <ModelOverrideControl
                    isOverriding={isOverridingDefault()}
                    sessionId={sessionId}
                    instanceId={instanceId}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => fileAttachInputRef.current?.click()}
                className="shrink-0 rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg transition-colors"
                title="Attach image"
                aria-label="Attach image"
              >
                <PaperClipIcon className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setComposerCollapsed(true)}
                className="shrink-0 rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg transition-colors"
                aria-label="Hide composer"
                title="Hide composer"
              >
                <ChevronDownIcon className="size-4" />
              </button>
            </div>
            <div className="px-2 pt-1.5 pb-1 relative flex-1 min-h-0 flex flex-col">
            <FileMentionPopover
              isOpen={fileMention.isOpen}
              searchQuery={fileMention.searchQuery}
              textareaRef={textareaRef}
              mentionStart={fileMention.mentionStart}
              selectedIndex={fileMention.selectedIndex}
              onSelectedIndexChange={fileMention.setSelectedIndex}
              onFilesChange={setFileResults}
              onClose={fileMention.close}
              onSelect={(filePath) => {
                const current = textareaRef.current?.value ?? "";
                const newValue = fileMention.handleSelect(filePath, current);
                if (textareaRef.current) {
                  textareaRef.current.value = newValue;
                  setHasContent(newValue.length > 0);
                }
              }}
            />
            <form onSubmit={handleSubmit} className="w-full flex-1 min-h-0 flex flex-col">
              <input
                ref={fileAttachInputRef}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files) {
                    handleAttachFiles(e.target.files);
                  }
                  e.target.value = "";
                }}
              />
              {pendingAttachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pendingAttachments.map((a, i) => (
                    <div
                      key={`${a.filename ?? "image"}-${i}`}
                      className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted"
                    >
                      <img
                        src={a.url}
                        alt={a.filename ?? `Attachment ${i + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeAttachment(i)}
                        className="absolute right-0.5 top-0.5 rounded-full bg-bg/80 px-1 text-[10px] leading-tight text-fg shadow hover:bg-bg"
                        aria-label={`Remove ${a.filename ?? "attachment"}`}
                        title="Remove"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-stretch gap-2 flex-1 min-h-0">
                <div className="min-w-0 flex-1 flex flex-col">
                  <Textarea
                    ref={textareaRef}
                    inputMode="text"
                    autoCapitalize="sentences"
                    autoCorrect="on"
                    onChange={(e) => {
                      const value = e.target.value;
                      const ne = value.length > 0;
                      if (ne !== hasContent) setHasContent(ne);
                      scheduleDraftSave(value);
                      if (fileMention.isOpen || value.includes("@")) {
                        const cursorPos =
                          e.target.selectionStart ?? value.length;
                        fileMention.handleInputChange(value, cursorPos);
                      }
                    }}
                    onSelect={(e) => {
                      if (!fileMention.isOpen) return;
                      const target = e.target as HTMLTextAreaElement;
                      const value = target.value;
                      const cursorPos = target.selectionStart ?? value.length;
                      fileMention.handleInputChange(value, cursorPos);
                    }}
                    onKeyDown={(e) => {
                      const handled = fileMention.handleKeyDown(
                        e,
                        fileResults.length,
                      );
                      if (handled) {
                        if (
                          (e.key === "Enter" || e.key === "Tab") &&
                          fileResults.length > 0
                        ) {
                          const selectedFile =
                            fileResults[fileMention.selectedIndex];
                          if (selectedFile) {
                            const current =
                              textareaRef.current?.value ?? "";
                            const newValue = fileMention.handleSelect(
                              selectedFile,
                              current,
                            );
                            if (textareaRef.current) {
                              textareaRef.current.value = newValue;
                              setHasContent(newValue.length > 0);
                            }
                          }
                        }
                        return;
                      }
                      if (e.key === "Enter") {
                        // Submit policy:
                        //   Shift+Enter ALWAYS inserts a newline (browser
                        //     default), regardless of platform / setting.
                        //   On mobile, never submit via Enter - the soft
                        //     keyboard's Enter is for newlines only; users
                        //     submit by tapping the Send button.
                        //   On desktop, Ctrl/Cmd+Enter always submits.
                        //   On desktop, bare Enter submits ONLY in
                        //     enterKeyAction='submit' mode.
                        if (e.shiftKey || isMobile) return;
                        const wantsSubmit =
                          e.metaKey ||
                          e.ctrlKey ||
                          enterKeyAction === "submit";
                        if (wantsSubmit) {
                          e.preventDefault();
                          const current = textareaRef.current?.value ?? "";
                          if (
                            current.trim() ||
                            pendingAttachments.length > 0
                          ) {
                            handleSubmit(e as unknown as React.FormEvent);
                          }
                        }
                      }
                    }}
                    placeholder="Type your message..."
                    className="resize-none overflow-y-auto text-sm sm:text-base"
                    rows={5}
                  />
                </div>
                <div className="flex flex-col justify-end gap-1.5 shrink-0">
                  {isAssistantBusy && (
                    <Button
                      type="button"
                      onPress={handleAbort}
                      intent="danger"
                      className="size-9 !p-0"
                      aria-label="Stop the current run"
                    >
                      <StopIcon className="size-4" />
                    </Button>
                  )}
                  <Button
                    type="submit"
                    isDisabled={
                      !hasContent && pendingAttachments.length === 0
                    }
                    className="size-12 !p-0"
                    aria-label={
                      isAssistantBusy ? "Queue message" : "Send"
                    }
                  >
                    <PlayIcon className="size-6" />
                  </Button>
                </div>
              </div>
            </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
