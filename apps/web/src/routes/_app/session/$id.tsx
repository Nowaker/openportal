import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod/v4";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  memo,
} from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { remarkFileLinks } from "@/lib/remark-file-links";
import { remarkIdLinks } from "@/lib/remark-id-links";
import useSWR from "swr";
import { Ripples } from "ldrs/react";
import "ldrs/react/Ripples.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader } from "@/components/ui/loader";
import { AgentSelect } from "@/components/agent-select";
import { ModelSelect } from "@/components/model-select";
import { OmoBlockView } from "@/components/omo-block-view";
import { ThinkingSelect } from "@/components/thinking-select";
import { MessageInfoModal } from "@/components/message-info-modal";
import { parseOmoBlocks } from "@/lib/omo-injection";
import {
  FileMentionPopover,
  useFileMention,
} from "@/components/file-mention-popover";
import {
  SlashCommandPopover,
  useSlashCommand,
  useCommands,
} from "@/components/slash-command-popover";
import { TodoStrip, TodoFloat } from "@/components/todo-strip";

import {
  formatMessageTime,
  formatAbsoluteAndRelative,
} from "@/lib/format-time";
import { MODAL_OVERLAY_CLASSES } from "@/lib/ui-classes";
import IconBadgeSparkle from "@/components/icons/badge-sparkle-icon";
import IconUser from "@/components/icons/user-icon";
import IconMagnifier from "@/components/icons/magnifier-icon";
import IconEye from "@/components/icons/eye-icon";
import IconPen from "@/components/icons/pen-icon";
import IconSquareFeather from "@/components/icons/feather-icon";
import SendIcon from "@/components/icons/send-icon";
import {
  DocumentIcon,
  InformationCircleIcon,
  PaperClipIcon,
  PhotoIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  ChatBubbleLeftRightIcon,
  MicrophoneIcon,
  ShieldCheckIcon,
  UserIcon,
  XMarkIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
} from "@heroicons/react/24/outline";
import { ShieldCheckIcon as ShieldCheckIconSolid } from "@heroicons/react/24/solid";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
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
import { StarMessageButton } from "@/components/star-message-button";
import { TextSelectionMenu } from "@/components/text-selection-menu";
import { speakText, useTtsStore } from "@/stores/tts-store";
import { useChatDisplayStore } from "@/stores/chat-display-store";
import {
  useAutoApproveConfig,
  isEffectivelyEnabled,
  toggleAutoApprove,
} from "@/stores/auto-approve-store";
import { useModelStore } from "@/stores/model-store";
import { useThinkingStore } from "@/stores/thinking-store";
import { useSessionErrorStore } from "@/stores/session-error-store";
import { useDateFormatStore } from "@/stores/date-format-store";
import { useSttModeStore } from "@/stores/stt-mode-store";
import { useSttEngine } from "@/hooks/use-stt-engine";
import { toast } from "@/components/ui/toast";
import { useMarkViewed } from "@/hooks/use-last-viewed";
import { usePullState } from "@/hooks/use-pull-to-refresh";
import { useBreadcrumb } from "@/contexts/breadcrumb-context";
import {
  useSessionMessages,
  useSessionMessagesAround,
  addOptimisticMessage,
  mutateSessionMessages,
  updateOptimisticMessage,
  type MessageWithParts,
  type Part,
  type ToolPart,
  type FilePart,
  type PermissionRequest,
  type QuestionAnswer,
  type QuestionInfo,
  type QuestionRequest,
} from "@/hooks/use-session-messages";
import {
  useSessions,
  useSessionStatus,
  useTodos,
  useAgents,
  useProviders,
} from "@/hooks/use-opencode";
import { useIndicator } from "@/hooks/use-indicators";
import { useConnectionMonitor } from "@/hooks/use-connection-monitor";
import useMediaQuery from "@/hooks/use-media-query";
import { useFileBrowserPanelStore } from "@/stores/file-browser-panel-store";
import type { Session } from "@opencode-ai/sdk";

const sessionSearchSchema = z.object({
  focus: z.literal("composer").optional(),
  prompts: z.union([z.literal("1"), z.literal(1), z.literal(true)]).optional(),
});

export const Route = createFileRoute("/_app/session/$id")({
  component: SessionRouteWrapper,
  validateSearch: sessionSearchSchema,
});

function SessionRouteWrapper() {
  const { id } = Route.useParams();
  return <SessionPage key={id} />;
}

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

// Smart post-submit clear. The user can already be typing the next prompt
// in the same textarea by the time the network round-trip finishes;
// wiping the textarea unconditionally trashes those in-flight keystrokes.
//
//   submitted="blah" + textarea="blah bleh"        -> " bleh"  (prefix strip)
//   submitted="blah" + textarea="bleh blah bleh"   -> no change
//          (short content matching as a substring is too risky)
//   submitted="<long block>" + textarea contains it -> strip the first
//          occurrence (long enough that an accidental substring match is
//          astronomically unlikely)
//   submitted="blah" + textarea="bleh"             -> no change (diverged)
//
// Cursor/selection is preserved across the splice.
const SMART_CLEAR_SUBSTRING_MIN = 40;

function smartPostSubmitClear(
  textarea: HTMLTextAreaElement,
  submitted: string,
): { newValue: string; cleared: boolean } {
  const current = textarea.value;
  if (!submitted) return { newValue: current, cleared: false };
  if (current === submitted) {
    textarea.value = "";
    textarea.setSelectionRange(0, 0);
    return { newValue: "", cleared: true };
  }
  if (current.startsWith(submitted)) {
    const remainder = current.slice(submitted.length);
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;
    textarea.value = remainder;
    textarea.setSelectionRange(
      Math.max(0, selStart - submitted.length),
      Math.max(0, selEnd - submitted.length),
    );
    return { newValue: remainder, cleared: true };
  }
  if (submitted.length >= SMART_CLEAR_SUBSTRING_MIN) {
    const idx = current.indexOf(submitted);
    if (idx >= 0) {
      const merged = current.slice(0, idx) + current.slice(idx + submitted.length);
      const selStart = textarea.selectionStart;
      const selEnd = textarea.selectionEnd;
      textarea.value = merged;
      const adjust = (pos: number) => {
        if (pos <= idx) return pos;
        if (pos >= idx + submitted.length) return pos - submitted.length;
        return idx;
      };
      textarea.setSelectionRange(adjust(selStart), adjust(selEnd));
      return { newValue: merged, cleared: true };
    }
  }
  return { newValue: current, cleared: false };
}

function readPermalinkFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash;
  if (!raw || !raw.startsWith("#msg-")) return null;
  const id = raw.slice(5);
  if (!id) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

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

// Fallback when opencode's runtime question registry has dropped the
// pending question (most often because the opencode process restarted
// while a question was awaiting reply - the message-state in SQLite
// preserves the question but the in-memory QuestionRequest is gone).
// We submit the answers as a normal prompt so the conversation can
// continue. The dangling tool part stays in 'running' state in the
// log, but the session moves forward.
// Fallback when opencode's runtime question registry has dropped the
// pending question (most often because the opencode process restarted
// while a question was awaiting reply - the message-state in SQLite
// preserves the question but the in-memory QuestionRequest is gone).
// We submit the answers as a normal prompt so the conversation can
// continue. The dangling tool part stays in 'running' state in the
// log, but the session moves forward.
function formatAnswersAsPrompt(
  questions: QuestionInfo[],
  answers: QuestionAnswer[],
): string {
  const parts: string[] = [];
  questions.forEach((q, i) => {
    const header = q.header ? `[${q.header}] ` : "";
    const a = answers[i] ?? [];
    parts.push(
      `${header}${q.question}\n  → ${a.length > 0 ? a.join(" + ") : "(no answer)"}`,
    );
  });
  return parts.join("\n\n");
}

const QUESTION_DRAFT_KEY_PREFIX = "opencode-question-draft:";

interface QuestionDraft {
  selections: Record<number, string[]>;
  freeform: Record<number, string>;
  submittedAt?: number;
}

function questionDraftKey(sessionId: string, callID: string): string {
  return `${QUESTION_DRAFT_KEY_PREFIX}${sessionId}:${callID}`;
}

