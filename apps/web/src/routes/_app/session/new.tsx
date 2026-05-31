import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod/v4";
import { useInstanceStore } from "@/stores/instance-store";
import { useVirtualSessionStore } from "@/stores/virtual-session-store";
import { useCreateSession } from "@/hooks/use-opencode";
import { useComposerStore } from "@/stores/composer-store";
import { useSttModeStore } from "@/stores/stt-mode-store";
import { useSttEngine } from "@/hooks/use-stt-engine";
import { useComposerMaxHeight } from "@/hooks/use-composer-max-height";
import useMediaQuery from "@/hooks/use-media-query";
import { toast } from "@/components/ui/toast";
import { Loader } from "@/components/ui/loader";
import { AgentSelect } from "@/components/agent-select";
import { useAgentStore } from "@/stores/agent-store";
import { ModelSelect } from "@/components/model-select";
import { useModelStore } from "@/stores/model-store";
import { ThinkingSelect } from "@/components/thinking-select";
import { useThinkingStore } from "@/stores/thinking-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  FileMentionPopover,
  useFileMention,
} from "@/components/file-mention-popover";
import {
  SlashCommandPopover,
  useSlashCommand,
  useCommands,
  expandTemplateAtSlash,
} from "@/components/slash-command-popover";
import { useSWRConfig } from "swr";
import { mutate as mutateSWR } from "swr";
import {
  Bars3Icon,
  PhotoIcon,
  PaperClipIcon,
  PlayIcon,
  MicrophoneIcon,
  DocumentIcon,
  StopIcon,
} from "@heroicons/react/24/outline";
import { useFsTemplatesForDirectory } from "@/hooks/use-vibekick-templates";
import {
  resolveToolsFromState,
  useToolsStore,
  type ResolvedTool,
} from "@/stores/tools-store";
import {
  clearPendingSubmission,
  recordFailedAttempt,
  recordPendingSubmission,
} from "@/lib/pending-prompts";
import {
  DRAFT_MIN_BYTES,
  newSessionDraftKey,
  readDraft,
  writeDraft,
} from "@/lib/session-indicators";

interface PromptAttachment {
  mime: string;
  filename?: string;
  url: string;
}

const searchSchema = z.object({
  directory: z.string().optional(),
  autoPrompt: z.string().optional(),
});

const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const Route = createFileRoute("/_app/session/new")({
  component: NewSessionPage,
  validateSearch: searchSchema,
});

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",", 2);
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// Picker item shape that fits both ResolvedTool (stock + custom from
// the local tools-store) and FsTemplate (filesystem-backed) without
// inheriting all their other fields. The picker only needs id (for
// the checkbox identity + drag drop), name (for display), and prompt
// (for the on-submit prepend). Anything else stays on the source.
interface InitPickerItem {
  id: string;
  name: string;
  prompt: string;
}