function readQuestionDraft(
  sessionId: string,
  callID: string,
): QuestionDraft | null {
  if (typeof window === "undefined") return null;
  if (!sessionId || !callID) return null;
  try {
    const raw = window.localStorage.getItem(
      questionDraftKey(sessionId, callID),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuestionDraft>;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.selections === "object" &&
      typeof parsed.freeform === "object"
    ) {
      return {
        selections: parsed.selections as Record<string, string[]>,
        freeform: parsed.freeform as Record<string, string>,
        submittedAt:
          typeof parsed.submittedAt === "number" ? parsed.submittedAt : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeQuestionDraft(
  sessionId: string,
  callID: string,
  draft: QuestionDraft,
): void {
  if (typeof window === "undefined") return;
  if (!sessionId || !callID) return;
  const isEmpty =
    Object.keys(draft.selections).length === 0 &&
    Object.values(draft.freeform).every((v) => !v) &&
    !draft.submittedAt;
  try {
    if (isEmpty) {
      window.localStorage.removeItem(questionDraftKey(sessionId, callID));
    } else {
      window.localStorage.setItem(
        questionDraftKey(sessionId, callID),
        JSON.stringify(draft),
      );
    }
  } catch {
  }
}

function parseToolQuestions(part: ToolPart): QuestionInfo[] {
  const input = (part.state?.input || {}) as Record<string, unknown>;
  const rawQuestions = input.questions;

  if (!Array.isArray(rawQuestions)) {
    return [];
  }

  return rawQuestions
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
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
    }))
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
      const additions =
        typeof input._newLines === "number"
          ? input._newLines
          : String(input.newString || "").split("\n").length;
      const deletions =
        typeof input._oldLines === "number"
          ? input._oldLines
          : String(input.oldString || "").split("\n").length;
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
      const lines =
        typeof input._contentLines === "number"
          ? input._contentLines
          : String(input.content || "").split("\n").length;
      return {
        icon: <IconSquareFeather size="12px" />,
        label: `write ${filePath}`,
        details: `(${lines} lines)`,
      };
    }
    case "bash": {
      const command = String(input.command || input.cmd || "");
      const shortCmd = command.split("\n")[0]?.slice(0, 200) || "";
      return {
        icon: "$",
        label: `bash ${shortCmd}${command.length > 200 ? "..." : ""}`,
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
    case "task": {
      const subagentType = String(input.subagent_type || input.subagentType || "agent");
      const description = String(input.description || "");
      const cropped =
        description.length > 80 ? description.slice(0, 80) + "..." : description;
      return {
        icon: "◼︎",
        label: `task ${subagentType}`,
        details: cropped ? `- ${cropped}` : undefined,
      };
    }
    case "todowrite": {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      const total = todos.length;
      const completed = todos.filter(
        (t: unknown) =>
          typeof t === "object" &&
          t !== null &&
          (t as { status?: unknown }).status === "completed",
      ).length;
      return {
        icon: "◼︎",
        label: "todowrite",
        details: total > 0 ? `(${completed}/${total} done)` : undefined,
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
      let details: string | undefined;
      if (firstArg) {
        const raw = String(firstArg[1]);
        const truncated = raw.length > 120 ? raw.slice(0, 120) + "..." : raw;
        details = `${firstArg[0]}: ${truncated}`;
      }
      return {
        icon: "◼︎",
        label: toolName || "unknown",
        details,
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
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <span>
              Q{idx + 1}.{q.header ? ` ${q.header}` : ""}
            </span>
            {q.multiple && (
              <span className="rounded border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                Multi-select
              </span>
            )}
          </div>
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
  const initialDraft = useMemo(
    () => readQuestionDraft(sessionId, callID),
    [sessionId, callID],
  );
  const [selections, setSelections] = useState<Record<number, string[]>>(
    () => {
      if (!initialDraft) return {};
      const out: Record<number, string[]> = {};
      for (const [k, v] of Object.entries(initialDraft.selections)) {
        const idx = Number(k);
        if (Number.isInteger(idx)) out[idx] = Array.isArray(v) ? v : [];
      }
      return out;
    },
  );
  const [freeformInputs, setFreeformInputs] = useState<Record<number, string>>(
    () => {
      if (!initialDraft) return {};
      const out: Record<number, string> = {};
      for (const [k, v] of Object.entries(initialDraft.freeform)) {
        const idx = Number(k);
        if (Number.isInteger(idx) && typeof v === "string") out[idx] = v;
      }
      return out;
    },
  );
  const [isPosting, setIsPosting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<number | null>(
    initialDraft?.submittedAt ?? null,
  );

  useEffect(() => {
    writeQuestionDraft(sessionId, callID, {
      selections,
      freeform: freeformInputs,
      submittedAt: submittedAt ?? undefined,
    });
  }, [selections, freeformInputs, submittedAt, sessionId, callID]);

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

    const answers: QuestionAnswer[] = questions.map((q, i) => {
      const selected = selections[i] || [];
      const freeform = freeformInputs[i]?.trim() || "";
      const isMulti = !!q.multiple;
      if (selected.length > 0 && freeform) {
        if (!isMulti) {
          return [`${selected[0]}\n\n${freeform}`];
        }
        return [...selected, freeform];
      }
      if (selected.length > 0) return selected;
      if (freeform) return [freeform];
      return [];
    });

    try {
      // Bypass the stale-filter when resolving the reply target: opencode
      // keeps the question request live even when chat moved past it, but
      // the sidebar filter would hide it from this lookup and force the
      // text-prompt fallback, leaving the question pending forever (the
      // root cause of the user-reported stuck-session bug).
      const listRes = await fetch(
        `/api/opencode/${port}/questions?includeStale=1`,
      );
      if (!listRes.ok) throw new Error("Failed to fetch pending questions");
      const pendingQuestions = (await listRes.json()) as QuestionRequest[];

      const match =
        pendingQuestions.find((q) => q.tool?.callID === callID) ??
        pendingQuestions.find((q) => q.sessionID === sessionId);

      if (match) {
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
        setSubmittedAt(Date.now());
        mutateSessionMessages(port, sessionId);
        return;
      }

      const fallbackText = formatAnswersAsPrompt(questions, answers);
      const promptRes = await fetch(
        `/api/opencode/${port}/session/${sessionId}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: fallbackText }),
        },
      );
      if (!promptRes.ok) {
        throw new Error(await readErrorMessage(promptRes));
      }
      setSubmittedAt(Date.now());
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

  const isSubmitted = submittedAt !== null;

  return (
    <div className="mt-2 space-y-4 text-fg/90">
      {questions.map((q, idx) => {
        const selected = selections[idx] || [];
        const inputName = `${partKey}-q${idx}`;

        return (
          <div
            key={`${partKey}-q-${idx}`}
            className={`space-y-2 ${idx > 0 ? "pt-4 border-t border-dashed border-border" : ""}`}
          >
            <div className="text-sm font-semibold text-fg">
              Q{idx + 1}.{q.header ? ` ${q.header}` : ""}
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_p]:my-1">
              <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                {q.question}
              </Markdown>
            </div>

            {q.options.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {q.options.map((opt, optIdx) => {
                  const isSelected = selected.includes(opt.label);
                  const inputId = `${partKey}-q${idx}-opt${optIdx}`;
                  return (
                    <label
                      key={`opt-${idx}-${optIdx}`}
                      htmlFor={inputId}
                      className={`flex items-center gap-2 ${isPosting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <input
                        id={inputId}
                        name={inputName}
                        type={q.multiple ? "checkbox" : "radio"}
                        checked={isSelected}
                        disabled={isPosting}
                        onChange={() => toggleOption(idx, opt.label, !!q.multiple)}
                        className="accent-primary"
                      />
                      <span className="text-sm">
                        <span>{opt.label}</span>
                        {opt.description && (
                          <span className="opacity-60"> - {opt.description}</span>
                        )}
                      </span>
                    </label>
                  );
                })}
                {!q.multiple && (
                  <label
                    htmlFor={`${partKey}-q${idx}-none`}
                    className={`flex items-center gap-2 text-muted-fg ${isPosting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <input
                      id={`${partKey}-q${idx}-none`}
                      name={inputName}
                      type="radio"
                      checked={selected.length === 0}
                      disabled={isPosting}
                      onChange={() =>
                        setSelections((prev) => ({ ...prev, [idx]: [] }))
                      }
                      className="accent-primary"
                    />
                    <span className="text-sm italic">None of the above</span>
                  </label>
                )}
              </div>
            )}

            {(q.options.length === 0 || q.custom) && (
              <div className="space-y-1">
                {q.options.length > 0 && q.custom && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-fg">
                    <span aria-hidden className="text-fg/40">+</span>
                    <span>
                      {q.multiple
                        ? "and/or your own note (submits together)"
                        : "and/or your own note (combined with the selected option)"}
                    </span>
                  </div>
                )}
                <textarea
                  rows={1}
                  disabled={isPosting}
                  placeholder={
                    q.options.length > 0 && q.custom
                      ? q.multiple
                        ? "Add a custom note (combines with selections above)..."
                        : "Add a custom note (combined with the selected option)..."
                      : "Type your answer..."
                  }
                  value={freeformInputs[idx] || ""}
                  ref={(el) => {
                    if (el) {
                      el.style.height = "auto";
                      el.style.height = `${el.scrollHeight}px`;
                    }
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      (e.metaKey || e.ctrlKey) &&
                      !isPosting
                    ) {
                      e.preventDefault();
                      void handleSubmit();
                    }
                  }}
                  onChange={(e) =>
                    setFreeformInputs((prev) => ({
                      ...prev,
                      [idx]: e.target.value,
                    }))
                  }
                  className={`w-full resize-none overflow-x-hidden whitespace-pre-wrap break-words rounded-md border bg-bg px-3 py-2 text-base text-fg placeholder:text-muted-fg focus:outline-none focus:border-primary ${
                    freeformInputs[idx] && freeformInputs[idx].length > 0
                      ? "border-primary"
                      : q.options.length > 0 && q.custom
                        ? "border-dashed border-fg/20"
                        : "border-border"
                  }`}
                />
              </div>
            )}

            {q.multiple && (
              <div className="text-[11px] text-muted-fg">
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
          isDisabled={isSubmitted || !hasAnswersForAllQuestions || isPosting}
          onPress={handleSubmit}
          className="text-xs"
        >
          <SendIcon size="12px" />
          {isPosting && !isSubmitted
            ? "Sending..."
            : isSubmitted
              ? "Answers submitted"
              : "Submit Answers"}
        </Button>
        {isSubmitted && (
          <Button
            type="button"
            size="sm"
            intent="outline"
            isDisabled={!hasAnswersForAllQuestions || isPosting}
            onPress={handleSubmit}
            className="text-xs"
          >
            <SendIcon size="12px" />
            {isPosting ? "Resending..." : "Resubmit answers"}
          </Button>
        )}
      </div>
    </div>
  );
}

interface PastPermissionDecision {
  requestId: string;
  sessionId: string;
  messageId?: string;
  callId?: string;
  decision: "once" | "always" | "reject";
  decidedAt: number;
  patterns: string[];
  permissionType: string;
  toolName?: string;
  auto?: boolean;
}

function PastPermissionDecisionPill({
  decision,
}: {
  decision: PastPermissionDecision;
}) {
  const isReject = decision.decision === "reject";
  const label =
    decision.decision === "always"
      ? "Allowed always"
      : decision.decision === "once"
        ? "Allowed once"
        : "Rejected";
  const palette = isReject
    ? "border-danger/40 bg-danger/10 text-danger"
    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600";
  const firstPattern = decision.patterns[0];
  return (
    <div
      className={`rounded-md border ${palette} px-3 py-2 text-xs space-y-1`}
    >
      <div className="flex items-center gap-1.5 font-medium">
        <CheckIcon className="size-3.5 shrink-0" />
        <span>{label}</span>
        {decision.auto && (
          <span className="rounded bg-violet-500/15 px-1 py-0 text-[9px] font-semibold uppercase tracking-wide text-violet-500">
            auto
          </span>
        )}
        <span className="text-muted-fg/70 font-normal">
          ({decision.permissionType || "permission"})
        </span>
        <span className="ml-auto text-[10px] text-muted-fg/70 font-normal tabular-nums">
          {new Date(decision.decidedAt).toLocaleTimeString()}
        </span>
      </div>
      {firstPattern && (
        <div className="text-muted-fg break-all">
          Path: <span className="font-mono">{firstPattern}</span>
        </div>
      )}
    </div>
  );
}

function AutoApproveToggle({ sessionId }: { sessionId: string | null }) {
  const { config } = useAutoApproveConfig();
  const enabled = isEffectivelyEnabled(config, sessionId);
  if (!sessionId) return null;
  const Icon = enabled ? ShieldCheckIconSolid : ShieldCheckIcon;
  return (
    <button
      type="button"
      onClick={() => {
        void toggleAutoApprove(sessionId, config);
      }}
      title={
        enabled
          ? "Auto-approve ON: server fires reply 'once' on every permission ask"
          : "Auto-approve OFF: permissions require manual reply"
      }
      aria-label={
        enabled ? "Disable auto-approve permissions" : "Enable auto-approve permissions"
      }
      aria-pressed={enabled}
      data-test="portal-composer-autoapprove"
      className={`shrink-0 rounded-md p-1 sm:p-1.5 transition-colors ${
        enabled
          ? "text-accent hover:bg-muted"
          : "text-muted-fg hover:bg-muted hover:text-fg"
      }`}
    >
      <Icon className="size-5" />
    </button>
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

// Renders any JSON-shape value as readable plain text: arrays as a
// bullet list, objects as key: value pairs, primitives as themselves.
// No JSON.stringify escaping, no curly braces, no quotation marks.
// Strings render verbatim with their actual line breaks preserved so
// multi-line tool inputs (bash commands, edit diffs) read as the
// user-typed source rather than as one-line JSON with \n sequences.
function FormattedValue({ value }: { value: unknown }): React.ReactElement {
  if (value === null || value === undefined) {
    return <span className="text-muted-fg/60 italic">(none)</span>;
  }
  if (typeof value === "string") {
    return (
      <span className="whitespace-pre-wrap break-words">{value}</span>
    );
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return <span className="font-mono">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-fg/60 italic">(empty list)</span>;
    }
    return (
      <ul className="ml-3 mt-1 space-y-1 list-disc">
        {value.map((item, i) => (
          <li key={i} className="break-words">
            <FormattedValue value={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-muted-fg/60 italic">(empty)</span>;
    }
    return (
      <dl className="mt-1 space-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[auto_1fr] gap-x-2 items-start">
            <dt className="font-mono text-muted-fg text-xs pt-0.5">{k}:</dt>
            <dd className="break-words text-fg">
              <FormattedValue value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{String(value)}</span>;
}

function ToolInputModal({
  toolName,
  port,
  sessionId,
  partId,
  onClose,
}: {
  toolName: string;
  port: number;
  sessionId: string;
  partId: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<"formatted" | "json">("formatted");
  const [section, setSection] = useState<"input" | "output">("input");
  const { data, error, isLoading } = useSWR<{
    id: string | null;
    callId: string | null;
    input: unknown;
    output: unknown;
  }>(
    `/api/opencode/${port}/session/${sessionId}/part-input?partId=${encodeURIComponent(partId)}`,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const input = (data?.input ?? null) as unknown;
  const output = (data?.output ?? null) as unknown;
  const currentValue = section === "input" ? input : output;
  const jsonText = useMemo(() => {
    try {
      return JSON.stringify(currentValue, null, 2);
    } catch {
      return String(currentValue);
    }
  }, [currentValue]);
  const hasOutput =
    output !== null && output !== undefined && output !== "";
  return (
    <ModalOverlay
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={MODAL_OVERLAY_CLASSES}
    >
      <Modal className="w-full max-w-xl sm:w-[50vw] sm:min-w-[36rem] sm:max-w-[80rem] max-h-[85dvh] flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col flex-1 min-h-0 outline-none">
          {({ close }) => (
            <>
              <header className="shrink-0 flex items-center gap-2 border-b border-border px-4 py-3">
                <h2 className="flex-1 min-w-0 truncate text-sm font-semibold font-mono">
                  {toolName}
                </h2>
                <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setSection("input")}
                    className={`rounded px-2 py-0.5 ${
                      section === "input"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-fg hover:text-fg"
                    }`}
                    data-test="portal-tool-modal-input"
                  >
                    Input
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection("output")}
                    disabled={!hasOutput}
                    className={`rounded px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                      section === "output"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-fg hover:text-fg"
                    }`}
                    data-test="portal-tool-modal-output"
                    title={
                      hasOutput
                        ? "Show tool output"
                        : "No output yet (tool still running or empty result)"
                    }
                  >
                    Output
                  </button>
                </div>
                <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setView("formatted")}
                    className={`rounded px-2 py-0.5 ${
                      view === "formatted"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-fg hover:text-fg"
                    }`}
                  >
                    Formatted
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("json")}
                    className={`rounded px-2 py-0.5 font-mono ${
                      view === "json"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-fg hover:text-fg"
                    }`}
                  >
                    JSON
                  </button>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
                >
                  <XMarkIcon className="size-4" />
                </button>
              </header>
              <div className="flex-1 min-h-0 overflow-y-auto p-4 text-sm">
                {isLoading ? (
                  <div className="flex h-32 items-center justify-center text-muted-fg">
                    <Loader className="size-4" />
                  </div>
                ) : error ? (
                  <div className="text-danger-subtle-fg text-xs">
                    Failed to load tool {section}.
                  </div>
                ) : view === "formatted" ? (
                  <FormattedValue value={currentValue} />
                ) : (
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/30 rounded p-3">
                    {jsonText}
                  </pre>
                )}
              </div>
            </>
          )}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

const ToolCallItem = memo(function ToolCallItem({
  part,
  port,
  sessionId,
  isAssistantBusy,
  onAbort,
  messageTime,
  messageId,
}: {
  part: ToolPart;
  port: number;
  sessionId: string;
  isAssistantBusy: boolean;
  onAbort: () => void;
  messageTime?: number;
  messageId: string;
}) {
  const { icon, label, details } = formatToolCall(part);
  const isQuestionTool = (part.tool || "").toLowerCase() === "question";
  const questions = isQuestionTool ? parseToolQuestions(part) : [];
  const hasQuestions = questions.length > 0;
  const isCompleted = part.state.status === "completed";
  const isError = part.state.status === "error";
  const isPending =
    part.state.status === "pending" || part.state.status === "running";
  const isEditTool = (part.tool || "").toLowerCase() === "edit";
  const dateFormat = useDateFormatStore((s) => s.format);
  const iconVisibility = useChatDisplayStore((s) => s.iconVisibility);
  const { isMobile: toolIsMobile } = useMediaQuery();
  const toolPlatform = toolIsMobile ? "mobile" : "desktop";
  const showCopyIcon = iconVisibility[toolPlatform].copy;
  const showExpandIcon = iconVisibility[toolPlatform].expand;
  const showTimestampIcon = iconVisibility[toolPlatform].timestamp;
  // Timestamp resilience: opencode sometimes puts time on `part.time`,
  // sometimes leaves it undefined for tool parts (the wrapping message
  // owns the canonical timestamp anyway). Walk the candidate paths and
  // fall back to the parent message's created time so EVERY row shows a
  // timestamp - matches the user's spec ("desktop - all messages,
  // including tool calls etc").
  const toolStart =
    (part as { time?: { start?: number; end?: number } }).time?.start ??
    (part as { time?: { start?: number; end?: number } }).time?.end ??
    messageTime;
  const toolTimestamp = toolStart ? formatMessageTime(toolStart, dateFormat) : "";
  const toolTitleAt = formatAbsoluteAndRelative(toolStart);
  const [showInputModal, setShowInputModal] = useState(false);
  const [inlineExpanded, setInlineExpanded] = useState(false);
  const toolInput = (part.state?.input ?? null) as Record<string, unknown> | null;
  const isBashTool = (part.tool || "").toLowerCase() === "bash";
  const bashCommand = isBashTool
    ? String(toolInput?.command ?? toolInput?.cmd ?? "")
    : "";
  const bashDescription = isBashTool
    ? String(toolInput?.description ?? "")
    : "";
  const canInlineExpand = isBashTool && bashCommand.length > 0;
  const canExpand =
    !isEditTool &&
    !hasQuestions &&
    !canInlineExpand &&
    toolInput !== null &&
    Object.keys(toolInput).length > 0;

  if (hasQuestions) {
    return (
      <div
        data-test={`portal-toolcall-${part.tool ?? "unknown"}`}
        className={`rounded-md border px-3 py-2 text-xs ${
          isError
            ? "border-danger/40 bg-danger-subtle/30"
            : isCompleted
              ? "border-border bg-muted/25"
              : "border-warning/40 bg-warning/10"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 text-sm font-medium text-fg">
          <span className="opacity-60 shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
          {details && <span className="opacity-60 shrink-0">{details}</span>}
          {isPending && <span className="animate-pulse shrink-0">...</span>}
          {showTimestampIcon && toolTimestamp && (
            <MessagePermalinkTimestamp
              messageId={messageId}
              display={toolTimestamp}
              titleAt={toolTitleAt}
              className="hidden sm:inline ml-auto pl-2 shrink-0 text-[10px] text-muted-fg/70 tabular-nums"
            />
          )}
        </div>

        {port ? (
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

  const toneClass = isError
    ? "text-danger"
    : isCompleted
      ? "text-muted-fg"
      : isPending
        ? "text-warning"
        : "text-fg";

  if (canInlineExpand && inlineExpanded) {
    return (
      <div data-test={`portal-toolcall-${part.tool ?? "unknown"}`} className={`font-mono text-xs flex items-start gap-1.5 py-0.5 min-w-0 ${toneClass}`}>
        <span className="opacity-60 shrink-0">$</span>
        <div className="flex-1 min-w-0">
          <pre className="m-0 whitespace-pre-wrap break-all">{bashCommand}</pre>
          {bashDescription && (
            <div className="mt-0.5 opacity-60"># {bashDescription}</div>
          )}
        </div>
        {isPending && <span className="animate-pulse shrink-0">...</span>}
        {showCopyIcon && (
          <span className="shrink-0 text-muted-fg/60 hover:text-fg">
            <CopyMarkdownButton text={bashCommand} />
          </span>
        )}
        {showExpandIcon && (
          <button
            type="button"
            onClick={() => setInlineExpanded(false)}
            aria-label="Collapse"
            title="Collapse"
            className="shrink-0 rounded p-0.5 text-muted-fg/60 hover:text-fg hover:bg-muted/40"
          >
            <ArrowsPointingInIcon className="size-3" />
          </button>
        )}
        {showTimestampIcon && toolTimestamp && (
          <MessagePermalinkTimestamp
            messageId={messageId}
            display={toolTimestamp}
            titleAt={toolTitleAt}
            className="hidden sm:inline shrink-0 text-[10px] text-muted-fg/70 font-sans tabular-nums pl-1.5"
          />
        )}
      </div>
    );
  }

  return (
    <div data-test={`portal-toolcall-${part.tool ?? "unknown"}`} className={`font-mono text-xs flex items-center gap-1.5 py-0.5 min-w-0 ${toneClass}`}>
      <span className="opacity-60 shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {details && <span className="opacity-60 shrink-0">{details}</span>}
      {isPending && <span className="animate-pulse shrink-0">...</span>}
      {showCopyIcon && canInlineExpand && (
        <span className="ml-auto shrink-0 text-muted-fg/60 hover:text-fg">
          <CopyMarkdownButton text={bashCommand} />
        </span>
      )}
      {showExpandIcon && canInlineExpand && (
        <button
          type="button"
          onClick={() => setInlineExpanded(true)}
          aria-label="Expand full command"
          title="Expand full command"
          className="shrink-0 rounded p-0.5 text-muted-fg/60 hover:text-fg hover:bg-muted/40"
        >
          <ArrowsPointingOutIcon className="size-3" />
        </button>
      )}
      {showExpandIcon && canExpand && (
        <button
          type="button"
          onClick={() => setShowInputModal(true)}
          aria-label="Show full tool input / output"
          title="Show full tool input / output"
          className="ml-auto shrink-0 rounded p-0.5 text-muted-fg/60 hover:text-fg hover:bg-muted/40"
        >
          <InformationCircleIcon className="size-3.5" />
        </button>
      )}
      {showTimestampIcon && toolTimestamp && (
        <MessagePermalinkTimestamp
          messageId={messageId}
          display={toolTimestamp}
          titleAt={toolTitleAt}
          className={`hidden sm:inline shrink-0 text-[10px] text-muted-fg/70 font-sans tabular-nums ${
            canExpand || canInlineExpand ? "pl-1.5" : "ml-auto pl-2"
          }`}
        />
      )}
      {canExpand && showInputModal && (
        <ToolInputModal
          toolName={part.tool || "tool"}
          port={port}
          sessionId={sessionId}
          partId={part.id}
          onClose={() => setShowInputModal(false)}
        />
      )}
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

function ForkIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      strokeLinecap="square"
      className={className}
    >
      <circle cx="3.5" cy="3.5" r="2" stroke="currentColor" />
      <circle cx="16.5" cy="3.5" r="2" stroke="currentColor" />
      <circle cx="10" cy="16.5" r="2" stroke="currentColor" />
      <path
        d="M3.5 5.5V8C3.5 11 5.5 13 8 13H12C14.5 13 16.5 11 16.5 8V5.5"
        stroke="currentColor"
      />
      <path d="M10 13V14.5" stroke="currentColor" />
    </svg>
  );
}

// Chrome blocks top-level navigation to data: URLs as a phishing mitigation,
// so a plain <a href="data:..." target="_blank"> opens a blank tab. We convert
// the data URL to a Blob + object URL on click and open THAT - object URLs
// are not blocked. The conversion runs synchronously from the click handler
// so window.open() retains the user-gesture and isn't popup-blocked. (An
// async fetch() + then() chain would lose the gesture and pop the blocker.)
// Right-click "Open in new tab" continues to work natively because the <a>
// still has the original href as a fallback.
function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx < 0) throw new Error("Malformed data URL");
  const header = dataUrl.slice(5, commaIdx);
  const payload = dataUrl.slice(commaIdx + 1);
  const isBase64 = header.endsWith(";base64");
  const mime =
    (isBase64 ? header.slice(0, -7) : header).split(";")[0] ||
    "application/octet-stream";
  if (isBase64) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

function ImagePreviewModal({
  isOpen,
  onOpenChange,
  url,
  alt,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  alt: string;
}) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/70"
    >
      <Modal className="outline-none">
        <PrimitiveDialog className="relative outline-none">
          {({ close }) => (
            <>
              <button
                type="button"
                onClick={close}
                aria-label="Close preview"
                className="absolute right-2 top-2 z-10 rounded-full border border-border bg-bg/95 p-1.5 text-fg shadow-lg hover:bg-muted"
              >
                <XMarkIcon className="size-5" />
              </button>
              <img
                src={url}
                alt={alt}
                className="block max-w-[90vw] max-h-[90dvh] rounded shadow-2xl object-contain"
              />
            </>
          )}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

function AttachmentChip({ part }: { part: FilePart }) {
  const isImage = part.mime?.startsWith("image/");
  const Icon = isImage ? PhotoIcon : PaperClipIcon;
  const label = part.filename || (isImage ? "image" : part.mime || "attachment");
  const url = part.url ?? "";
  const thumb = (part as FilePart & { thumb?: string }).thumb;
  const isDataUrl = url.startsWith("data:");
  const [previewOpen, setPreviewOpen] = useState(false);

  const chipBody = (
    <>
      {isImage && thumb ? (
        <img
          src={thumb}
          alt={label}
          loading="lazy"
          className="size-8 shrink-0 rounded object-cover bg-muted"
        />
      ) : (
        <Icon className="size-3 shrink-0 text-muted-fg" />
      )}
      <span className="truncate">{label}</span>
    </>
  );
  const chipClass =
    "inline-flex items-center gap-2 max-w-full rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-fg/90 hover:border-fg/30 hover:bg-muted transition-colors";

  if (isImage) {
    return (
      <>
        <button
          type="button"
          className={chipClass}
          title={label}
          onClick={() => setPreviewOpen(true)}
        >
          {chipBody}
        </button>
        <ImagePreviewModal
          isOpen={previewOpen}
          onOpenChange={setPreviewOpen}
          url={url}
          alt={label}
        />
      </>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={chipClass}
      title={label}
      onClick={
        isDataUrl
          ? (e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
              e.preventDefault();
              try {
                const blob = dataUrlToBlob(url);
                const objUrl = URL.createObjectURL(blob);
                window.open(objUrl, "_blank", "noopener,noreferrer");
                window.setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
              } catch {
                /* fall back to native <a href=data:...> nav */
              }
            }
          : undefined
      }
    >
      {chipBody}
    </a>
  );
}

// Marks the last <p> element in the rendered tree (depth-first, regardless
// of nesting under blockquote/list/etc.) by adding a data-last-p attribute.
// react-markdown forwards rehype hast-tree mutations to the React render,
// so the corresponding <p> renderer can detect this flag via props.node and
// append the inline timestamp only on the genuinely-last paragraph.
//
// Counting source-level paragraphs is unreliable: blockquotes wrap their
// inner text in <p>, so a quote-then-reply message produced two <p>s but
// the source-paragraph parser excluded the blockquote, mis-injecting the
// timestamp into the first <p>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rehypeMarkLastParagraph = () => (tree: any) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastP: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any) => {
    if (!node) return;
    if (node.type === "element" && node.tagName === "p") {
      lastP = node;
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c);
    }
  };
  walk(tree);
  if (lastP) {
    lastP.properties = lastP.properties || {};
    lastP.properties.dataLastP = "true";
  }
};

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

function CopyMarkdownButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    if (await copyTextToClipboard(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button
      type="button"
      onClick={handle}
      data-test="portal-msg-copy"
      title={copied ? "Copied!" : "Copy message markdown"}
      aria-label="Copy message markdown"
      className="inline-flex items-center hover:text-fg transition-colors"
    >
      {copied ? (
        <CheckIcon className="size-3 text-emerald-500" />
      ) : (
        <ClipboardDocumentIcon className="size-3" />
      )}
    </button>
  );
}

// Per-message timestamp rendered as a permalink anchor. Click does two
// things in one gesture (mirroring the user's spec: "copy + open in new
// tab"):
//   1. writeText() the absolute URL to the clipboard.
//   2. window.open() the same URL in a new tab.
// Both run from the same synchronous click handler so the popup blocker
// still trusts the gesture. preventDefault() stops the default <a>
// navigation in the current tab (which would scroll the current view
// elsewhere and lose state). Right-click "Open in new tab" still works
// natively because the href is a real URL.
//
// The href shape is always <current-pathname>#msg-<messageId>. The
// route reads the hash in SessionPage and switches into permalink mode
// (see useSessionMessagesAround in use-session-messages.ts).
// Highlight a message in the current document by flashing a CSS class
// on its container for a brief window. Works for both in-page jumps
// (click on a permalink whose target is already in the rendered chat)
// and fresh permalink-landing (the route entered with #msg-<id>).
function flashMessageHighlight(messageId: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(`msg-${messageId}`);
  if (!el) return;
  el.classList.add("permalink-highlight");
  window.setTimeout(() => {
    el.classList.remove("permalink-highlight");
  }, 2400);
}

function MessagePermalinkTimestamp({
  messageId,
  display,
  titleAt,
  className,
}: {
  messageId: string;
  display: string;
  titleAt: string;
  className: string;
}) {
  const [copied, setCopied] = useState(false);
  const buildAbsoluteUrl = (): string => {
    const hash = `#msg-${encodeURIComponent(messageId)}`;
    if (typeof window === "undefined") return hash;
    const url = new URL(window.location.href);
    url.hash = hash;
    return url.toString();
  };
  // Left click: open + scroll to the target in the same tab. If the
  // target is already in the rendered chat (same session, message in
  // current window), just highlight + scroll without navigation. The
  // user wanted clicking on a permalink in chat to NOT navigate away -
  // they already see the message, the click is just an emphasis gesture.
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const inPage =
      typeof document !== "undefined" &&
      document.getElementById(`msg-${messageId}`) !== null;
    if (inPage) {
      e.preventDefault();
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        if (typeof window !== "undefined") {
          const hash = `#msg-${encodeURIComponent(messageId)}`;
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}${hash}`,
          );
        }
        flashMessageHighlight(messageId);
      }
    }
    // not in page: let the browser navigate to the href (same tab,
    // the route detects the #msg-<id> hash and switches into
    // permalink-window mode).
  };
  // Right-click / long-press: copy the absolute URL. Native browser
  // copy-link-address still works too, but this gives a friendlier
  // path with toast confirmation.
  const handleContextMenu = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    void copyTextToClipboard(buildAbsoluteUrl()).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  const longPressTimerRef = useRef<number | null>(null);
  const handleTouchStart = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      void copyTextToClipboard(buildAbsoluteUrl()).then((ok) => {
        if (!ok) return;
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      });
    }, 600);
  };
  const handleTouchEnd = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };
  const titleSuffix = copied
    ? " - link copied!"
    : " - click to jump, right-click / long-press to copy permalink";
  return (
    <a
      href={`#msg-${encodeURIComponent(messageId)}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      title={`${titleAt}${titleSuffix}`}
      aria-label="Jump to message (right-click / long-press copies permalink)"
      className={`${className} cursor-pointer hover:text-fg hover:underline decoration-dotted underline-offset-2 transition-colors`}
    >
      {copied ? "copied!" : display}
    </a>
  );
}

interface HastNode {
  type?: string;
  value?: string;
  children?: HastNode[];
}

function extractTextFromHast(node: HastNode | undefined | null): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  if (Array.isArray(node.children)) {
    return node.children.map(extractTextFromHast).join("");
  }
  return "";
}

function CodeBlockCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    if (await copyTextToClipboard(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button
      type="button"
      onClick={handle}
      title={copied ? "Copied!" : "Copy code"}
      aria-label="Copy code"
      className="absolute top-1.5 right-1.5 inline-flex items-center justify-center rounded p-1 bg-bg/70 text-muted-fg hover:bg-bg hover:text-fg transition-colors"
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-emerald-500" />
      ) : (
        <ClipboardDocumentIcon className="size-3.5" />
      )}
    </button>
  );
}

function looksLikeRelativeFilePath(href: string): boolean {
  if (!href) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  if (href.startsWith("/")) return false;
  if (href.startsWith("~")) return false;
  if (href.startsWith("#")) return false;
  if (href.startsWith("?")) return false;
  if (href.startsWith("//")) return false;
  return true;
}

function joinPosix(base: string, rel: string): string {
  const baseClean = base.replace(/\/+$/, "");
  const relClean = rel.replace(/^\.\/+/, "");
  return `${baseClean}/${relClean}`;
}

function resolvePath(
  rawPath: string,
  sessionDirectory: string | null,
): string | null {
  if (!rawPath) return null;
  if (rawPath.startsWith("/")) return rawPath;
  if (rawPath.startsWith("~")) return rawPath;
  if (!sessionDirectory) return null;
  return joinPosix(sessionDirectory, rawPath);
}

function FileExistenceLink({
  rawPath,
  sessionDirectory,
  hash,
  children,
  rest,
}: {
  rawPath: string;
  sessionDirectory: string | null;
  hash: string;
  children: React.ReactNode;
  rest: Record<string, unknown>;
}) {
  const { isMobile } = useMediaQuery();
  const lookupPath = resolvePath(rawPath, sessionDirectory);
  const { data } = useSWR<{ exists: boolean; path?: string }>(
    lookupPath ? `/api/fs/exists?path=${encodeURIComponent(lookupPath)}` : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { exists: false };
      return (await r.json()) as { exists: boolean; path?: string };
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  if (!lookupPath || (data && !data.exists)) {
    return <span {...rest}>{children}</span>;
  }
  const resolvedAbs = data?.path ?? lookupPath;
  return (
    <a
      {...rest}
      href={`file:///?path=${encodeURIComponent(resolvedAbs)}${hash}`}
      onClick={(e) => {
        e.preventDefault();
        if (isMobile) {
          window.open(
            `/files?path=${encodeURIComponent(resolvedAbs)}${hash}`,
            "_blank",
            "noopener,noreferrer",
          );
        } else {
          useFileBrowserPanelStore.getState().open(resolvedAbs);
        }
      }}
    >
      {children}
    </a>
  );
}

function MessageMarkdown({
  text,
  remarkPlugins,
  sessionDirectory,
}: {
  text: string;
  remarkPlugins: NonNullable<React.ComponentProps<typeof Markdown>["remarkPlugins"]>;
  sessionDirectory?: string;
}) {
  const { isMobile } = useMediaQuery();
  const components = useMemo(
    () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pre: ({ node, children, ...props }: any) => {
        const codeText = extractTextFromHast(node as HastNode);
        return (
          <div className="relative group">
            <pre {...props}>{children}</pre>
            <CodeBlockCopyButton text={codeText} />
          </div>
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      a: ({ href, children, ...rest }: any) => {
        if (typeof href === "string" && href.startsWith("file://")) {
          let path: string | null = null;
          let hash = "";
          try {
            const u = new URL(href);
            const qp = u.searchParams.get("path");
            if (qp !== null) {
              path = qp;
            } else {
              path = decodeURIComponent(u.pathname);
            }
            hash = u.hash;
          } catch {
            path = null;
          }
          if (path) {
            return (
              <FileExistenceLink
                rawPath={path}
                sessionDirectory={sessionDirectory ?? null}
                hash={hash}
                rest={rest}
              >
                {children}
              </FileExistenceLink>
            );
          }
        }
        if (
          typeof href === "string" &&
          looksLikeRelativeFilePath(href)
        ) {
          const [pathPart, hashPart = ""] = href.split(/(?=#)/, 2);
          return (
            <FileExistenceLink
              rawPath={pathPart}
              sessionDirectory={sessionDirectory ?? null}
              hash={hashPart}
              rest={rest}
            >
              {children}
            </FileExistenceLink>
          );
        }
        const isAnchor = typeof href === "string" && href.startsWith("#");
        const isMailto = typeof href === "string" && href.startsWith("mailto:");
        const openInNewTab = !!href && !isAnchor && !isMailto;
        return (
          <a
            {...rest}
            href={href}
            target={openInNewTab ? "_blank" : undefined}
            rel={openInNewTab ? "noreferrer noopener" : undefined}
          >
            {children}
          </a>
        );
      },
    }),
    [isMobile, sessionDirectory],
  );

  return (
    <Markdown remarkPlugins={[...remarkPlugins, remarkFileLinks, remarkIdLinks]} components={components}>
      {text}
    </Markdown>
  );
}

// Gap banner rendered between the around-target window and the latest
// window in permalink mode. Surfaces (a) how many messages are between
// the two windows, (b) a spinner while a fillGap fetch is in flight,
// and (c) two load-more buttons: "Load 50 more" (next chunk of the
// gap) and "Load all" (entire session - slow on big histories).
function PermalinkGapBanner({
  gapCount,
  loading,
  onLoadNext,
  onLoadAll,
}: {
  gapCount: number;
  loading: boolean;
  onLoadNext: () => void;
  onLoadAll: () => void;
}) {
  return (
    <div className="my-3 mx-3 rounded-md border border-dashed border-border bg-muted/20 px-3 py-3 flex flex-col gap-2 items-center text-center">
      <div className="text-xs text-muted-fg">
        Gap of {gapCount.toLocaleString()} message
        {gapCount === 1 ? "" : "s"} between target window and latest
        messages.
      </div>
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader className="size-4" />
            <span className="text-xs text-muted-fg">Loading...</span>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onLoadNext}
              disabled={loading}
              className="rounded-md border border-border bg-bg px-3 py-1 text-xs text-muted-fg hover:border-fg/30 hover:text-fg transition-colors disabled:opacity-50"
            >
              Load 50 more
            </button>
            <button
              type="button"
              onClick={onLoadAll}
              disabled={loading}
              title="Loading the entire history can take long on big sessions"
              className="rounded-md border border-dashed border-border bg-bg px-3 py-1 text-xs text-muted-fg hover:border-fg/30 hover:text-fg transition-colors disabled:opacity-50"
            >
              Load all (slow)
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Top-of-list status bar shown in permalink mode. Surfaces the journey:
// which buckets are still loading (target / before / after / latest),
// whether the target was found, the target's position in the full
// session, and an explicit exit affordance so the user can switch back
// to the normal "load last 50 + live polling" view.
function PermalinkLoaderBar({
  target,
  loading,
  targetFound,
  totalCount,
  targetIndex,
  error,
  onExit,
  onLoadAll,
}: {
  target: string | null;
  loading: {
    target: boolean;
    before: boolean;
    after: boolean;
    latest: boolean;
    fillGap: boolean;
  };
  targetFound: boolean | null;
  totalCount: number | null;
  targetIndex: number | null;
  error: string | null;
  onExit: () => void;
  onLoadAll: () => void;
}) {
  const anyLoading =
    loading.target || loading.before || loading.after || loading.latest;
  const targetShort = target ? target.slice(0, 16) + (target.length > 16 ? "..." : "") : "";

  return (
    <div className="border-b border-border bg-muted/20 px-3 py-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-muted-fg">
          {anyLoading && <Loader className="size-4" />}
          <span>
            Permalink view{" "}
            <span className="font-mono">{targetShort}</span>
            {targetFound === true && targetIndex !== null && totalCount !== null
              ? ` (message ${targetIndex + 1} of ${totalCount})`
              : ""}
            {targetFound === false ? " - not found in session history" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {targetFound === false && (
            <button
              type="button"
              onClick={onLoadAll}
              className="rounded-md border border-border bg-bg px-2 py-0.5 text-[11px] text-muted-fg hover:border-fg/30 hover:text-fg transition-colors"
            >
              Load all
            </button>
          )}
          <button
            type="button"
            onClick={onExit}
            title="Clear the permalink and resume live polling"
            className="rounded-md border border-border bg-bg px-2 py-0.5 text-[11px] text-muted-fg hover:border-fg/30 hover:text-fg transition-colors"
          >
            Resume live view
          </button>
        </div>
      </div>
      {anyLoading && (
        <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-fg/80">
          <PermalinkPhasePill label="target" active={loading.target} />
          <PermalinkPhasePill label="before" active={loading.before} />
          <PermalinkPhasePill label="after" active={loading.after} />
          <PermalinkPhasePill label="latest" active={loading.latest} />
        </div>
      )}
      {error && (
        <div className="text-[11px] text-danger">Error: {error}</div>
      )}
    </div>
  );
}

function PermalinkPhasePill({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
        active
          ? "bg-warning/20 text-warning-fg"
          : "bg-muted/40 text-muted-fg/60"
      }`}
    >
      {active ? "..." : ""}
      {label}
    </span>
  );
}

function ErrorAcknowledgeControl({
  sessionId,
  messageId,
}: {
  sessionId: string;
  messageId: string;
}) {
  const acknowledgedId = useSessionErrorStore(
    (s) => s.acknowledged[sessionId],
  );
  if (acknowledgedId === messageId) {
    return (
      <span className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-bg/40 px-2 py-0.5 text-[11px] font-medium text-muted-fg">
        <CheckIcon className="size-3" />
        Acknowledged
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() =>
        useSessionErrorStore.getState().acknowledge(sessionId, messageId)
      }
      className="shrink-0 rounded-md border border-border bg-bg/40 px-2 py-0.5 text-[11px] font-medium text-fg hover:bg-bg/80"
      title="Mark this error as seen and clear the red indicator"
    >
      Acknowledge
    </button>
  );
}

const MessageItem = memo(function MessageItem({
  message,
  port,
  sessionId,
  sessionDirectory,
  pendingPermissions,
  onPermissionResolved,
  isAssistantBusy,
  isQuestionBlocked,
  onAbort,
  pendingDelete,
  onRevertRequest,
  onForkRequest,
  isLastError,
}: {
  message: MessageWithParts;
  port: number;
  sessionId: string;
  sessionDirectory: string | null;
  pendingPermissions: PermissionRequest[];
  onPermissionResolved: (requestId: string) => void;
  isAssistantBusy: boolean;
  isQuestionBlocked: boolean;
  onAbort: () => void;
  pendingDelete: boolean;
  onRevertRequest: (message: MessageWithParts, text: string) => void;
  onForkRequest: (message: MessageWithParts) => void;
  isLastError: boolean;
}) {
  const textContent = getMessageContent(message.parts);
  const isAssistant = message.info.role === "assistant";
  const pendingMeta = message.info._pending ?? null;
  const isPending = pendingMeta !== null;
  const showInfoIcon = useChatDisplayStore((s) => s.showInfoIcon);
  const iconVisibility = useChatDisplayStore((s) => s.iconVisibility);
  const { isMobile } = useMediaQuery();
  const visibilityKey = isMobile ? "mobile" : "desktop";
  const showFork = iconVisibility[visibilityKey].fork;
  const showRevert = iconVisibility[visibilityKey].revert;
  const showCopy = iconVisibility[visibilityKey].copy;
  const showInfoIconRow =
    showInfoIcon && iconVisibility[visibilityKey].info;
  const showTimestamp = iconVisibility[visibilityKey].timestamp;
  const showStar = iconVisibility[visibilityKey].star;
  const [showInfoModal, setShowInfoModal] = useState(false);
  const toolCalls = message.parts.filter(isToolPart);
  const fileParts = message.parts.filter(isFilePart);
  const omoBlocks = useMemo(
    () => (isAssistant ? [] : parseOmoBlocks(textContent)),
    [isAssistant, textContent],
  );
  const messagePermissions = pendingPermissions.filter(
    (perm) => perm.tool?.messageID === message.info.id,
  );
  const messageError =
    message.info.role === "assistant" ? message.info.error : null;
  let errorDescription = messageError
    ? describeMessageError(messageError)
    : null;

  // Finish-based failures (content-filter, length cutoff, error, other,
  // anything other than the success-shaped "stop"/"tool-calls") are treated
  // exactly like model errors: red banner, Acknowledge control, and the
  // session-level red attention indicator triggered upstream via
  // `lastErrorMessageId` / `setSessionError`. Yellow was the wrong call -
  // content-filter is a hard halt that loses real work, not a soft warning.
  if (!errorDescription && message.info.role === "assistant" && message.info.time?.completed) {
    const finish = message.info.finish;
    if (finish && finish !== "stop" && finish !== "tool-calls") {
      errorDescription = describeFinishReason(finish);
    }
  }

  const dateFormat = useDateFormatStore((s) => s.format);
  const messageTimestamp = message.info.time?.created
    ? formatMessageTime(message.info.time.created, dateFormat)
    : "";
  const messageTitleAt = formatAbsoluteAndRelative(message.info.time?.created);

  const hasHeaderRow = textContent || fileParts.length > 0;
  // Visual decoration when a revert is staged: gray tone + strike-through.
  // Nothing is destroyed in the backend yet - the actual truncate happens
  // only when the user submits a new message.
  const decoration = pendingDelete
    ? "opacity-50 line-through"
    : "";
  return (
    <div
      className={`${decoration} relative px-3 py-3 ${
        !isAssistant && hasHeaderRow
          ? "bg-accent/25 dark:bg-accent/20 border-t border-b border-accent/60 [[data-role=user]+&]:border-t-0"
          : ""
      }`}
      data-role={message.info.role}
      data-message-id={message.info.id}
      data-test={`portal-msg-${message.info.id}`}
      id={`msg-${message.info.id}`}
    >
      {hasHeaderRow && (
        <div className="relative">
          {/*
            Two distinct pending states, never both at once on the
            same message:

            - "Waiting for OpenCode": message is a virtual user row
              from openportal's pending-prompt store
              (info._pending !== null). Portal accepted the prompt
              and stored it durably; the worker hasn't yet handed it
              to opencode (typically <1s, but can be longer if
              opencode is unreachable). Shipped via
              `toVirtualUserMessage` in messages.ts.

            - "Queued": message is a REAL user row from opencode's
              own message stream, but the assistant hasn't yet
              produced a response after it. opencode has the prompt;
              it's just queued behind earlier turns or an in-flight
              tool call. Computed in renderMessage's `isQueued`
              flag (see db2ae95 for the answered-detection fix).

            The two flow through different code paths because they
            represent different stages of the dispatch lifecycle.
            Don't unify - the user wants to distinguish "portal
            still has it" from "opencode has it but isn't working
            on it yet".
          */}
          {!isAssistant && isPending && pendingMeta && (
            (() => {
              // Submission state-journey badge. The optimistic row carries
              // a `_pending.phase` that walks through "submitting" -> "opencode-
              // accepted" -> (real message replaces it). Each phase picks a
              // shade in a blue progression - distinct from the warning yellow
              // and danger red dot-indicators the sidebar uses for session
              // status, so the user can tell at a glance the badge is about
              // THIS prompt (not the session as a whole).
              const phase = pendingMeta.phase ?? "submitting";
              const cls =
                phase === "opencode-accepted"
                  ? "mb-1 inline-flex items-center rounded-md border border-blue-500/40 bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300"
                  : "mb-1 inline-flex items-center rounded-md border border-blue-300/40 bg-blue-300/15 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-200";
              const label =
                phase === "opencode-accepted"
                  ? "Sent to OpenCode"
                  : "Submitting";
              return (
                <span className={cls}>
                  <Loader className="size-3 mr-1" />
                  {label}
                  {pendingMeta.attempts > 0
                    ? ` - ${pendingMeta.attempts} attempt${pendingMeta.attempts === 1 ? "" : "s"}`
                    : ""}
                </span>
              );
            })()
          )}
          {!isAssistant && !isPending && message.isQueued && (
            <Badge intent="warning" className="mb-1">
              {isQuestionBlocked
                ? "Queued - blocked on question above"
                : "Queued"}
            </Badge>
          )}
          {textContent && (
            <div className="prose prose-sm dark:prose-invert max-w-none break-words pr-20 [&_pre]:whitespace-pre-wrap [&_pre]:break-all [&_code]:break-words [&_code]:[overflow-wrap:anywhere]">
              {isAssistant ? (
                <MessageMarkdown
                  text={textContent}
                  remarkPlugins={[remarkGfm]}
                  sessionDirectory={sessionDirectory ?? undefined}
                />
              ) : (
                omoBlocks.map((block, i) =>
                  block.kind === "omo" ? (
                    <OmoBlockView
                      key={`omo-${i}`}
                      header={block.header ?? "OMO block"}
                      summary={block.summary}
                      segments={block.segments}
                      text={block.text}
                      lazyFetchUrl={
                        block.ref
                          ? `/api/opencode/${port}/session/${encodeURIComponent(
                              sessionId,
                            )}/message/${encodeURIComponent(
                              message.info.id,
                            )}/omo/${encodeURIComponent(block.ref.blockId)}`
                          : undefined
                      }
                    />
                  ) : block.text.trim() ? (
                    <MessageMarkdown
                      key={`user-${i}`}
                      text={block.text}
                      remarkPlugins={[remarkGfm, remarkBreaks]}
                      sessionDirectory={sessionDirectory ?? undefined}
                    />
                  ) : null,
                )
              )}
            </div>
          )}
          {fileParts.length > 0 && (
            <div
              className={`${textContent ? "mt-2" : ""} flex flex-wrap gap-1.5 pr-20`}
            >
              {fileParts.map((part) => (
                <AttachmentChip key={part.id} part={part} />
              ))}
            </div>
          )}
          <div className="absolute bottom-1 right-2 flex items-center gap-1.5 text-[10px] text-muted-fg/70">
            {!isPending && (
              <>
                {showStar && (
                  <StarMessageButton
                    sessionId={sessionId}
                    messageId={message.info.id}
                    role={isAssistant ? "assistant" : "user"}
                    snippet={textContent}
                  />
                )}
                {showFork && (
                  <button
                    type="button"
                    onClick={() => onForkRequest(message)}
                    data-test="portal-msg-fork"
                    className="rounded p-0.5 text-muted-fg/70 hover:bg-muted/40 hover:text-fg transition-colors"
                    aria-label="Fork to a new session from this message"
                    title="Fork to a new session from this message"
                  >
                    <ForkIcon className="size-3.5" />
                  </button>
                )}
                {showRevert && (
                  <button
                    type="button"
                    onClick={() => onRevertRequest(message, textContent)}
                    data-test="portal-msg-revert"
                    className="rounded p-0.5 text-muted-fg/70 hover:bg-muted/40 hover:text-fg transition-colors"
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
                )}
              </>
            )}
            {showCopy && textContent && <CopyMarkdownButton text={textContent} />}
            {showInfoIconRow && !isPending && (
              <button
                type="button"
                onClick={() => setShowInfoModal(true)}
                data-test="portal-msg-info"
                className="rounded p-0.5 text-muted-fg/70 hover:bg-muted/40 hover:text-fg transition-colors"
                aria-label="Open message metadata modal"
                title={`Open message metadata modal (id, parts, raw payload). Message id: ${message.info.id}`}
              >
                <InformationCircleIcon className="size-3.5" />
              </button>
            )}
            {showTimestamp && messageTimestamp && !isPending && (
              <MessagePermalinkTimestamp
                messageId={message.info.id}
                display={messageTimestamp}
                titleAt={messageTitleAt}
                className="font-mono tabular-nums whitespace-nowrap"
              />
            )}
            {messageTimestamp && isPending && (
              <span
                className="font-mono tabular-nums whitespace-nowrap"
                title={messageTitleAt}
              >
                {messageTimestamp}
              </span>
            )}
          </div>
        </div>
      )}
      {toolCalls.length > 0 && (
        <div className={`${hasHeaderRow ? "mt-2" : ""} space-y-0.5`}>
          {toolCalls.map((part) => (
            <ToolCallItem
              key={part.callID || part.id}
              part={part}
              port={port}
              sessionId={sessionId}
              isAssistantBusy={isAssistantBusy}
              onAbort={onAbort}
              messageTime={message.info.time?.created}
              messageId={message.info.id}
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
      {(() => {
        const decisions =
          ((message.info as { _permissionDecisions?: PastPermissionDecision[] })
            ._permissionDecisions ?? []).filter(
            (d) =>
              !messagePermissions.some((p) => p.id === d.requestId),
          );
        if (decisions.length === 0) return null;
        return (
          <div className={`${textContent ? "mt-2 ml-6" : ""} space-y-1.5`}>
            {decisions.map((d) => (
              <PastPermissionDecisionPill key={d.requestId} decision={d} />
            ))}
          </div>
        );
      })()}
      {errorDescription && (
        <div
          className={`${textContent || toolCalls.length > 0 ? "mt-2 ml-6" : ""} rounded-md border border-danger/40 bg-danger-subtle/30 p-3 text-xs text-danger-subtle-fg`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="font-semibold">{errorDescription.title}</div>
            {isLastError && (
              <ErrorAcknowledgeControl
                sessionId={sessionId}
                messageId={message.info.id}
              />
            )}
          </div>
          {errorDescription.detail && (
            <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
              {errorDescription.detail}
            </div>
          )}
        </div>
      )}
      <MessageInfoModal
        isOpen={showInfoModal}
        onOpenChange={setShowInfoModal}
        messageInfo={message.info}
        messageParts={message.parts}
        messageId={message.info.id}
      />
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
  const isFailed =
    message.info.role === "assistant" && isFailedAssistant(message.info);
  return !!(textContent || hasToolCalls || hasFiles || isFailed);
}

// Single source of truth for "this assistant turn failed and deserves the
// red banner + red attention indicator". Used by MessageItem (banner +
// Acknowledge control), the lastErrorMessageId scan (which message gets
// the live Acknowledge button), and the setSessionError effect (which
// drives the sidebar red dot). All three MUST agree or you get desync
// bugs like a red banner with no red dot.
//
// Caller must already have verified info.role === "assistant"; the cast
// inside is only to read the assistant-shaped fields without re-narrowing
// the union at every call site.
type AssistantInfo = Extract<MessageWithParts["info"], { role: "assistant" }>;
function isFailedAssistant(info: AssistantInfo): boolean {
  if (info.error != null) return true;
  if (info.time?.completed == null) return false;
  const finish = info.finish;
  if (finish == null) return false;
  return finish !== "stop" && finish !== "tool-calls";
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
  sessionId,
  instanceId,
}: {
  isOverriding: boolean;
  sessionId: string;
  instanceId: string | null;
}) {
  return (
    <div className="w-full min-w-0">
      <ModelSelect sessionId={sessionId} instanceId={instanceId} />
    </div>
  );
}

const DRAFT_KEY_PREFIX = "opencode-composer-draft:";
const DRAFT_MIN_BYTES = 10;
// BroadcastChannel name for cross-tab composer sync. When any tab submits
// a draft to opencode, it posts the submitted text on this channel; other
// tabs viewing the same session clear their input ONLY if their staged
// content is a substring of (or equal to) the submitted text. Divergent
// in-flight drafts are preserved.
const COMPOSER_SYNC_CHANNEL = "opencode-composer-sync";

interface ComposerSyncMessage {
  kind: "draft-submitted";
  sessionId: string;
  content: string;
}
// Pending-prompt safety net: when the user submits, we copy the text into
// this key BEFORE clearing the textarea. It stays until either (a) an
// assistant message arrives in response, or (b) the user manually clears
// it. If opencode silently drops the dispatch, the user can still recover
// the exact text they sent. Separate from the typing-time draft so
// freshly-typed content doesn't fight the safety net.
const PENDING_PROMPT_KEY_PREFIX = "opencode-pending-prompt:";

const ATTACHMENTS_KEY_PREFIX = "opencode-composer-attachments:";

function getDraftKey(sessionId: string) {
  return `${DRAFT_KEY_PREFIX}${sessionId}`;
}

function getPendingPromptKey(sessionId: string) {
  return `${PENDING_PROMPT_KEY_PREFIX}${sessionId}`;
}

function getAttachmentsKey(sessionId: string) {
  return `${ATTACHMENTS_KEY_PREFIX}${sessionId}`;
}

function readAttachments(sessionId: string): PromptAttachment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(getAttachmentsKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is PromptAttachment =>
        x &&
        typeof x === "object" &&
        typeof x.mime === "string" &&
        typeof x.url === "string",
    );
  } catch {
    return [];
  }
}

function writeAttachments(
  sessionId: string,
  list: PromptAttachment[],
): void {
  if (typeof window === "undefined") return;
  try {
    if (list.length === 0) {
      window.localStorage.removeItem(getAttachmentsKey(sessionId));
      return;
    }
    window.localStorage.setItem(
      getAttachmentsKey(sessionId),
      JSON.stringify(list),
    );
  } catch {
    return;
  }
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

function readPendingPrompt(sessionId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(getPendingPromptKey(sessionId)) ?? "";
  } catch {
    return "";
  }
}

function writePendingPrompt(sessionId: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(getPendingPromptKey(sessionId), value);
    } else {
      window.localStorage.removeItem(getPendingPromptKey(sessionId));
    }
  } catch {
    // best-effort
  }
}

// Composer max-height in pixels.
//
// dvh is supposed to track the visible viewport across keyboard show/hide,
// but on Android Chrome and iOS Safari it's flaky: the value either lags or
// stays at the full viewport while the soft keyboard is up, leaving the
// composer overlapping the keyboard. visualViewport.height is the
// browser-blessed source of truth for "how much of the page can the user
// actually see right now", so we read that and cap the composer at 60% of
// it. SSR / no-visualViewport fallback stays at 50% of innerHeight, which
// matches the original 50dvh behaviour.
function useComposerMaxHeight(): number {
  const [maxPx, setMaxPx] = useState<number>(() => {
    if (typeof window === "undefined") return 600;
    const vv = window.visualViewport;
    return Math.round((vv?.height ?? window.innerHeight) * 0.6);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    const update = () => {
      const h = vv?.height ?? window.innerHeight;
      setMaxPx(Math.round(h * 0.6));
    };
    update();
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    }
    window.addEventListener("resize", update);
    return () => {
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      }
      window.removeEventListener("resize", update);
    };
  }, []);

  return maxPx;
}

function SessionPage() {
  const { id: sessionId } = Route.useParams();
  const navigate = useNavigate();
  const instance = useInstanceStore((s) => s.instance);
  const port = instance?.port ?? 0;
  const composerMaxHeight = useComposerMaxHeight();

  const [loadAllMessages, setLoadAllMessages] = useState(false);
  const [messageLimit, setMessageLimit] = useState<number>(INITIAL_MESSAGE_LIMIT);
  // Captured BEFORE the "Load N more" click bumps messageLimit. Used by a
  // useLayoutEffect to restore relative scroll position after the new
  // (older) messages prepend at the top - otherwise the user gets jumped
  // back to where their scroll line USED to be relative to the document
  // top, which after a prepend is a very different visible position.
  const loadMoreScrollAnchorRef = useRef<{
    scrollTop: number;
    scrollHeight: number;
  } | null>(null);
  const loadMoreSelectionRef = useRef<Range | null>(null);
  const promptsSearchParam = Route.useSearch({
    select: (s) => s.prompts != null && s.prompts !== false,
  });
  const [onlyUserMessages, setOnlyUserMessages] = useState(promptsSearchParam);
  useEffect(() => {
    setOnlyUserMessages(promptsSearchParam);
  }, [promptsSearchParam]);
  const togglePromptsOnly = useCallback(() => {
    setOnlyUserMessages((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (next) url.searchParams.set("prompts", "1");
        else url.searchParams.delete("prompts");
        window.history.replaceState(null, "", url.toString());
      }
      return next;
    });
  }, []);

  // Permalink mode: when the URL carries `#msg-<id>` on mount (or via
  // back/forward / hashchange), switch from the normal "load last 50,
  // stick to bottom" path into a windowed loader that fetches the
  // target message first plus 10 before / 10 after / 10 latest in
  // parallel. Cleared by clicking "Resume live view" (clears the hash
  // + lets useSessionMessages take over) or by sending a new message.
  const [permalinkTarget, setPermalinkTarget] = useState<string | null>(
    () => readPermalinkFromHash(),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => setPermalinkTarget(readPermalinkFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    setPermalinkTarget(readPermalinkFromHash());
  }, [sessionId]);

  const permalinkMode = permalinkTarget !== null;

  const normal = useSessionMessages(sessionId, {
    loadAll: loadAllMessages,
    limit: messageLimit,
    enabled: !permalinkMode,
    onlyUser: onlyUserMessages,
  });
  const permalinkWindow = useSessionMessagesAround(
    sessionId,
    permalinkTarget,
    { enabled: permalinkMode, onlyUser: onlyUserMessages },
  );

  const messages: MessageWithParts[] = permalinkMode
    ? permalinkWindow.messages
    : normal.messages;

  const lastSpokenAssistantIdRef = useRef<string | null>(null);
  const ttsEnabled = useTtsStore((s) => s.enabled);
  useEffect(() => {
    if (!ttsEnabled) return;
    if (messages.length === 0) return;
    if (lastSpokenAssistantIdRef.current === null) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].info.role === "assistant") {
          lastSpokenAssistantIdRef.current = messages[i].info.id;
          break;
        }
      }
      return;
    }
    let completed: MessageWithParts | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (
        m.info.role === "assistant" &&
        m.info.time?.completed &&
        m.info.id !== lastSpokenAssistantIdRef.current
      ) {
        completed = m;
        break;
      }
    }
    if (!completed) return;
    const text = completed.parts
      .map((p) => (p as { text?: string }).text)
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .join(" ");
    if (text) {
      speakText(text);
      lastSpokenAssistantIdRef.current = completed.info.id;
    }
  }, [messages, ttsEnabled]);
  const loading: boolean = permalinkMode
    ? permalinkWindow.loading.target ||
      permalinkWindow.loading.before ||
      permalinkWindow.loading.after ||
      permalinkWindow.loading.latest
    : normal.isLoading;
  const messagesError = permalinkMode ? permalinkWindow.error : normal.error;

  const exitPermalinkMode = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState(null, "", url.toString());
    setPermalinkTarget(null);
  }, []);

  const { data: todoSnapshot } = useTodos(sessionId);

  const setRefreshHandler = usePullState((s) => s.setRefreshHandler);
  useEffect(() => {
    const canLoadMore = !loadAllMessages && messages.length >= INITIAL_MESSAGE_LIMIT;
    if (canLoadMore) {
      setRefreshHandler(() => {
        setLoadAllMessages(true);
      });
    } else {
      setRefreshHandler(null);
    }
    return () => {
      setRefreshHandler(null);
    };
  }, [loadAllMessages, messages.length, setRefreshHandler]);

  const markViewed = useMarkViewed();
  useEffect(() => {
    if (loading) return;
    if (!sessionId) return;
    void markViewed(sessionId, Date.now());
  }, [sessionId, loading, messages.length, markViewed]);

  // Scroll-anchor restore after a "Load N more" prepends older messages.
  // Without this the scroll position drifts because the document height
  // grew above the user's previous viewport. We capture (scrollTop,
  // scrollHeight) at click time and add the height delta to scrollTop,
  // keeping the EXACT visible content stable. Runs at layout phase so
  // the restore happens before the browser paints the new frame -
  // useEffect would let the user see a flash at the new (wrong)
  // position first.
  useLayoutEffect(() => {
    const anchor = loadMoreScrollAnchorRef.current;
    if (!anchor) return;
    const container = chatContainerRef.current;
    if (!container) return;
    const delta = container.scrollHeight - anchor.scrollHeight;
    if (delta > 0) {
      container.scrollTop = anchor.scrollTop + delta;
      loadMoreScrollAnchorRef.current = null;
      const savedRange = loadMoreSelectionRef.current;
      if (savedRange) {
        try {
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(savedRange);
          }
        } catch {
          /* range nodes detached - original selection gone, ignore */
        }
        loadMoreSelectionRef.current = null;
      }
    }
  }, [messages.length]);

  useEffect(() => {
    if (!sessionId) return;
    try {
      localStorage.setItem("opencode-last-session", sessionId);
    } catch {
      // ignore quota / private-mode errors
    }
  }, [sessionId]);

  const setSessionError = useSessionErrorStore((s) => s.setError);
  useEffect(() => {
    if (loading) return;
    if (!sessionId) return;
    let hasError = false;
    let errorMessageId: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.info.role === "assistant") {
        hasError = isFailedAssistant(m.info);
        if (hasError) errorMessageId = m.info.id;
        break;
      }
    }
    setSessionError(sessionId, hasError, errorMessageId);
  }, [sessionId, loading, messages, setSessionError]);

  // Mirror opencode's per-turn variant back into the local thinking store.
  // opencode copies user.model.variant onto AssistantMessage.variant at
  // turn creation (packages/opencode/src/session/prompt.ts), so when an
  // ultrawork-mode hook elevates the user message's variant to "max" the
  // elevation surfaces here through the assistant echo. Without this sync
  // the ThinkingSelect widget would keep showing the user's last manual
  // pick while opencode is actually thinking at a different level.
  //
  // One sync per assistant message: tracked via a (sessionId, messageId)
  // ref so SWR revalidation re-running the effect with the same array
  // contents doesn't keep overwriting the user's between-turn manual
  // selections.
  const lastVariantSyncRef = useRef<{
    sessionId: string;
    messageId: string;
  } | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!sessionId) return;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.info.role !== "assistant") continue;
      const completed = (m.info as { time?: { completed?: number } }).time
        ?.completed;
      if (!completed) return;
      if (
        lastVariantSyncRef.current?.sessionId === sessionId &&
        lastVariantSyncRef.current?.messageId === m.info.id
      ) {
        return;
      }
      lastVariantSyncRef.current = { sessionId, messageId: m.info.id };
      const variant = (m.info as { variant?: string }).variant;
      if (typeof variant === "string") {
        useThinkingStore.getState().setForSession(sessionId, variant);
      }
      return;
    }
  }, [sessionId, loading, messages]);

  const { data: sessionsData, mutate: mutateSessions } = useSessions();
  const { data: sessionStatusMap } = useSessionStatus();
  const serverThinks = sessionStatusMap?.[sessionId];
  const isServerBusy =
    serverThinks?.type === "busy" || serverThinks?.type === "retry";
  const instanceId = instance?.id ?? null;
  const resolveModel = useModelStore((s) => s.resolveModel);
  const isOverridingDefaultFn = useModelStore((s) => s.isOverridingDefault);
  const selectedModel = resolveModel(sessionId, instanceId);
  const isOverridingDefault = useCallback(
    () => isOverridingDefaultFn(sessionId, instanceId),
    [isOverridingDefaultFn, sessionId, instanceId],
  );
  const selectedAgent = useAgentStore((s) => s.getSelectedAgent(sessionId));
  const resolveThinking = useThinkingStore((s) => s.resolve);
  const thinkingEffort = resolveThinking(sessionId);
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

  // Question-blocked: the latest in-flight assistant message's last part
  // is a question tool with state.status='running' (per opencode's
  // ToolState lifecycle - 'pending' is the transient pre-input state and
  // does NOT carry a question payload yet, so only 'running' is the real
  // blocked-on-user-answer state). When true:
  //   - The "Thinking..." indicator must be suppressed (opencode isn't
  //     thinking, it's waiting on user input)
  //   - A banner above the composer makes the wait explicit
  //   - Follow-up user messages are labeled "Queued - blocked on question
  //     above" so the user understands their typing is being parked
  //     until they answer the question, not silently dropped
  // The blockingQuestionMessageId enables a scroll-to-question anchor in
  // the banner.
  const blockingQuestionMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m) continue;
      if (m.info.role !== "assistant") continue;
      const completed = (m.info as { time?: { completed?: number } }).time
        ?.completed;
      if (completed) return null;
      const parts = m.parts ?? [];
      if (parts.length === 0) return null;
      const last = parts[parts.length - 1];
      if (!last || last.type !== "tool") return null;
      const toolPart = last as ToolPart;
      if ((toolPart.tool || "").toLowerCase() !== "question") return null;
      const status = (toolPart.state as { status?: string })?.status;
      if (status !== "running") return null;
      return m.info.id;
    }
    return null;
  }, [messages]);
  const isQuestionBlocked = blockingQuestionMessageId !== null;

  // Stall verdict matching opencode-stuck-detector's three-state vocabulary.
  // 'silent' (age < 30s): the assistant just received the prompt, give
  // opencode room to dispatch the LLM call (claude-opus-4-7 with
  // thinking=max routinely takes 5-15s of plugin hooks + tool resolution
  // + LLM time-to-first-token before /session/status flips to busy).
  // No banner during this window prevents the "Server is idle" false
  // positive that led to double-submissions on the old 5s threshold.
  // 'no-dispatch' (age >= 30s AND opencode reports idle): the prompt was
  // persisted but generation never dispatched - the same bug the
  // stuck-detector flags. Offer Resubmit + Restore-to-composer.
  // 'stuck-busy' (age >= 5min AND opencode reports busy): opencode says
  // it is generating but nothing has streamed in five minutes. Likely a
  // wedged session on the opencode side. Offer Abort+Retry which calls
  // /session/:id/abort first (free the runner) then re-submits the last
  // user prompt.
  const DISPATCH_GRACE_MS = 30_000;
  const STUCK_BUSY_THRESHOLD_MS = 5 * 60_000;
  const [busyIdleSince, setBusyIdleSince] = useState<number | null>(null);
  useEffect(() => {
    if (!isAssistantBusy) {
      if (busyIdleSince !== null) setBusyIdleSince(null);
      return;
    }
    if (busyIdleSince === null) {
      setBusyIdleSince(Date.now());
    }
  }, [isAssistantBusy, busyIdleSince]);
  const [stallElapsedTick, setStallElapsedTick] = useState(0);
  useEffect(() => {
    if (busyIdleSince === null) return;
    const id = window.setInterval(() => setStallElapsedTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [busyIdleSince]);
  const stallVerdict = useMemo<
    "silent" | "no-dispatch" | "stuck-busy" | null
  >(() => {
    void stallElapsedTick;
    if (!isAssistantBusy) return null;
    if (!busyIdleSince) return null;
    const age = Date.now() - busyIdleSince;
    if (age < DISPATCH_GRACE_MS) return "silent";
    if (!isServerBusy) return "no-dispatch";
    if (age >= STUCK_BUSY_THRESHOLD_MS) return "stuck-busy";
    return null;
  }, [isAssistantBusy, busyIdleSince, isServerBusy, stallElapsedTick]);

  // Pending-prompt safety net: holds the text the user last submitted that
  // hasn't yet received an assistant reply. Hydrated from localStorage on
  // mount/sessionId change. Cleared when an assistant message arrives in
  // the message list (which means dispatch worked). Surfaced as a banner +
  // restore button when the dispatch has clearly failed (server idle but
  // local thinks busy).
  const [pendingPrompt, setPendingPrompt] = useState<string>("");

  useEffect(() => {
    if (!sessionId) {
      setPendingPrompt("");
      return;
    }
    setPendingPrompt(readPendingPrompt(sessionId));
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last) return;
    if (last.info.role !== "assistant") return;
    // An assistant reply landed - dispatch worked, drop the safety net.
    if (pendingPrompt) {
      writePendingPrompt(sessionId, "");
      setPendingPrompt("");
    }
  }, [messages, sessionId, pendingPrompt]);
  const [pendingPermissions, setPendingPermissions] = useState<
    PermissionRequest[]
  >([]);
  const [hasScrolledInitially, setHasScrolledInitially] = useState(false);
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<
    PromptAttachment[]
  >(() => (sessionId ? readAttachments(sessionId) : []));
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const sttMode = useSttModeStore((s) => s.mode);
  const sttEndOfStreamTimeoutMs = useSttModeStore((s) => s.endOfStreamTimeoutMs);
  const sttAutoSubmitOnEnd = useSttModeStore((s) => s.autoSubmitOnEnd);
  const sttSubmitOnEndRef = useRef(false);
  const sttTranscriptArrivedRef = useRef(false);
  const [sttTimeoutProgress, setSttTimeoutProgress] = useState<number | null>(null);
  const sttTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sttIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Visible "5..1" digit on the submit button during STT grace window.
  // Clamped at 1 so the button never shows 0 - auto-submit happens AT 0.
  const sttCountdownDigit =
    sttTimeoutProgress !== null && sttEndOfStreamTimeoutMs > 0
      ? Math.max(
          1,
          Math.ceil(
            ((100 - sttTimeoutProgress) / 100) *
              (sttEndOfStreamTimeoutMs / 1000),
          ),
        )
      : null;

  const cancelSttTimeout = useCallback(() => {
    if (sttTimeoutRef.current) clearTimeout(sttTimeoutRef.current);
    if (sttIntervalRef.current) clearInterval(sttIntervalRef.current);
    sttTimeoutRef.current = null;
    sttIntervalRef.current = null;
    setSttTimeoutProgress(null);
  }, []);

  const speechRecognition = useSttEngine({
    continuous: sttMode === "vad",
    onTranscript: (transcript) => {
      cancelSttTimeout();
      sttTranscriptArrivedRef.current = true;
      const ta = textareaRef.current;
      if (!ta) return;
      const current = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = current.substring(0, start);
      const after = current.substring(end);
      const sepBefore = before && !before.endsWith(" ") && !before.endsWith("\n") ? " " : "";
      const sepAfter = after && !after.startsWith(" ") && !after.startsWith("\n") ? " " : "";
      const insert = `${sepBefore}${transcript}${sepAfter}`;
      const next = before + insert + after;
      ta.value = next;
      ta.selectionStart = start + insert.length - sepAfter.length;
      ta.selectionEnd = ta.selectionStart;
      setHasContent(next.length > 0);
      scheduleDraftSave(next);
      const active = document.activeElement;
      const onComposerSurface =
        active === ta ||
        active === document.body ||
        active === null ||
        active === document.documentElement;
      if (onComposerSurface) {
        ta.focus({ preventScroll: true });
      }
    },
    onError: (err) => {
      toast.error(`Voice input: ${err}`);
    },
    onEnd: () => {
      if (sttSubmitOnEndRef.current) {
        sttSubmitOnEndRef.current = false;
        cancelSttTimeout();
        if (sttTranscriptArrivedRef.current && sttAutoSubmitOnEnd) {
          sttTranscriptArrivedRef.current = false;
          textareaRef.current?.form?.requestSubmit();
        } else {
          sttTranscriptArrivedRef.current = false;
        }
      } else if (sttMode === "push-to-talk" && sttEndOfStreamTimeoutMs > 0) {
        const startTime = Date.now();
        setSttTimeoutProgress(0);
        
        sttIntervalRef.current = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(100, (elapsed / sttEndOfStreamTimeoutMs) * 100);
          setSttTimeoutProgress(progress);
        }, 50);

        sttTimeoutRef.current = setTimeout(() => {
          cancelSttTimeout();
          if (speechRecognition.isListening) {
            sttSubmitOnEndRef.current = true;
            speechRecognition.stop();
          } else {
            sttSubmitOnEndRef.current = false;
            if (sttTranscriptArrivedRef.current && sttAutoSubmitOnEnd) {
              sttTranscriptArrivedRef.current = false;
              textareaRef.current?.form?.requestSubmit();
            } else {
              sttTranscriptArrivedRef.current = false;
            }
          }
        }, sttEndOfStreamTimeoutMs);

        setTimeout(() => {
          if (sttTimeoutRef.current) {
            speechRecognition.start();
          }
        }, 10);
      }
    },
  });
  const handleMicToggle = () => {
    if (speechRecognition.isListening || sttTimeoutRef.current) {
      if (sttMode === "push-to-talk") sttSubmitOnEndRef.current = true;
      cancelSttTimeout();
      speechRecognition.stop();
      if (sttTranscriptArrivedRef.current && sttAutoSubmitOnEnd) {
        sttTranscriptArrivedRef.current = false;
        textareaRef.current?.form?.requestSubmit();
      } else {
        sttTranscriptArrivedRef.current = false;
      }
    } else {
      // Reset BOTH refs so a stale `true` from a previous failed restart
      // (recognition.start() throws InvalidStateError, grace timer still
      // sets sttSubmitOnEndRef = true, recognition.stop() is a no-op
      // because recognitionRef is null) does not trigger an unintended
      // submission on the next session's onEnd. This is the cause of the
      // 'submits even though I haven't finished talking' bug.
      sttSubmitOnEndRef.current = false;
      sttTranscriptArrivedRef.current = false;
      speechRecognition.start();
    }
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesListRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ?focus=composer search param: focus the textarea on arrival, then strip
  // the param so a subsequent reload doesn't re-fire (mobile soft-keyboard
  // would pop up on every reload otherwise). Used by the Cmd palette
  // (Cmd/Ctrl+K) and any other "navigate-and-prepare-to-type" entry point.
  // Sidebar clicks intentionally don't set this so reading-only navigation
  // doesn't unsolicit the keyboard.
  //
  // Strip via window.history.replaceState (NOT tanstack-router navigate):
  // a router navigate would re-render, fire this effect's cleanup, and the
  // cleanup would race the rAF so the focus call never lands. replaceState
  // mutates the URL bar in place without notifying the router, so the
  // search-param strip is invisible to React.
  const focusSearchParam = Route.useSearch({
    select: (s) => s.focus,
  });
  const focusFiredRef = useRef(false);
  useEffect(() => {
    if (focusSearchParam !== "composer") return;
    if (focusFiredRef.current) return;
    focusFiredRef.current = true;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("focus");
        window.history.replaceState(null, "", url.toString());
      }
    });
  }, [focusSearchParam]);
  const fileAttachInputRef = useRef<HTMLInputElement>(null);
  const anyFileAttachInputRef = useRef<HTMLInputElement>(null);
  const isStuckToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const fileMention = useFileMention();
  const slashCommand = useSlashCommand();
  const { data: commandsData } = useCommands();
  const { data: agentsData } = useAgents();
  const { data: providersData } = useProviders();
  // Slash sub-picker items: when in agent/model mode, the popover renders
  // these instead of commandsData. Built once per render from the same SWR
  // caches feeding the AgentSelect/ModelSelect dropdowns in the composer
  // toolbar so the source of truth stays single.
  const slashItems = useMemo(() => {
    if (slashCommand.mode === "agent") {
      const agents = (agentsData as Array<{
        name: string;
        description?: string;
      }>) ?? [];
      return agents
        .filter((a) =>
          a.name
            .toLowerCase()
            .startsWith(slashCommand.searchQuery.toLowerCase()),
        )
        .map((a) => ({
          name: a.name,
          description: a.description,
          source: "agent" as const,
        }));
    }
    if (slashCommand.mode === "model") {
      type Provider = {
        id: string;
        name?: string;
        models?: Record<string, { name?: string }>;
      };
      const providers = (providersData as { providers?: Provider[] })
        ?.providers ?? [];
      const models: { name: string; description?: string }[] = [];
      for (const p of providers) {
        const ms = p.models ?? {};
        for (const [modelID, model] of Object.entries(ms)) {
          const flat = `${p.id}/${modelID}`;
          models.push({ name: flat, description: model.name ?? modelID });
        }
      }
      return models
        .filter((m) =>
          m.name
            .toLowerCase()
            .includes(slashCommand.searchQuery.toLowerCase()),
        )
        .slice(0, 50)
        .map((m) => ({ ...m, source: "model" as const }));
    }
    const builtin = [
      {
        name: "btw",
        description:
          "Side question - one short answer, no tools. Claude-Code parity.",
      },
    ];
    const merged = [...builtin, ...(commandsData ?? [])];
    return merged.filter((c) =>
      c.name.toLowerCase().startsWith(slashCommand.searchQuery.toLowerCase()),
    );
  }, [
    slashCommand.mode,
    slashCommand.searchQuery,
    commandsData,
    agentsData,
    providersData,
  ]);
  const filteredCommands = slashItems;

  const connectionStatus = useConnectionMonitor();
  // When opencode is down, useSessionMessages naturally fails (the
  // /api/opencode/{port}/session/{id}/messages proxy returns 502/500).
  // Hide the generic red "Error: HTTP 500" payload in that case - the
  // global yellow ConnectionStatusBanner is already telling the user
  // exactly what's wrong, and a separate destructive error inside the
  // chat view just adds noise. The friendly empty state below takes
  // over instead.
  const rawError = messagesError?.message || sendError;
  const error =
    connectionStatus === "opencode-down" && rawError ? null : rawError;
  const opencodeUnreachable =
    connectionStatus === "opencode-down" && !!messagesError;

  // Locally-tracked set of permission requestIDs the user has already
  // replied to from THIS browser. Polling may briefly re-include a
  // freshly-resolved permission (opencode's permission.list is eventually
  // consistent with /reply success), which previously caused the
  // permission widget to flicker back and feel "stuck" - clicks on
  // already-replied permissions either no-op'd or 404'd. By tracking
  // resolved ids here we filter them out of any future polling result
  // for the lifetime of the page, even if opencode's list lags.
  const dismissedPermissionsRef = useRef<Set<string>>(new Set());

  const refreshPendingPermissions = useCallback(async () => {
    if (!port || !sessionId) {
      setPendingPermissions([]);
      return;
    }

    try {
      const response = await fetch(`/api/opencode/${port}/permissions`);
      if (!response.ok) return;
      const raw = await response.json();
      const data: PermissionRequest[] = Array.isArray(raw) ? raw : [];
      setPendingPermissions(
        data.filter(
          (item) =>
            item.sessionID === sessionId &&
            !dismissedPermissionsRef.current.has(item.id),
        ),
      );
    } catch {
      // Keep current UI state on transient permission polling failures.
    }
  }, [port, sessionId]);

  const handlePermissionResolved = useCallback(
    (requestId: string) => {
      dismissedPermissionsRef.current.add(requestId);
      setPendingPermissions((prev) => prev.filter((p) => p.id !== requestId));
      if (port && sessionId) {
        mutateSessionMessages(port, sessionId);
      }
      refreshPendingPermissions();
    },
    [port, sessionId, refreshPendingPermissions],
  );

  // Auto-approve firing lives in the server-side worker plugin
  // (apps/web/src/server/plugins/auto-approve-worker.ts) so it keeps
  // running with no browser open. We refresh the local pending-
  // permission list whenever the SSE indicator stream reports a change
  // to this session's pendingPermissionIds - that's the read-side
  // signal that opencode emitted permission.asked / permission.replied
  // for us. The full PermissionRequest object (with .tool, .action,
  // etc. used by the widget) is not carried in the indicator frame, so
  // we still GET /api/opencode/{port}/permissions to materialise it,
  // but only on a state-change edge instead of on a 2s recurring poll.
  const sessionIndicator = useIndicator(instance?.id, sessionId);
  const pendingPermissionKey = sessionIndicator
    ? sessionIndicator.pendingPermissionIds.join(",")
    : "";
  useEffect(() => {
    refreshPendingPermissions();
  }, [refreshPendingPermissions, pendingPermissionKey]);

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

  // Belt-and-suspenders backup to the ResizeObserver: when messages change
  // (new message arrives, streaming text appended, optimistic message added
  // on submit) OR when sibling chrome (Thinking indicator, stall banner)
  // toggles, force a scroll to bottom on the next paint if stuck. The
  // ResizeObserver alone misses sibling chrome because it observes
  // messagesListRef only - the Thinking indicator and stall banner render
  // OUTSIDE that subtree but inside chatContainerRef. requestAnimationFrame
  // waits for layout to settle before measuring + scrolling.
  useEffect(() => {
    if (!isStuckToBottomRef.current) return;
    const id = requestAnimationFrame(() => {
      if (isStuckToBottomRef.current) scrollToBottom();
    });
    return () => cancelAnimationFrame(id);
  }, [
    messages,
    isAssistantBusy,
    isServerBusy,
    stallVerdict,
    scrollToBottom,
  ]);

  // Final safety net for follow-mode: any DOM mutation inside the scroll
  // container (sibling chrome appearing/disappearing, streaming text
  // appending character-by-character, asynchronous renders the React
  // dependency array can't predict) re-scrolls to the bottom while stuck.
  // characterData:true catches streaming text where the enclosing element
  // identity is stable but its text node grows.
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      if (!isStuckToBottomRef.current) return;
      requestAnimationFrame(() => {
        if (isStuckToBottomRef.current) scrollToBottom();
      });
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // External-chrome safety net: banners rendered ABOVE chatContainerRef in
  // the outer flex tree (ConnectionStatusBanner, BuildMismatchBanner,
  // NotificationPermissionBanner in _app.tsx, plus the sidebar title bar
  // changing height) shrink the chat container's clientHeight without
  // mutating any DOM inside it. MutationObserver above doesn't catch this;
  // neither does the scroll event handler (the browser doesn't fire scroll
  // for clientHeight changes that don't move scrollTop). Without this
  // observer, the moment a banner appears the user falls off the bottom by
  // the banner's height. ResizeObserver on the container itself catches
  // every resize - banner appear, banner disappear, window resize, sidebar
  // expand/collapse - and re-pins.
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!isStuckToBottomRef.current) return;
      scrollToBottom();
      requestAnimationFrame(() => {
        if (isStuckToBottomRef.current) scrollToBottom();
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  useEffect(() => {
    if (permalinkMode) return;
    if (!hasScrolledInitially && !loading && messages.length > 0) {
      setTimeout(() => {
        scrollToBottom();
        setHasScrolledInitially(true);
        isStuckToBottomRef.current = true;
        setShowJumpToBottom(false);
      }, 100);
    }
  }, [permalinkMode, hasScrolledInitially, loading, messages.length, scrollToBottom]);

  useEffect(() => {
    setHasScrolledInitially(false);
    isStuckToBottomRef.current = true;
    setShowJumpToBottom(false);
  }, [sessionId]);

  // In permalink mode, the target message wins the initial scroll - NOT
  // the bottom of the chat. The target lands as soon as the ?id=<msgId>
  // request resolves (typically before the surrounding windows); we
  // scroll to its DOM node via the existing id="msg-<id>" anchor.
  // useLayoutEffect runs before paint, so the user never sees a flash
  // of "scrolled-to-bottom" before the target scroll. We also detach
  // the stick-to-bottom magnet by setting isStuckToBottomRef=false, so
  // the rest of the auto-scroll machinery (ResizeObserver,
  // MutationObserver) won't fight the target scroll as the before /
  // after / latest windows fill in.
  const permalinkScrolledRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!permalinkMode) {
      permalinkScrolledRef.current = null;
      return;
    }
    if (!permalinkTarget) return;
    if (permalinkScrolledRef.current === permalinkTarget) return;
    const node = document.getElementById(`msg-${permalinkTarget}`);
    if (!node) return;
    permalinkScrolledRef.current = permalinkTarget;
    isStuckToBottomRef.current = false;
    setShowJumpToBottom(true);
    const container = chatContainerRef.current;
    if (!container) {
      node.scrollIntoView({ block: "center" });
      flashMessageHighlight(permalinkTarget);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const targetTop =
      node.getBoundingClientRect().top -
      containerRect.top +
      container.scrollTop;
    container.scrollTop = Math.max(0, targetTop - containerRect.height / 3);
    flashMessageHighlight(permalinkTarget);
  }, [permalinkMode, permalinkTarget, messages.length]);

  const handleJumpToBottom = useCallback(() => {
    scrollToBottom();
    isStuckToBottomRef.current = true;
    setShowJumpToBottom(false);
  }, [scrollToBottom]);

  // Walk the message list (DOM-side, by data-role attribute) to find the
  // nearest user message above or below the current scroll position. We
  // anchor on the top edge of each message: previous = highest top that's
  // still above the viewport's top; next = lowest top that's still below.
  // A small epsilon (4px) prevents getting stuck on the user message
  // that's currently at the top of the viewport.
  //
  // Special case for "previous" at the top of the visible window: if the
  // initial-load cap is still active (the "Load earlier messages" button
  // is showing), the user pressing ↑ at the top is best interpreted as
  // "go back further in history". We trigger the full load and remember
  // to scroll to the new topmost user message once the data lands.
  const pendingLoadAndScrollRef = useRef<"first-user" | null>(null);

  const scrollToUserNode = useCallback((node: HTMLElement) => {
    const container = chatContainerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const targetTop =
      node.getBoundingClientRect().top - containerRect.top + container.scrollTop;
    container.scrollTo({
      top: Math.max(0, targetTop - 8),
      behavior: "smooth",
    });
    isStuckToBottomRef.current = false;
  }, []);

  const handleJumpUserPrompt = useCallback(
    (direction: "previous" | "next") => {
      const container = chatContainerRef.current;
      if (!container) return;
      const userNodes = Array.from(
        container.querySelectorAll<HTMLElement>('[data-role="user"]'),
      );
      if (userNodes.length === 0) {
        if (
          direction === "previous" &&
          !loadAllMessages &&
          messages.length >= INITIAL_MESSAGE_LIMIT
        ) {
          pendingLoadAndScrollRef.current = "first-user";
          setLoadAllMessages(true);
        }
        return;
      }

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
        if (!target) {
          if (!loadAllMessages && messages.length >= INITIAL_MESSAGE_LIMIT) {
            pendingLoadAndScrollRef.current = "first-user";
            setLoadAllMessages(true);
            return;
          }
          target = userNodes[0] ?? null;
        }
      } else {
        for (let i = 0; i < userNodes.length; i++) {
          if ((offsets[i] ?? 0) > epsilon) {
            target = userNodes[i] ?? null;
            break;
          }
        }
        target ??= userNodes[userNodes.length - 1] ?? null;
      }
      if (!target) return;
      scrollToUserNode(target);
    },
    [loadAllMessages, messages.length, scrollToUserNode],
  );

  // After a "load earlier" triggered by ↑ at the top, jump to the new
  // topmost user message so the user sees the previously-hidden history
  // without losing their place. We watch the messages-length growth that
  // loadAllMessages produces; on the first growth tick we scroll and
  // clear the pending intent.
  useEffect(() => {
    if (pendingLoadAndScrollRef.current !== "first-user") return;
    if (!loadAllMessages) return;
    const container = chatContainerRef.current;
    if (!container) return;
    const first = container.querySelector<HTMLElement>('[data-role="user"]');
    if (!first) return;
    pendingLoadAndScrollRef.current = null;
    requestAnimationFrame(() => scrollToUserNode(first));
  }, [loadAllMessages, messages.length, scrollToUserNode]);

  const draftSaveTimerRef = useRef<number | null>(null);
  const composerChannelRef = useRef<BroadcastChannel | null>(null);

  // Restore the draft for this session into the textarea on mount, on
  // session change, and whenever the composer toggles back from collapsed
  // (which unmounts the textarea node, dropping its uncontrolled value).
  useEffect(() => {
    if (!sessionId) return;
    if (composerCollapsed) return;
    const draft = readDraft(sessionId);
    if (textareaRef.current) {
      textareaRef.current.value = draft;
      setHasContent(draft.length > 0);
    }
  }, [sessionId, composerCollapsed]);

  useEffect(() => {
    if (!sessionId) return;
    if (typeof window === "undefined") return;
    if (typeof BroadcastChannel === "undefined") return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(COMPOSER_SYNC_CHANNEL);
    } catch {
      return;
    }
    composerChannelRef.current = channel;
    const handler = (ev: MessageEvent<ComposerSyncMessage>) => {
      const msg = ev.data;
      if (!msg || msg.kind !== "draft-submitted") return;
      if (msg.sessionId !== sessionId) return;
      const ta = textareaRef.current;
      if (!ta) return;
      if (!ta.value) return;
      const result = smartPostSubmitClear(ta, msg.content);
      if (!result.cleared) return;
      setHasContent(result.newValue.length > 0);
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      writeDraft(sessionId, result.newValue);
    };
    channel.addEventListener("message", handler);
    return () => {
      channel.removeEventListener("message", handler);
      channel.close();
      composerChannelRef.current = null;
    };
  }, [sessionId]);

  // Per-device persistence cadence.
  //
  // Desktop: write on every keystroke. localStorage on a desktop browser
  // is microsecond-level; debouncing is over-optimization and previously
  // introduced data loss on fast navigation (2s window where a short
  // draft never made it to disk).
  //
  // Mobile: 5s debounce. Keystroke-rate writes can hitch the IME on
  // older Android devices and burn battery on a long compose. The
  // unmount/session-change cleanup below + the composer-collapse handler
  // both flush synchronously regardless of device, so a typing-then-
  // navigating mobile user never loses data even with the debounce
  // pending.
  //
  // Cross-tab safety (DRAFT_MIN_BYTES rule): the concern is a SECOND tab
  // mounting with an empty/short textarea and clobbering the FIRST tab's
  // longer draft. So short values are only persisted when there's no
  // existing prior to clobber. With no prior in localStorage, ANY non-
  // empty value is safe to write. Empty values never write (user clearing
  // the field doesn't mean they want to drop another tab's stored draft);
  // the acknowledged-submit path in handleSubmit calls writeDraft("")
  // explicitly to clear.
  const MOBILE_DRAFT_DEBOUNCE_MS = 5000;
  const persistShortIfNoPrior = useCallback(
    (value: string) => {
      if (!sessionId) return false;
      if (value.length === 0) return false;
      if (value.length >= DRAFT_MIN_BYTES) return true;
      return readDraft(sessionId).length === 0;
    },
    [sessionId],
  );
  const scheduleDraftSave = useCallback(
    (value: string) => {
      if (!sessionId) return;
      if (!persistShortIfNoPrior(value)) return;
      if (!isMobile) {
        writeDraft(sessionId, value);
        return;
      }
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
      }
      draftSaveTimerRef.current = window.setTimeout(() => {
        writeDraft(sessionId, value);
        draftSaveTimerRef.current = null;
      }, MOBILE_DRAFT_DEBOUNCE_MS);
    },
    [sessionId, persistShortIfNoPrior, isMobile],
  );

  useEffect(() => {
    return () => {
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      if (sessionId && textareaRef.current) {
        const value = textareaRef.current.value;
        if (persistShortIfNoPrior(value)) {
          writeDraft(sessionId, value);
        }
      }
    };
  }, [sessionId, persistShortIfNoPrior]);

  useEffect(() => {
    if (!sessionId) return;
    writeAttachments(sessionId, pendingAttachments);
  }, [sessionId, pendingAttachments]);

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

  const handleForkRequest = useCallback(
    async (message: MessageWithParts) => {
      if (!port || !sessionId) return;
      try {
        const res = await fetch(
          `/api/opencode/${port}/session/${sessionId}/fork`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageID: message.info.id }),
          },
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await readErrorMessage(res)}`);
        }
        const newSession = (await res.json()) as { id: string };
        if (!newSession?.id) {
          throw new Error("Fork response missing session id");
        }
        toast.success("Forked to new session");
        await navigate({
          to: "/session/$id",
          params: { id: newSession.id },
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        toast.error(`Fork failed: ${detail}`);
      }
    },
    [port, sessionId, navigate],
  );

  // Recovery for the 'prompt accepted but generation never dispatched'
  // failure mode. Walk the messages backwards to the last user-role
  // message that has no assistant follow-up, take its text, and
  // re-submit via prompt_async. opencode WILL create a new user
  // message (no API to re-fire generation against an existing one) -
  // the caller can revert the duplicate later if needed. The point is
  // to unstick the session.
  const handleRetryLastUserPrompt = useCallback(async () => {
    if (!port || !sessionId) return;
    let lastUserText: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m) continue;
      if (m.info.role === "assistant") break;
      if (m.info.role === "user") {
        for (const part of m.parts) {
          if (part.type === "text" && part.text) {
            lastUserText = part.text;
            break;
          }
        }
        if (lastUserText) break;
      }
    }
    if (!lastUserText) return;
    try {
      const retryRes = await fetch(
        `/api/opencode/${port}/session/${sessionId}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: lastUserText,
            model: isOverridingDefault() ? selectedModel : undefined,
            agent: selectedAgent,
            variant: thinkingEffort || undefined,
          }),
        },
      );
      if (retryRes.ok) {
        const retryResult = (await retryRes
          .json()
          .catch(() => null)) as { recoveredFromRestart?: boolean } | null;
        if (retryResult?.recoveredFromRestart) {
          toast.success(
            "Recovered: this session was stuck from a previous restart.",
          );
        }
      }
      mutateSessionMessages(port, sessionId);
    } catch {
      // Best-effort; the indicator will continue to show the stuck
      // state and the user can hit the button again.
    }
  }, [
    port,
    sessionId,
    messages,
    isOverridingDefault,
    selectedModel,
    selectedAgent,
  ]);

  // stuck-busy recovery: opencode reports busy + ours agrees, but no
  // streaming progress for >= 5 minutes. abort the wedged generation
  // first (POST /session/:id/abort), then re-submit the last user
  // prompt. The order matters - if we resubmit without aborting,
  // opencode's queue piles up behind the wedged turn.
  //
  // Declared AFTER handleRetryLastUserPrompt because the deps array
  // (a real expression) reads handleRetryLastUserPrompt at render
  // time. With handleAbortAndRetry placed BEFORE handleRetryLast
  // UserPrompt, the dep-array evaluation TDZ-errors on the const
  // before initialization; minifier symbol-reuse for the same name
  // means the throw surfaces as the cryptic 'Cannot access X before
  // initialization' from anywhere downstream in the same render.
  const handleAbortAndRetry = useCallback(async () => {
    await handleAbort();
    await handleRetryLastUserPrompt();
  }, [handleAbort, handleRetryLastUserPrompt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || !port) return;
    const rawValue = textareaRef.current?.value ?? "";
    const submittedSnapshot = rawValue;
    let messageText = rawValue.trim();
    if (!messageText && pendingAttachments.length === 0) return;

    // /btw <question> wraps the question with a system-prompt hint so
    // the model answers in a single short turn without firing tools.
    // The user gets Claude-Code-style "side question" semantics without
    // a separate session-forking pipeline.
    const btwMatch = messageText.match(/^\/btw\s+([\s\S]+)$/);
    if (btwMatch) {
      const question = btwMatch[1].trim();
      messageText = `[BTW: side question - answer briefly in ONE response, do not call any tools, do not promise follow-up actions]\n\n${question}`;
    }

    // Phase 5 of slash UX: /agent <name> [prompt] and /model <name> [prompt]
    // are NOT opencode commands - they are inline overrides for the current
    // submission. Pop the prefix off the text and route as a normal /prompt
    // with the override applied. If <prompt> is empty the agent/model is
    // still applied (treated as "remind me what's active" + keep typing).
    let inlineAgent: string | undefined;
    let inlineModel: string | undefined;
    const overrideMatch = messageText.match(
      /^\/(agent|model)\s+(\S+)(?:\s+([\s\S]*))?$/,
    );
    if (overrideMatch) {
      const kind = overrideMatch[1];
      const name = overrideMatch[2];
      const rest = (overrideMatch[3] ?? "").trim();
      if (kind === "agent") inlineAgent = name;
      else inlineModel = name;
      messageText = rest;
      if (!messageText && pendingAttachments.length === 0) {
        toast.success(
          kind === "agent"
            ? `Agent set to ${name}. Type your prompt next.`
            : `Model set to ${name}. Type your prompt next.`,
        );
        textareaRef.current!.value = "";
        setHasContent(false);
        return;
      }
    }

    // Slash-command detection. If the leading token matches a command we
    // know about (from the SWR-cached commands list driving the popover),
    // dispatch through opencode's /command endpoint rather than /prompt.
    // /command engages the full command machinery (template loading,
    // frontmatter agent/model overrides, command.executed events);
    // /prompt would just send the literal "/foo bar" string as chat text.
    // Unknown commands fall through to /prompt so a stray typo "/whoops"
    // is still treated as a chat message.
    let slashDispatch: { command: string; arguments: string } | null = null;
    if (messageText.startsWith("/")) {
      const m = messageText.match(/^\/(\S+)\s*([\s\S]*)$/);
      if (m) {
        const name = m[1];
        const argsTail = m[2];
        const known = (commandsData ?? []).some((c) => c.name === name);
        if (known) {
          slashDispatch = { command: name, arguments: argsTail };
        }
      }
    }

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
        _pending: {
          attempts: 0,
          lastAttemptAt: Date.now(),
          lastError: null,
          archiveId: messageId,
          phase: "submitting",
        },
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
    if (permalinkMode) {
      exitPermalinkMode();
    }
    addOptimisticMessage(port, sessionId, optimisticMessage);
    isStuckToBottomRef.current = true;
    setShowJumpToBottom(false);
    scrollToBottom();

    // Stash the in-flight prompt to localStorage BEFORE we touch the
    // textarea. This is the safety net for the silent-dispatch-drop bug:
    // if opencode accepts the POST but never starts generation, the
    // text is still in localStorage and can be restored on reload or
    // surfaced via the resubmit recovery UI.
    writePendingPrompt(sessionId, messageText);
    setSending(true);
    try {
      // If the user has staged a revert, physically delete the targeted
      // messages BEFORE the prompt POST. opencode's session.revert pointer
      // is transient - it's auto-cleared the moment the next prompt arrives,
      // so any client-side filter hung off it would be a no-op as soon as
      // we submit. Hard-deleting through the message-DELETE endpoint gives
      // us a permanent truncation that survives F5 and matches the user's
      // mental model of "remove everything from here onward".
      //
      //   user-mode:      delete the target user message itself + everything
      //                   chronologically after it.
      //   assistant-mode: keep the target assistant message; delete only
      //                   what came after.
      //
      // Deletes run in reverse chronological order to avoid any opencode
      // invariant that might key off the latest message.
      if (revertTarget) {
        const targetIdx = messages.findIndex(
          (m) => m.info.id === revertTarget.messageId,
        );
        // Hard-fail when the staged revert target isn't in the loaded
        // message window. The two realistic causes (Load-N-more pager
        // hasn't pulled it in yet, or a mid-poll SWR replace dropped it)
        // both produce the same silent-no-op without this guard: DELETE
        // loop is skipped, revertTarget cleared, new prompt POSTed,
        // user's "revert" disappears with no error to point at. Throwing
        // here aborts the entire submit so the user can act on the toast.
        if (targetIdx < 0) {
          throw new Error(
            `Revert target ${revertTarget.messageId} is not in the loaded message list. ` +
              `Try clicking "Load more" to bring older messages into view, then retry the revert.`,
          );
        }
        const startIdx =
          revertTarget.mode === "user" ? targetIdx : targetIdx + 1;
        const idsToDelete: string[] = [];
        for (let i = startIdx; i < messages.length; i++) {
          const id = messages[i]?.info.id;
          if (id && !id.startsWith("temp-")) idsToDelete.push(id);
        }
        for (let i = idsToDelete.length - 1; i >= 0; i--) {
          const messageID = idsToDelete[i]!;
          const deleteResponse = await fetch(
            `/api/opencode/${port}/session/${sessionId}/message/${encodeURIComponent(
              messageID,
            )}`,
            { method: "DELETE" },
          );
          if (!deleteResponse.ok) {
            throw new Error(
              `Delete failed for ${messageID}: ${await readErrorMessage(
                deleteResponse,
              )}`,
            );
          }
        }
        setRevertTarget(null);
      }
      const effectiveAgent = inlineAgent ?? selectedAgent;
      const effectiveModelFlat = inlineModel
        ? inlineModel
        : isOverridingDefault()
          ? `${selectedModel.providerID}/${selectedModel.modelID}`
          : undefined;
      const effectiveModelObject = inlineModel
        ? (() => {
            const slash = inlineModel.indexOf("/");
            return slash > 0
              ? {
                  providerID: inlineModel.slice(0, slash),
                  modelID: inlineModel.slice(slash + 1),
                }
              : { providerID: "", modelID: inlineModel };
          })()
        : isOverridingDefault()
          ? selectedModel
          : undefined;

      const response = slashDispatch
        ? await fetch(
            `/api/opencode/${port}/session/${sessionId}/command`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command: slashDispatch.command,
                arguments: slashDispatch.arguments,
                agent: effectiveAgent,
                model: effectiveModelFlat,
                variant: thinkingEffort || undefined,
              }),
            },
          )
        : await fetch(
            `/api/opencode/${port}/session/${sessionId}/prompt`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: messageText,
                attachments: attachmentsForMessage.length
                  ? attachmentsForMessage
                  : undefined,
                model: effectiveModelObject,
                agent: effectiveAgent,
                variant: thinkingEffort || undefined,
              }),
            },
          );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      // Phase transition: portal accepted -> opencode received it. The
      // badge color advances from light blue (submitting) to medium blue
      // (sent-to-opencode). The optimistic row will get replaced by the
      // real opencode message via the upcoming mutateSessionMessages, at
      // which point the badge disappears entirely.
      updateOptimisticMessage(port, sessionId, messageId, {
        info: {
          ...optimisticMessage.info,
          _pending: {
            ...(optimisticMessage.info._pending ?? {
              attempts: 0,
              lastAttemptAt: Date.now(),
              lastError: null,
              archiveId: messageId,
            }),
            phase: "opencode-accepted",
          },
        },
      });
      const promptResult = (await response
        .json()
        .catch(() => null)) as { recoveredFromRestart?: boolean } | null;
      if (promptResult?.recoveredFromRestart) {
        toast.success(
          "Recovered: this session was stuck from a previous restart.",
        );
      }
      let postClearValue = "";
      if (textareaRef.current) {
        const result = smartPostSubmitClear(
          textareaRef.current,
          submittedSnapshot,
        );
        postClearValue = result.newValue;
      }
      setHasContent(postClearValue.length > 0);
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      writeDraft(sessionId, postClearValue);
      try {
        composerChannelRef.current?.postMessage({
          kind: "draft-submitted",
          sessionId,
          content: submittedSnapshot,
        } satisfies ComposerSyncMessage);
      } catch {
        /* channel closed or unavailable - cross-tab sync is best-effort */
      }
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

  const renderMessage = useCallback(
    (
      message: MessageWithParts,
      idx: number,
      ctx: {
        baseVisible: MessageWithParts[];
        revertIndex: number;
        lastErrorMessageId: string | undefined;
      },
    ) => {
      let pendingDelete = false;
      if (revertTarget && ctx.revertIndex >= 0) {
        if (revertTarget.mode === "user") {
          pendingDelete = idx >= ctx.revertIndex;
        } else {
          pendingDelete = idx > ctx.revertIndex;
        }
      }
      let isQueued = false;
      if (message.info.role === "user") {
        // In onlyUserMessages mode the backend strips assistants from
        // the response (apps/web/src/server/.../messages.ts ?onlyUser=1),
        // so the "find next assistant" scan below would mark every
        // historic user prompt as queued - even though they ALL got
        // answered when they were submitted. The queued badge is only
        // meaningful in the full chat view; in user-only mode trust the
        // _pending sentinel on the optimistic message to surface the
        // single truly-pending submission and skip the scan.
        if (!onlyUserMessages) {
          const baseIdx = ctx.baseVisible.findIndex(
            (m) => m.info.id === message.info.id,
          );
          // A user message is "answered" iff there's an assistant message
          // SOMEWHERE after it. opencode batches multiple consecutive user
          // prompts under a single assistant response (the user can press
          // Submit several times before opencode starts generating), so an
          // intermediate user message MUST NOT short-circuit this scan or
          // the older messages get incorrectly marked queued while the
          // newest one (which sees the assistant directly) does not -
          // exactly the "Queued out-of-order" symptom the user reported.
          let answered = false;
          for (let j = baseIdx + 1; j < ctx.baseVisible.length; j++) {
            const next = ctx.baseVisible[j];
            if (!next) break;
            if (next.info.role === "assistant") {
              answered = true;
              break;
            }
          }
          const isLastInBase =
            baseIdx >= 0 && baseIdx === ctx.baseVisible.length - 1;
          isQueued = !answered && !(isLastInBase && isServerBusy);
        }
      }
      const messageWithQueueFlag = isQueued
        ? { ...message, isQueued: true }
        : message;
      return (
        <MessageItem
          key={message.info.id}
          message={messageWithQueueFlag}
          port={port}
          sessionId={sessionId}
          sessionDirectory={currentSession?.directory ?? null}
          pendingPermissions={pendingPermissions}
          onPermissionResolved={handlePermissionResolved}
          isAssistantBusy={isAssistantBusy}
          isQuestionBlocked={isQuestionBlocked}
          onAbort={handleAbort}
          pendingDelete={pendingDelete}
          onRevertRequest={handleRevertRequest}
          onForkRequest={handleForkRequest}
          isLastError={message.info.id === ctx.lastErrorMessageId}
        />
      );
    },
    [
      port,
      sessionId,
      currentSession?.directory,
      pendingPermissions,
      handlePermissionResolved,
      isAssistantBusy,
      isQuestionBlocked,
      isServerBusy,
      handleAbort,
      revertTarget,
      handleRevertRequest,
      handleForkRequest,
    ],
  );

  const messageNodes = useMemo(() => {
    // No filter against session.revert.messageID here: that pointer is
    // transient and gets cleared by opencode the moment a new prompt is
    // appended. Permanent truncation is now done by hard-deleting messages
    // through the message-DELETE route in handleSubmit, so the message list
    // returned by /session/{id}/message is already authoritative.
    const baseVisible = messages.filter((message) => hasVisibleContent(message));
    const visible = onlyUserMessages
      ? baseVisible.filter((m) => m.info.role === "user")
      : baseVisible;
    const revertIndex = revertTarget
      ? visible.findIndex((m) => m.info.id === revertTarget.messageId)
      : -1;
    let lastErrorMessageId: string | undefined;
    for (let i = visible.length - 1; i >= 0; i--) {
      const m = visible[i];
      if (m.info.role === "assistant" && isFailedAssistant(m.info)) {
        lastErrorMessageId = m.info.id;
        break;
      }
    }
    const ctx = { baseVisible, revertIndex, lastErrorMessageId };

    if (!permalinkMode || !permalinkWindow.gap) {
      return visible.map((message, idx) => renderMessage(message, idx, ctx));
    }

    const aroundIds = new Set(permalinkWindow.around.map((m) => m.info.id));
    const aroundPart: MessageWithParts[] = [];
    const latestPart: MessageWithParts[] = [];
    for (const m of visible) {
      if (aroundIds.has(m.info.id)) aroundPart.push(m);
      else latestPart.push(m);
    }

    return (
      <>
        {aroundPart.map((message, idx) => renderMessage(message, idx, ctx))}
        <PermalinkGapBanner
          gapCount={permalinkWindow.gap.count}
          loading={permalinkWindow.loading.fillGap}
          onLoadNext={() => permalinkWindow.fillGap("next50")}
          onLoadAll={() => permalinkWindow.fillGap("all")}
        />
        {latestPart.map((message, idx) =>
          renderMessage(message, aroundPart.length + idx, ctx),
        )}
      </>
    );
  }, [
    messages,
    onlyUserMessages,
    revertTarget,
    permalinkMode,
    permalinkWindow.gap,
    permalinkWindow.around,
    permalinkWindow.loading.fillGap,
    permalinkWindow.fillGap,
    renderMessage,
  ]);

  // Size cap is conservative because the prompt body is sent inline as a
  // data URL (base64-encoded, ~33% inflation). A 10 MB file becomes a
  // ~13.3 MB JSON request body, which is fine for opencode but stresses
  // the assistant's token budget on multimodal models that re-encode
  // attachments back to base64 internally. For typical attachments
  // (config files, screenshots, short PDFs) this is plenty.
  const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

  const handleAttachFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const oversized: string[] = [];
    const reads = await Promise.all(
      list.map(
        (file) =>
          new Promise<PromptAttachment | null>((resolve) => {
            if (file.size > ATTACHMENT_MAX_BYTES) {
              oversized.push(file.name);
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
                // Fall back to application/octet-stream when the browser
                // can't infer a MIME (e.g., extensionless files). Empty
                // string would fail the prompt-body Zod schema.
                mime: file.type || "application/octet-stream",
                filename: file.name,
                url: result,
              });
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }),
      ),
    );

    if (oversized.length > 0) {
      toast.error(
        `Skipped ${oversized.length} file(s) over 10 MB: ${oversized.join(", ")}`,
      );
    }

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
    <div className="flex flex-1 flex-col min-h-0">
      <div className="relative flex-1 min-h-0">
      <TextSelectionMenu
        containerRef={messagesListRef}
        textareaRef={textareaRef}
        setHasContent={setHasContent}
      />
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

        {!loading && !error && opencodeUnreachable && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-base font-medium text-fg">
              OpenCode is unreachable
            </div>
            <p className="max-w-md text-sm text-muted-fg">
              Live session messages can't load until OpenCode is back. The
              connection monitor is retrying every 10 seconds. Prompts
              archive, settings, and the server list still work in the
              meantime.
            </p>
          </div>
        )}

        {!loading && !error && !opencodeUnreachable && messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-muted-fg">No messages yet</div>
          </div>
        )}

        <div ref={messagesListRef}>
          {permalinkMode && (
            <PermalinkLoaderBar
              target={permalinkTarget}
              loading={permalinkWindow.loading}
              targetFound={permalinkWindow.targetFound}
              totalCount={permalinkWindow.totalCount}
              targetIndex={permalinkWindow.targetIndex}
              error={permalinkWindow.error}
              onExit={exitPermalinkMode}
              onLoadAll={() => permalinkWindow.fillGap("all")}
            />
          )}
          {!loading && !error && (
            <>
              {!permalinkMode &&
                !loadAllMessages &&
                messages.length >= messageLimit && (
                  <div className="px-3 py-3 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        const sel = window.getSelection();
                        if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
                          loadMoreSelectionRef.current = sel
                            .getRangeAt(0)
                            .cloneRange();
                          e.preventDefault();
                        }
                      }}
                      onClick={() => {
                        const container = chatContainerRef.current;
                        if (container) {
                          loadMoreScrollAnchorRef.current = {
                            scrollTop: container.scrollTop,
                            scrollHeight: container.scrollHeight,
                          };
                        }
                        setMessageLimit((n) => n + INITIAL_MESSAGE_LIMIT);
                      }}
                      className="rounded-md border border-border bg-bg px-3 py-1 text-xs text-muted-fg hover:border-fg/30 hover:text-fg transition-colors"
                    >
                      Load {INITIAL_MESSAGE_LIMIT} more
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoadAllMessages(true)}
                      title="Loading the entire history can take long on big sessions"
                      className="rounded-md border border-dashed border-border bg-bg px-3 py-1 text-xs text-muted-fg hover:border-fg/30 hover:text-fg transition-colors"
                    >
                      Load all (slow)
                    </button>
                  </div>
                )}
              {permalinkMode && permalinkWindow.loading.before && (
                <div className="px-3 py-2 flex items-center justify-center gap-2 text-xs text-muted-fg">
                  <Loader className="size-4" />
                  <span>Loading messages before target...</span>
                </div>
              )}
              {todoSnapshot && (
                <div className="px-3">
                  <TodoFloat snapshot={todoSnapshot} />
                </div>
              )}
            </>
          )}
          {messageNodes}
          {permalinkMode && permalinkWindow.loading.after && (
            <div className="px-3 py-2 flex items-center justify-center gap-2 text-xs text-muted-fg">
              <Loader className="size-4" />
              <span>Loading messages after target...</span>
            </div>
          )}
          {permalinkMode && permalinkWindow.loading.latest && (
            <div className="px-3 py-2 flex items-center justify-center gap-2 text-xs text-muted-fg">
              <Loader className="size-4" />
              <span>Loading latest messages...</span>
            </div>
          )}
          {unlinkedPermissions.length > 0 && (
            <div className="px-3 py-4 space-y-2 border-t border-dashed border-border">
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

        {sessionIndicator?.mode === "compaction" && (
          <div className="py-3 px-3">
            <div className="flex items-center gap-2">
              <Ripples size="30" speed="2" color="var(--color-violet-500)" />
              <span className="text-sm font-medium text-violet-600 dark:text-violet-400 animate-pulse">
                Compacting...
              </span>
              <span className="text-xs text-muted-fg">
                summarising older history
              </span>
            </div>
          </div>
        )}
        {isAssistantBusy &&
          isServerBusy &&
          !isQuestionBlocked &&
          sessionIndicator?.mode !== "compaction" && (
            <div className="py-3 px-3">
              <div className="flex items-center gap-2">
                <Ripples size="30" speed="2" color="var(--color-primary)" />
                <span className="text-sm text-muted-fg">Thinking...</span>
                <ThinkingStaleness messages={messages} />
              </div>
            </div>
          )}
        {isQuestionBlocked && (
          <div className="border-t border-sky-500/30 bg-sky-500/10 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-sky-500" />
              </span>
              <span className="text-fg">
                OpenCode is waiting for your answer to the question above.
              </span>
              {blockingQuestionMessageId && (
                <button
                  type="button"
                  onClick={() => {
                    const el = document.querySelector(
                      `[data-message-id="${CSS.escape(blockingQuestionMessageId)}"]`,
                    );
                    if (el)
                      el.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                      });
                  }}
                  className="text-xs underline underline-offset-2 text-fg hover:text-sky-500"
                >
                  Scroll to question ↑
                </button>
              )}
            </div>
          </div>
        )}
        {stallVerdict === "no-dispatch" && (
          <div className="py-3 px-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-warning-subtle-fg">
                Server is idle - prompt accepted but generation never started.
              </span>
              <button
                type="button"
                onClick={() => handleRetryLastUserPrompt()}
                className="text-xs underline underline-offset-2 text-fg hover:text-primary"
              >
                Resubmit
              </button>
              {pendingPrompt && (
                <button
                  type="button"
                  onClick={() => {
                    if (textareaRef.current) {
                      textareaRef.current.value = pendingPrompt;
                      setHasContent(pendingPrompt.length > 0);
                      textareaRef.current.focus();
                    }
                  }}
                  className="text-xs underline underline-offset-2 text-fg hover:text-primary"
                  title="Paste the prompt text back into the composer so you can edit and resend it"
                >
                  Restore to composer
                </button>
              )}
            </div>
          </div>
        )}
        {stallVerdict === "stuck-busy" && (
          <div className="py-3 px-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-warning-subtle-fg">
                Session may be wedged - OpenCode reports busy but no streaming progress.
              </span>
              <button
                type="button"
                onClick={() => handleAbortAndRetry()}
                className="text-xs underline underline-offset-2 text-fg hover:text-primary"
                title="Cancel the in-flight turn on OpenCode, then re-submit the last user prompt"
              >
                Abort + retry
              </button>
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
        {composerCollapsed && (
          <button
            type="button"
            onClick={() => setComposerCollapsed(false)}
            data-test="portal-composer-show"
            className="absolute bottom-5 right-16 z-30 rounded-md border border-border bg-bg/95 p-1.5 text-muted-fg shadow-sm hover:bg-muted hover:text-fg transition-colors"
            aria-label="Show composer"
            title="Show composer"
          >
            <ChevronUpIcon className="size-4" />
          </button>
        )}
        {messages.length > 0 && (
          <div className="absolute bottom-3 right-3 z-30 flex flex-col gap-2">
            {messages.some((m) => m.info.role === "user") && (
              <button
                type="button"
                onClick={() => handleJumpUserPrompt("previous")}
                data-test="portal-chat-prevuser"
                className="flex size-10 items-center justify-center rounded-full border border-border bg-bg/95 text-fg shadow-lg hover:bg-muted transition-colors"
                aria-label="Previous user message"
                title="Previous user message"
              >
                <ChevronUpIcon className="size-5" />
              </button>
            )}
            <button
              type="button"
              onClick={togglePromptsOnly}
              data-test="portal-chat-promptsonly"
              aria-pressed={onlyUserMessages}
              className={`flex size-10 items-center justify-center rounded-full border bg-bg/95 shadow-lg transition-colors ${
                onlyUserMessages
                  ? "border-primary/40 bg-primary/10 text-fg hover:bg-primary/20"
                  : "border-border text-fg hover:bg-muted"
              }`}
              aria-label={
                onlyUserMessages ? "Show all messages" : "Show prompts only"
              }
              title={
                onlyUserMessages ? "Show all messages" : "Show prompts only"
              }
            >
              {onlyUserMessages ? (
                <UserIcon className="size-5" />
              ) : (
                <ChatBubbleLeftRightIcon className="size-5" />
              )}
            </button>
            {messages.some((m) => m.info.role === "user") && (
              <button
                type="button"
                onClick={() => handleJumpUserPrompt("next")}
                data-test="portal-chat-nextuser"
                className="flex size-10 items-center justify-center rounded-full border border-border bg-bg/95 text-fg shadow-lg hover:bg-muted transition-colors"
                aria-label="Next user message"
                title="Next user message"
              >
                <ChevronDownIcon className="size-5" />
              </button>
            )}
            {/* Jump-to-bottom keeps its slot in the stack even when the
                user is already at the bottom: visibility:hidden preserves
                the layout box, so prev/next don't reflow downward as the
                user scrolls in and out of stuck-at-bottom. aria-hidden +
                tabIndex={-1} make the button inert for AT and keyboard
                focus while it's not actionable. */}
            <button
              type="button"
              onClick={handleJumpToBottom}
              data-test="portal-chat-jumptobottom"
              aria-label="Jump to bottom"
              aria-hidden={!showJumpToBottom}
              tabIndex={showJumpToBottom ? 0 : -1}
              className={`flex size-10 items-center justify-center rounded-full border border-border bg-bg/95 text-fg shadow-lg hover:bg-muted transition-colors ${
                showJumpToBottom ? "" : "invisible pointer-events-none"
              }`}
              title="Jump to bottom"
            >
              <ChevronDoubleDownIcon className="size-5" />
            </button>
          </div>
        )}
      </div>

      {!composerCollapsed && (
        <div
          className="border-t border-border shrink-0 relative flex flex-col overflow-hidden"
          style={{ maxHeight: `${composerMaxHeight}px` }}
        >
          <>
            <div className="flex items-center gap-0.5 sm:gap-1 px-1 py-1 text-[10px] sm:text-sm [&_button[data-slot=control]]:py-0.5 sm:[&_button[data-slot=control]]:py-1 [&_button[data-slot=control]]:px-1.5 sm:[&_button[data-slot=control]]:px-2.5 [&_button[data-slot=control]]:text-[10px] sm:[&_button[data-slot=control]]:text-sm">
              <div data-test="portal-composer-agent" className="flex-1 min-w-0 sm:flex-none sm:shrink-0 sm:w-fit [&>*]:!w-full sm:[&>*]:!w-auto">
                <AgentSelect sessionId={sessionId} />
              </div>
              <div data-test="portal-composer-model" className="flex-1 min-w-0 sm:flex-none sm:shrink sm:w-fit [&>*]:!w-full sm:[&>*]:!w-auto">
                <ModelOverrideControl
                  isOverriding={isOverridingDefault()}
                  sessionId={sessionId}
                  instanceId={instanceId}
                />
              </div>
              <div data-test="portal-composer-effort" className="shrink-0 w-fit [&>*]:!w-auto">
                <ThinkingSelect sessionId={sessionId} />
              </div>
              <div data-test="portal-composer-todostrip" className="sm:ml-auto shrink-0">
                <TodoStrip snapshot={todoSnapshot} />
              </div>
              <AutoApproveToggle sessionId={sessionId} />
              <button
                type="button"
                onClick={() => fileAttachInputRef.current?.click()}
                data-test="portal-composer-attach-photo"
                className="md:hidden shrink-0 rounded-md p-0.5 sm:p-1.5 text-muted-fg hover:bg-muted hover:text-fg transition-colors"
                title="Attach photo"
                aria-label="Attach photo"
              >
                <PhotoIcon className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => anyFileAttachInputRef.current?.click()}
                data-test="portal-composer-attach-any"
                className="shrink-0 rounded-md p-0.5 sm:p-1.5 text-muted-fg hover:bg-muted hover:text-fg transition-colors"
                title="Attach any file"
                aria-label="Attach any file"
              >
                <PaperClipIcon className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const value = textareaRef.current?.value;
                  if (sessionId && typeof value === "string") {
                    if (draftSaveTimerRef.current != null) {
                      window.clearTimeout(draftSaveTimerRef.current);
                      draftSaveTimerRef.current = null;
                    }
                    writeDraft(sessionId, value);
                  }
                  setComposerCollapsed(true);
                }}
                data-test="portal-composer-collapse"
                className="shrink-0 rounded-md p-0.5 sm:p-1.5 text-muted-fg hover:bg-muted hover:text-fg transition-colors"
                aria-label="Hide composer"
                title="Hide composer"
              >
                <ChevronDownIcon className="size-4" />
              </button>
            </div>
            <div className="px-1 pt-0.5 pb-0.5 relative flex-1 min-h-0 flex flex-col">
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
            <SlashCommandPopover
              isOpen={slashCommand.isOpen}
              searchQuery={slashCommand.searchQuery}
              mode={slashCommand.mode}
              customItems={
                slashCommand.mode === "command" ? undefined : slashItems
              }
              textareaRef={textareaRef}
              slashStart={slashCommand.slashStart}
              selectedIndex={slashCommand.selectedIndex}
              onSelectedIndexChange={slashCommand.setSelectedIndex}
              onClose={slashCommand.close}
              onSelect={(commandName) => {
                const current = textareaRef.current?.value ?? "";
                const newValue = slashCommand.handleSelect(
                  commandName,
                  current,
                );
                if (textareaRef.current) {
                  textareaRef.current.value = newValue;
                  setHasContent(newValue.length > 0);
                  textareaRef.current.focus();
                  const cursorPos = newValue.length;
                  textareaRef.current.setSelectionRange(cursorPos, cursorPos);
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
              <input
                ref={anyFileAttachInputRef}
                type="file"
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
                  {pendingAttachments.map((a, i) => {
                    const isImage = (a.mime ?? "").startsWith("image/");
                    return (
                      <div
                        key={`${a.filename ?? "attachment"}-${i}`}
                        className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const url = a.url ?? "";
                            if (!url.startsWith("data:")) return;
                            try {
                              const blob = dataUrlToBlob(url);
                              const objUrl = URL.createObjectURL(blob);
                              window.open(
                                objUrl,
                                "_blank",
                                "noopener,noreferrer",
                              );
                              window.setTimeout(
                                () => URL.revokeObjectURL(objUrl),
                                60_000,
                              );
                            } catch {
                              /* ignore - clicking the chip is a polish
                                 feature, drag/drop preview already proves
                                 the attachment is staged */
                            }
                          }}
                          title={a.filename ?? "Preview attachment"}
                          aria-label={a.filename ?? "Preview attachment"}
                          className="block h-full w-full"
                        >
                          {isImage ? (
                            <img
                              src={a.url}
                              alt={a.filename ?? `Attachment ${i + 1}`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-muted-fg">
                              <DocumentIcon className="size-5 shrink-0" />
                              <span className="w-full truncate text-[9px] leading-tight">
                                {a.filename ?? "file"}
                              </span>
                            </div>
                          )}
                        </button>
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
                    );
                  })}
                </div>
              )}
              <div className="flex items-stretch gap-2 flex-1 min-h-0">
                <div className="min-w-0 flex-1 flex flex-col">
                  <Textarea
                    ref={textareaRef}
                    data-test="portal-composer-textarea"
                    inputMode="text"
                    autoCapitalize="sentences"
                    autoCorrect="on"
                    onPaste={(e) => {
                      const items = e.clipboardData?.items;
                      if (!items) return;
                      const images: File[] = [];
                      for (const item of items) {
                        if (item.kind !== "file") continue;
                        if (!item.type.startsWith("image/")) continue;
                        const file = item.getAsFile();
                        if (file) images.push(file);
                      }
                      if (images.length === 0) return;
                      e.preventDefault();
                      handleAttachFiles(images);
                    }}
                    onChange={(e) => {
                      const value = e.target.value;
                      const ne = value.length > 0;
                      if (ne !== hasContent) setHasContent(ne);
                      scheduleDraftSave(value);
                      if (sttTimeoutProgress !== null) {
                        cancelSttTimeout();
                        if (speechRecognition.isListening) {
                          speechRecognition.stop();
                        }
                      }
                      const cursorPos =
                        e.target.selectionStart ?? value.length;
                      if (fileMention.isOpen || value.includes("@")) {
                        fileMention.handleInputChange(value, cursorPos);
                      }
                      if (slashCommand.isOpen || value.startsWith("/")) {
                        slashCommand.handleInputChange(value, cursorPos);
                      }
                    }}
                    onBlur={(e) => {
                      if (!sessionId) return;
                      if (draftSaveTimerRef.current != null) {
                        window.clearTimeout(draftSaveTimerRef.current);
                        draftSaveTimerRef.current = null;
                      }
                      if (persistShortIfNoPrior(e.target.value)) {
                        writeDraft(sessionId, e.target.value);
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
                      const slashHandled = slashCommand.handleKeyDown(
                        e,
                        filteredCommands.length,
                      );
                      if (slashHandled) {
                        if (
                          (e.key === "Enter" || e.key === "Tab") &&
                          filteredCommands.length > 0
                        ) {
                          const selectedCmd =
                            filteredCommands[slashCommand.selectedIndex];
                          if (selectedCmd) {
                            const current =
                              textareaRef.current?.value ?? "";
                            const newValue = slashCommand.handleSelect(
                              selectedCmd.name,
                              current,
                            );
                            if (textareaRef.current) {
                              textareaRef.current.value = newValue;
                              setHasContent(newValue.length > 0);
                              const cursorPos = newValue.length;
                              textareaRef.current.setSelectionRange(
                                cursorPos,
                                cursorPos,
                              );
                            }
                          }
                        }
                        return;
                      }
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
                        //   Shift+Enter ALWAYS inserts a newline.
                        //   Ctrl/Cmd+Enter ALWAYS submits, regardless of
                        //     viewport - this covers desktop browsers that
                        //     transiently match (max-width:640px) when a
                        //     devtools panel is docked.
                        //   Bare Enter submits only on non-mobile viewports
                        //     when enterKeyAction='submit'. On mobile the
                        //     soft keyboard's Enter is reserved for newlines.
                        if (e.shiftKey) return;
                        const isModified = e.metaKey || e.ctrlKey;
                        const wantsSubmit =
                          isModified ||
                          (!isMobile && enterKeyAction === "submit");
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
                    className="resize-none overflow-y-auto text-sm min-h-[max(4.5rem,100%)]"
                  />
                </div>
                <div className="flex flex-col justify-end gap-1.5 shrink-0">
                  {(sttMode !== "off" && speechRecognition.isSupported) ||
                  isAssistantBusy ? (
                    <div className="flex w-12 gap-0 justify-end">
                      {sttMode !== "off" && speechRecognition.isSupported && (
                        <button
                          type="button"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            handleMicToggle();
                          }}
                          className={`relative size-6 rounded-md inline-flex items-center justify-center transition-colors ${
                            speechRecognition.isListening
                              ? "bg-red-500 text-white"
                              : "bg-muted hover:bg-muted/80 text-muted-fg"
                          } ${speechRecognition.isListening && sttTimeoutProgress === null ? "animate-pulse" : ""}`}
                          aria-label={
                            speechRecognition.isListening
                              ? "Stop voice input"
                              : "Start voice input"
                          }
                          title={
                            sttMode === "push-to-talk"
                              ? speechRecognition.isListening
                                ? "Tap to stop and submit"
                                : "Tap to start; tap again to stop and submit"
                              : speechRecognition.isListening
                                ? "Tap to stop listening"
                                : "Tap to start continuous listening"
                          }
                        >
                          {sttTimeoutProgress !== null && (
                            <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 24 24">
                              <circle
                                cx="12"
                                cy="12"
                                r="10"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeDasharray="62.83"
                                strokeDashoffset={62.83 - (62.83 * sttTimeoutProgress) / 100}
                                className="text-white/50 transition-all duration-75"
                              />
                            </svg>
                          )}
                          <MicrophoneIcon className="size-3" />
                        </button>
                      )}
                      {isAssistantBusy && (
                        <button
                          type="button"
                          onClick={() => void handleAbort()}
                          className="size-6 rounded-md inline-flex items-center justify-center bg-red-500 hover:bg-red-600 text-white transition-colors"
                          aria-label="Stop the current run"
                        >
                          <StopIcon className="size-3" />
                        </button>
                      )}
                    </div>
                  ) : null}
                  <Button
                    type="submit"
                    data-test="portal-composer-submit"
                    isDisabled={
                      !hasContent && pendingAttachments.length === 0
                    }
                    className={`size-12 !p-0 ${
                      sttCountdownDigit !== null ? "animate-pulse" : ""
                    }`}
                    aria-label={
                      sttCountdownDigit !== null
                        ? sttAutoSubmitOnEnd
                          ? `Auto-submit in ${sttCountdownDigit}`
                          : `Voice grace ${sttCountdownDigit}`
                        : isAssistantBusy
                          ? "Queue message"
                          : "Send"
                    }
                  >
                    {sttCountdownDigit !== null ? (
                      <span
                        className="text-2xl font-bold tabular-nums"
                        data-test="portal-composer-stt-countdown"
                      >
                        {sttCountdownDigit}
                      </span>
                    ) : (
                      <PlayIcon className="size-6" />
                    )}
                  </Button>
                </div>
              </div>
            </form>
            </div>
          </>
        </div>
      )}
    </div>
  );
}