function NewSessionPage() {
  const navigate = useNavigate();
  const { directory: directoryFromUrl, autoPrompt } = Route.useSearch();
  const storeDir = useVirtualSessionStore((s) => s.directory);
  const setStoreDir = useVirtualSessionStore((s) => s.setDirectory);
  const clearStore = useVirtualSessionStore((s) => s.clear);
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const createSession = useCreateSession();
  const instanceId = useInstanceStore((s) => s.instance?.id ?? null);
  const resolveDefaultAgent = useAgentStore((s) => s.resolveDefaultAgent);
  const resolveModel = useModelStore((s) => s.resolveModel);
  const isOverridingDefault = useModelStore((s) => s.isOverridingDefault);
  const resolveThinking = useThinkingStore((s) => s.resolve);
  const { mutate: globalMutate } = useSWRConfig();
  const composerMaxHeight = useComposerMaxHeight();

  const directory = directoryFromUrl || storeDir || null;

  useEffect(() => {
    if (directoryFromUrl && directoryFromUrl !== storeDir) {
      setStoreDir(directoryFromUrl);
    }
  }, [directoryFromUrl, storeDir, setStoreDir]);

  const disabledIds = useToolsStore((s) => s.disabledIds);
  const burgerHiddenIds = useToolsStore((s) => s.burgerHiddenIds);
  const systemOverrides = useToolsStore((s) => s.systemOverrides);
  const customTools = useToolsStore((s) => s.customTools);
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const slashCommandIds = useToolsStore((s) => s.slashCommandIds);

  const tools = useMemo(
    () =>
      resolveToolsFromState({
        disabledIds,
        burgerHiddenIds,
        systemOverrides,
        customTools,
        projectInitOrder,
        slashCommandIds,
      }),
    [
      disabledIds,
      burgerHiddenIds,
      systemOverrides,
      customTools,
      projectInitOrder,
      slashCommandIds,
    ],
  );

  // FS templates load early so the `initialOrder` memo below can read
  // them without a TDZ violation. The directory-scoped vibekick hook
  // is dormant until `directory` resolves (URL or store), at which
  // point it fetches the upward-walk effective stack from the API.
  //
  // The empty-array fallback MUST go through useMemo - returning a
  // fresh `[]` on every render would invalidate every downstream
  // useMemo that lists fsTemplates in its deps, which re-runs the
  // useState initializers below, which trips React error #185
  // (max update depth). Same trap the tools-store / resolveTools
  // wrapper has a comment about.
  const { data: fsTemplatesResp } = useFsTemplatesForDirectory(directory);
  const fsTemplates = useMemo(
    () => fsTemplatesResp?.templates ?? [],
    [fsTemplatesResp],
  );

  // The picker shows ALL non-disabled templates. The Init flag controls
  // the default-checked state + ordering; non-Init templates still
  // appear (unchecked) so the user can opt them in for this session.
  // Per the user spec (AI_TODO #126):
  //   "init" means it's default on on session new screen. all other
  //   non-disabled templates are to be shown.
  // Three sources merge into one list:
  //   - stock + custom tools from the local tools-store
  //     (filtered by !isDisabled - the master kill switch)
  //   - filesystem templates from the directory-scoped
  //     vibekick-templates API (FS has no "fully disabled" state;
  //     delete the file to remove it, so all FS templates appear)
  // Ordering: init-marked rows first (in projectInitOrder for
  // stock/custom, YAML order for FS), then non-init alphabetically.
  // Drag-reorder in this picker only persists for stock/custom in
  // projectInitOrder; FS reorder happens via Settings -> filesystem
  // YAML order field.
  const initialOrder = useMemo<InitPickerItem[]>(() => {
    const local = tools.filter((t) => !t.isDisabled);
    const initSet = new Set(projectInitOrder);
    const localInit: InitPickerItem[] = projectInitOrder
      .map((id) => local.find((t) => t.id === id))
      .filter((t): t is ResolvedTool => Boolean(t))
      .map((t) => ({ id: t.id, name: t.name, prompt: t.prompt }));
    const localOther: InitPickerItem[] = local
      .filter((t) => !initSet.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ id: t.id, name: t.name, prompt: t.prompt }));
    const fsInit: InitPickerItem[] = fsTemplates
      .filter((t) => t.init)
      .sort(
        (a, b) => a.order - b.order || a.scope.localeCompare(b.scope),
      )
      .map((t) => ({ id: t.id, name: t.name, prompt: t.prompt }));
    const fsOther: InitPickerItem[] = fsTemplates
      .filter((t) => !t.init)
      .sort(
        (a, b) => a.order - b.order || a.scope.localeCompare(b.scope),
      )
      .map((t) => ({ id: t.id, name: t.name, prompt: t.prompt }));
    return [...localInit, ...fsInit, ...localOther, ...fsOther];
  }, [tools, projectInitOrder, fsTemplates]);

  // Default-checked set on first paint: only the init-marked templates
  // get pre-selected. Non-init rows are visible but unchecked.
  const [order, setOrder] = useState<InitPickerItem[]>(initialOrder);
  const [selected, setSelected] = useState<Set<string>>(() => {
    const initIds = new Set<string>(projectInitOrder);
    for (const t of fsTemplates) {
      if (t.init) initIds.add(t.id);
    }
    return initIds;
  });
  const dragSourceIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    setOrder(initialOrder);
  }, [initialOrder]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDrop = (targetId: string) => {
    const sourceId = dragSourceIdRef.current;
    dragSourceIdRef.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    setOrder((prev) => {
      const next = prev.slice();
      const from = next.findIndex((t) => t.id === sourceId);
      const to = next.findIndex((t) => t.id === targetId);
      if (from === -1 || to === -1) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const draftKey = directory ? newSessionDraftKey(directory) : null;

  // Init templates do NOT prefill the textarea any more - they are
  // prepended on submit as "/template Name" lines and expanded server-
  // side. Only refire-from-history (autoPrompt) or a previous draft
  // ever populates the textarea on mount.
  const [text, setText] = useState(() => {
    if (autoPrompt) return autoPrompt;
    if (draftKey) {
      const d = readDraft(draftKey);
      if (d) return d;
    }
    return "";
  });
  const [sending, setSending] = useState(false);
  const [sendingStatus, setSendingStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittedRef = useRef(false);
  const autoSubmittedRef = useRef(false);
  const hasUserEditedRef = useRef(
    Boolean(!autoPrompt && draftKey && readDraft(draftKey)),
  );
  const draftSaveTimerRef = useRef<number | null>(null);

  const [pendingAttachments, setPendingAttachments] = useState<
    PromptAttachment[]
  >([]);

  const fileMention = useFileMention();
  const slashCommand = useSlashCommand();
  const { data: commandsData } = useCommands();
  const [, setFileResults] = useState<{ path: string; name: string }[]>([]);
  // Template-slash entries injected alongside opencode commands. Each
  // carries its body so the onSelect handler can expand the matching
  // /template <name> token into the template body with \n\n padding,
  // per the slash-checkbox spec. The entry's `name` field is shaped
  // "template <full-name>" so the popover renders it as
  // "/template Full name here" verbatim from the user's spec.
  // Stock + custom tools come from the local tools-store; filesystem
  // templates come from the directory-scoped vibekick-templates API
  // and carry their slash flag in YAML frontmatter.
  const templateSlashEntries = useMemo(() => {
    // Slash filter: !isDisabled (the master kill switch), NOT enabled.
    // A template with Burger unchecked but Slash checked MUST appear in
    // the popover - Burger only controls topbar visibility.
    // For FS templates we don't have a master-disable state (delete the
    // file instead), so they pass through if their YAML slash flag is on.
    const local = tools
      .filter((t) => !t.isDisabled && t.isSlash)
      .map((t) => ({
        name: `template ${t.name}`,
        body: t.prompt,
      }));
    const fs = fsTemplates
      .filter((t) => t.slash)
      .map((t) => ({
        name: `template ${t.name}`,
        body: t.prompt,
      }));
    return [...local, ...fs];
  }, [tools, fsTemplates]);
  // Synthetic /btw + every slash-marked template. Parity with the
  // chat composer ($id.tsx) so /btw and templates work BEFORE the
  // session exists too. Passed to the popover as extraItems.
  const slashExtras = useMemo(() => {
    return [
      {
        name: "btw",
        description:
          "Side question - one short answer, no tools. Claude-Code parity.",
        source: "builtin" as const,
      },
      ...templateSlashEntries.map((t) => ({
        name: t.name,
        source: "template" as const,
      })),
    ];
  }, [templateSlashEntries]);
  const filteredCommands = useMemo(() => {
    const lc = slashCommand.searchQuery.toLowerCase();
    return [...(commandsData ?? []), ...slashExtras].filter((c) =>
      c.name.toLowerCase().startsWith(lc),
    );
  }, [commandsData, slashExtras, slashCommand.searchQuery]);
  const fileAttachInputRef = useRef<HTMLInputElement>(null);
  const anyFileAttachInputRef = useRef<HTMLInputElement>(null);

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
    const valid = reads.filter((a): a is PromptAttachment => a !== null);
    if (valid.length === 0) return;
    setPendingAttachments((prev) => [...prev, ...valid]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

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

  // No-op cleanup: prior implementation re-synced text to
  // composedAutoPrompt whenever the init-checkbox selection changed.
  // That auto-prefill is gone (templates prepend on submit, not on
  // check). Kept this comment so a future refactor doesn't reintroduce
  // the effect chain.

  // When the user navigates from /session/new?directory=A to ?directory=B
  // (sidebar + on a different project) the component stays mounted and
  // draftKey switches. Load B's draft into the composer; useLayoutEffect
  // (not useEffect) so the swap happens before paint without a flash of
  // A's text. Synchronous restore on initial mount already happened in
  // the useState initializer; this effect handles the in-mount change.
  useLayoutEffect(() => {
    if (autoPrompt) return;
    if (!draftKey) return;
    const d = readDraft(draftKey);
    if (d) {
      setText(d);
      hasUserEditedRef.current = true;
    }
  }, [draftKey, autoPrompt]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (!submittedRef.current) {
        clearStore();
      }
    };
  }, [clearStore]);

  const handleSubmit = useCallback(
    async (override?: string) => {
      if (sending) return;
      if (!directory) {
        setError("No directory selected.");
        return;
      }
      const userMessage = (override ?? text).trim();
      // Pick up checked init templates IN their drag-order. They are
      // NOT in the textarea (auto-prefill is gone since Phase F) - we
      // prepend them on submit. Two strings come out:
      //   - archiveText: "/template Foo\n/template Bar\n\nUser text"
      //     - readable history, refire-able, matches search "Foo"
      //   - opencodeText: "<Foo body>\n\n<Bar body>\n\nUser text"
      //     - what opencode actually executes
      // Without any checked templates, both equal userMessage.
      const checkedTemplates = order.filter((t) => selected.has(t.id));
      const archivePrefix =
        checkedTemplates.length > 0
          ? checkedTemplates
              .map((t) => `/template ${t.name}`)
              .join("\n") + "\n\n"
          : "";
      const opencodePrefix =
        checkedTemplates.length > 0
          ? checkedTemplates.map((t) => t.prompt).join("\n\n") + "\n\n"
          : "";
      const archiveText = archivePrefix + userMessage;
      const opencodeText = opencodePrefix + userMessage;
      if (!archiveText && pendingAttachments.length === 0) return;
      if (!port) {
        setError("Portal not bound to OpenCode.");
        return;
      }

      setSending(true);
      setError(null);
      setSendingStatus("Asking OpenCode to create a new session...");

      try {
        const session = await createSession({ directory });
        const sessionId = session.id;
        setSendingStatus("Session created. Sending your prompt to OpenCode...");

        const pickedAgent = resolveDefaultAgent(instanceId);
        const pickedThinking = resolveThinking(null);
        const overridingModel = isOverridingDefault(null, instanceId);
        const pickedModel = overridingModel
          ? resolveModel(null, instanceId)
          : null;

        // Slash-command detection runs on the user's raw input only -
        // init templates are NOT an opencode command and must not
        // route through /command. archive prefix is applied regardless.
        // Mirrors the chat composer dedup rule that archived text and
        // opencode's emitted user message should NOT diverge except for
        // template expansion.
        let slashDispatch: { command: string; arguments: string } | null = null;
        if (checkedTemplates.length === 0 && userMessage.startsWith("/")) {
          const m = userMessage.match(/^\/(\S+)\s*([\s\S]*)$/);
          if (m) {
            const name = m[1];
            const argsTail = m[2];
            const known = (commandsData ?? []).some((c) => c.name === name);
            if (known) {
              slashDispatch = { command: name, arguments: argsTail };
            }
          }
        }

        // Bulletproof prompt history (Phase 3): localStorage capture
        // BEFORE the fetch for the new-session create flow. We archive
        // the COMPACT form (template lines) so the safety net matches
        // what /prompt's archiveText will land in SQLite.
        const pendingLocalId = recordPendingSubmission({
          sessionId,
          port,
          text: archiveText,
          model: pickedModel ?? undefined,
          agent: pickedAgent ?? undefined,
          variant: pickedThinking ?? undefined,
          attachmentsCount: pendingAttachments.length,
          kind: slashDispatch ? "command" : "prompt",
          commandName: slashDispatch?.command,
          commandArguments: slashDispatch?.arguments,
        });
        let res: Response;
        try {
          res = slashDispatch
            ? await fetch(
                `/api/opencode/${port}/session/${sessionId}/command`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    command: slashDispatch.command,
                    arguments: slashDispatch.arguments,
                    agent: pickedAgent,
                    model:
                      pickedModel != null
                        ? `${pickedModel.providerID}/${pickedModel.modelID}`
                        : undefined,
                    variant: pickedThinking || undefined,
                  }),
                },
              )
            : await fetch(
                `/api/opencode/${port}/session/${sessionId}/prompt`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    text: opencodeText,
                    ...(archiveText !== opencodeText
                      ? { archiveText }
                      : {}),
                    ...(pendingAttachments.length > 0
                      ? { attachments: pendingAttachments }
                      : {}),
                    ...(pickedAgent ? { agent: pickedAgent } : {}),
                    ...(pickedModel ? { model: pickedModel } : {}),
                    ...(pickedThinking ? { thinking: pickedThinking } : {}),
                  }),
                },
              );
        } catch (fetchErr) {
          recordFailedAttempt(
            pendingLocalId,
            fetchErr instanceof Error ? fetchErr.message : "network error",
          );
          throw fetchErr;
        }
        if (!res.ok) {
          const msg = `prompt failed: ${res.status}`;
          recordFailedAttempt(pendingLocalId, msg);
          throw new Error(msg);
        }
        clearPendingSubmission(pendingLocalId);

        setSendingStatus("Prompt accepted. Opening the session...");
        submittedRef.current = true;
        setPendingAttachments([]);
        clearStore();
        if (draftKey) writeDraft(draftKey, "");
        if (draftSaveTimerRef.current != null) {
          window.clearTimeout(draftSaveTimerRef.current);
          draftSaveTimerRef.current = null;
        }
        await globalMutate(`/api/opencode/${port}/sessions`);
        mutateSWR(
          (key) =>
            typeof key === "string" &&
            key.startsWith(`/api/opencode/${port}/session/${sessionId}/messages`),
        );
        navigate({
          to: "/session/$id",
          params: { id: sessionId },
          search: (prev) => prev,
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to start session",
        );
        setSending(false);
        setSendingStatus("");
      }
    },
    [
      sending,
      directory,
      text,
      pendingAttachments,
      port,
      createSession,
      clearStore,
      globalMutate,
      navigate,
      instanceId,
      resolveDefaultAgent,
      commandsData,
      resolveModel,
      resolveThinking,
      isOverridingDefault,
      draftKey,
    ],
  );

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
      setText(next);
      scheduleDraftSave(next);
      setTimeout(() => {
        const ref = textareaRef.current;
        if (!ref) return;
        ref.selectionStart = start + insert.length - sepAfter.length;
        ref.selectionEnd = ref.selectionStart;
        const active = document.activeElement;
        const onComposerSurface =
          active === ref ||
          active === document.body ||
          active === null ||
          active === document.documentElement;
        if (onComposerSurface) {
          ref.focus({ preventScroll: true });
        }
      }, 0);
      hasUserEditedRef.current = true;
    },
    onEnd: () => {
      if (sttMode === "push-to-talk" && sttSubmitOnEndRef.current) {
        sttSubmitOnEndRef.current = false;
        cancelSttTimeout();
        if (sttTranscriptArrivedRef.current && sttAutoSubmitOnEnd) {
          sttTranscriptArrivedRef.current = false;
          void handleSubmit();
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
              void handleSubmit();
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
      sttSubmitOnEndRef.current = sttMode === "push-to-talk";
      cancelSttTimeout();
      void speechRecognition.stop();
      if (sttTranscriptArrivedRef.current && sttAutoSubmitOnEnd) {
        sttTranscriptArrivedRef.current = false;
        void handleSubmit();
      } else {
        sttTranscriptArrivedRef.current = false;
      }
    } else {
      sttSubmitOnEndRef.current = false;
      sttTranscriptArrivedRef.current = false;
      void speechRecognition.start();
    }
  };

  const { isMobile } = useMediaQuery();
  const enterKeyAction = useComposerStore((s) => s.enterKeyAction);

  const persistShortIfNoPrior = useCallback(
    (value: string) => {
      if (!draftKey) return false;
      if (value.length === 0) return false;
      if (value.length >= DRAFT_MIN_BYTES) return true;
      return readDraft(draftKey).length === 0;
    },
    [draftKey],
  );

  const scheduleDraftSave = useCallback(
    (value: string) => {
      if (!draftKey) return;
      if (!persistShortIfNoPrior(value)) return;
      if (!isMobile) {
        writeDraft(draftKey, value);
        return;
      }
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
      }
      draftSaveTimerRef.current = window.setTimeout(() => {
        writeDraft(draftKey, value);
        draftSaveTimerRef.current = null;
      }, 5000);
    },
    [draftKey, persistShortIfNoPrior, isMobile],
  );

  useEffect(() => {
    return () => {
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      if (submittedRef.current) return;
      if (!draftKey) return;
      const value = textareaRef.current?.value ?? "";
      if (persistShortIfNoPrior(value)) {
        writeDraft(draftKey, value);
      }
    };
  }, [draftKey, persistShortIfNoPrior]);

  useEffect(() => {
    if (autoSubmittedRef.current) return;
    if (!autoPrompt) return;
    if (!directory) return;
    if (!port) return;
    autoSubmittedRef.current = true;
    void handleSubmit(autoPrompt);
  }, [autoPrompt, directory, port, handleSubmit]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    if (e.shiftKey) return;
    const isModified = e.metaKey || e.ctrlKey;
    const wantsSubmit =
      isModified || (!isMobile && enterKeyAction === "submit");
    if (!wantsSubmit) return;
    e.preventDefault();
    if (text.trim() || pendingAttachments.length > 0) {
      void handleSubmit();
    }
  };

  if (!directory) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center text-muted-fg">
        No directory chosen. Use Open directory in the sidebar.
      </div>
    );
  }

  const showTemplatePicker = !autoPrompt && order.length > 0 && !sending;
  const hasContent = text.trim().length > 0;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 flex flex-col items-center gap-4">
        <div className="text-center max-w-2xl space-y-1 shrink-0">
          <p className="text-xs uppercase tracking-wide text-muted-fg">
            New session
          </p>
          <h1 className="text-base font-mono break-all">{directory}</h1>
          <p className="text-sm text-muted-fg">
            Type your first message. The session is created when you send.
          </p>
        </div>

        {sending && (
          <div className="w-full max-w-2xl rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3 shrink-0">
            <div className="flex items-center gap-3">
              <Loader className="size-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-fg">
                  {sendingStatus || "Starting session..."}
                </p>
                <p className="text-xs text-muted-fg mt-0.5">
                  Hang tight - OpenCode is processing this server-side. The
                  chat view will open as soon as the session is ready.
                </p>
              </div>
            </div>
            {hasContent && (
              <div className="rounded border border-border bg-bg/60 p-2 text-xs text-muted-fg max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
                {text.trim()}
              </div>
            )}
          </div>
        )}

        {showTemplatePicker && (
          <div className="w-full max-w-2xl rounded-lg border border-border bg-bg/60 p-3 space-y-2 shrink-0">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-fg">
                Init templates
              </h2>
              <p className="text-[11px] text-muted-fg/80">
                Checked = prepended on submit. Drag to reorder.
              </p>
            </div>
            <div className="space-y-1">
              {order.map((tool) => {
                const isDragOver = dragOverId === tool.id;
                const isSelected = selected.has(tool.id);
                return (
                  <div
                    key={tool.id}
                    draggable
                    onDragStart={(e) => {
                      dragSourceIdRef.current = tool.id;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", tool.id);
                    }}
                    onDragOver={(e) => {
                      if (!dragSourceIdRef.current) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragOverId !== tool.id) setDragOverId(tool.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverId === tool.id) setDragOverId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(tool.id);
                    }}
                    onDragEnd={() => {
                      dragSourceIdRef.current = null;
                      setDragOverId(null);
                    }}
                    className={`flex items-center gap-2 rounded-md border border-border bg-bg/60 px-2 py-1.5 text-sm ${
                      isDragOver ? "bg-primary/10 border-primary/40" : ""
                    }`}
                  >
                    <Bars3Icon className="size-4 text-muted-fg shrink-0 cursor-grab active:cursor-grabbing" />
                    <label className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(tool.id)}
                        className="size-4 accent-primary shrink-0"
                      />
                      <span className="truncate">{tool.name}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div
        className="border-t border-border shrink-0 relative flex flex-col overflow-hidden"
        style={{ maxHeight: `${composerMaxHeight}px` }}
      >
        <div className="flex items-center gap-0.5 sm:gap-1 px-1 py-1 text-[10px] sm:text-sm [&_button[data-slot=control]]:py-0.5 sm:[&_button[data-slot=control]]:py-1 [&_button[data-slot=control]]:px-1.5 sm:[&_button[data-slot=control]]:px-2.5 [&_button[data-slot=control]]:text-[10px] sm:[&_button[data-slot=control]]:text-sm">
          <div className="flex-1 min-w-0 sm:flex-none sm:shrink-0 sm:w-fit [&>*]:!w-full sm:[&>*]:!w-auto">
            <AgentSelect sessionId={null} />
          </div>
          <div className="flex-1 min-w-0 sm:flex-none sm:shrink sm:w-fit [&>*]:!w-full sm:[&>*]:!w-auto">
            <ModelSelect />
          </div>
          <div className="shrink-0 w-fit [&>*]:!w-auto">
            <ThinkingSelect sessionId={null} />
          </div>
          <div className="ml-auto" />
          <button
            type="button"
            onClick={() => fileAttachInputRef.current?.click()}
            className="md:hidden shrink-0 rounded-md p-0.5 sm:p-1.5 text-muted-fg hover:bg-muted hover:text-fg transition-colors"
            title="Attach photo"
            aria-label="Attach photo"
          >
            <PhotoIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => anyFileAttachInputRef.current?.click()}
            className="shrink-0 rounded-md p-0.5 sm:p-1.5 text-muted-fg hover:bg-muted hover:text-fg transition-colors"
            title="Attach any file"
            aria-label="Attach any file"
          >
            <PaperClipIcon className="size-4" />
          </button>
        </div>
        <div className="px-1 pt-0.5 pb-0.5 flex-1 min-h-0 flex flex-col">
          <input
            ref={fileAttachInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) {
                void handleAttachFiles(e.target.files);
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
                void handleAttachFiles(e.target.files);
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
                          /* ignore */
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
          {error && (
            <div className="mb-2 text-sm text-danger-subtle-fg bg-danger-subtle px-3 py-2 rounded">
              {error}
            </div>
          )}
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
                setText(newValue);
                scheduleDraftSave(newValue);
              }
            }}
          />
          <SlashCommandPopover
            isOpen={slashCommand.isOpen}
            searchQuery={slashCommand.searchQuery}
            mode={slashCommand.mode}
            extraItems={
              slashCommand.mode === "command" ? slashExtras : undefined
            }
            textareaRef={textareaRef}
            slashStart={slashCommand.slashStart}
            selectedIndex={slashCommand.selectedIndex}
            onSelectedIndexChange={slashCommand.setSelectedIndex}
            onClose={slashCommand.close}
            onSelect={(commandName) => {
              const current = textareaRef.current?.value ?? "";
              const template = templateSlashEntries.find(
                (t) => t.name === commandName,
              );
              if (template && slashCommand.slashStart !== null) {
                const slashStart = slashCommand.slashStart;
                const firstNewline = current.indexOf("\n", slashStart);
                const endOfCommand =
                  firstNewline === -1 ? current.length : firstNewline;
                const tokenLen = endOfCommand - slashStart;
                const { newValue, cursorPos } = expandTemplateAtSlash(
                  current,
                  slashStart,
                  tokenLen,
                  template.body,
                );
                if (textareaRef.current) {
                  textareaRef.current.value = newValue;
                  setText(newValue);
                  scheduleDraftSave(newValue);
                  textareaRef.current.focus();
                  textareaRef.current.setSelectionRange(cursorPos, cursorPos);
                }
                slashCommand.close();
                return;
              }
              const newValue = slashCommand.handleSelect(
                commandName,
                current,
              );
              if (textareaRef.current) {
                textareaRef.current.value = newValue;
                setText(newValue);
                scheduleDraftSave(newValue);
                textareaRef.current.focus();
                const cursorPos = newValue.length;
                textareaRef.current.setSelectionRange(cursorPos, cursorPos);
              }
            }}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
            className="w-full flex-1 min-h-0 flex flex-col"
          >
            {/* Floating-button composer layout. Submit button (and STT mic)
              * float absolutely at bottom-right of the textarea wrapper, so
              * the button stays visible no matter how tall the textarea
              * content grows. The wrapper itself is bounded by the
              * composer's `style={{ maxHeight: composerMaxHeight }}` cap +
              * the flex-1 min-h-0 cascade through the inner padding and
              * form. See the matching block in `session/$id.tsx` for the
              * full rationale. */}
            <div className="relative min-w-0 flex-1 min-h-0 flex flex-col overflow-hidden">
                <Textarea
                  ref={textareaRef}
                  value={text}
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
                    void handleAttachFiles(images);
                  }}
                  onChange={(e) => {
                    hasUserEditedRef.current = true;
                    const value = e.target.value;
                    setText(value);
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
                  onSelect={(e) => {
                    if (!fileMention.isOpen) return;
                    const target = e.target as HTMLTextAreaElement;
                    const value = target.value;
                    const cursorPos =
                      target.selectionStart ?? value.length;
                    fileMention.handleInputChange(value, cursorPos);
                  }}
                  onKeyDown={(e) => {
                    const slashHandled = slashCommand.handleKeyDown(
                      e,
                      filteredCommands.length,
                    );
                    if (slashHandled) return;
                    const mentionHandled = fileMention.handleKeyDown(e);
                    if (mentionHandled) return;
                    onKeyDown(e);
                  }}
                  placeholder="What do you want to do?"
                  className="resize-none overflow-y-auto text-sm min-h-[120px] pr-20"
                  disabled={sending}
                />
              <div className="pointer-events-none absolute bottom-1.5 right-1.5 flex flex-col items-end gap-1.5">
                {sttMode !== "off" && speechRecognition.isSupported && (
                  <div className="pointer-events-auto flex w-12 gap-0 justify-end">
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
                  </div>
                )}
                <Button
                  type="submit"
                  isDisabled={
                    sending ||
                    (!hasContent && pendingAttachments.length === 0)
                  }
                  className={`pointer-events-auto size-12 !p-0 ${
                    sttCountdownDigit !== null ? "animate-pulse" : ""
                  }`}
                  aria-label={
                    sttCountdownDigit !== null
                      ? sttAutoSubmitOnEnd
                        ? `Auto-submit in ${sttCountdownDigit}`
                        : `Voice grace ${sttCountdownDigit}`
                      : sending
                        ? "Starting…"
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
      </div>
    </div>
  );
}
