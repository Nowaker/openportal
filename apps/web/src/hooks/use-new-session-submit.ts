import { useCallback, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useNavigate } from "@tanstack/react-router";
import { mutate as mutateSWR, useSWRConfig } from "swr";
import { useInstanceStore } from "@/stores/instance-store";
import { useVirtualSessionStore } from "@/stores/virtual-session-store";
import { useCreateSession } from "@/hooks/use-opencode";
import { useAgentStore } from "@/stores/agent-store";
import { useModelStore } from "@/stores/model-store";
import { useThinkingStore } from "@/stores/thinking-store";
import { buildPromptFromSelection } from "@/lib/prompt-template-format";
import {
  clearPendingSubmission,
  recordFailedAttempt,
  recordPendingSubmission,
} from "@/lib/pending-prompts";
import { writeDraft } from "@/lib/session-indicators";
import type { InitPickerItem } from "@/hooks/use-new-session-templates";
import type { PromptAttachment } from "@/components/new-session-attachments";

export interface NewSessionSubmitController {
  readonly sending: boolean;
  readonly sendingStatus: string;
  readonly error: string | null;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly handleSubmit: (override?: string) => Promise<void>;
}

export function useNewSessionSubmit(input: {
  readonly directory: string | null;
  readonly text: string;
  readonly order: readonly InitPickerItem[];
  readonly selected: ReadonlySet<string>;
  readonly edits: Readonly<Record<string, string>>;
  readonly pendingAttachments: readonly PromptAttachment[];
  readonly commandsData:
    | readonly { name: string; description?: string }[]
    | undefined;
  readonly setPendingAttachments: Dispatch<SetStateAction<PromptAttachment[]>>;
  readonly submittedRef: RefObject<boolean>;
  readonly draftSaveTimerRef: RefObject<number | null>;
  readonly draftKey: string | null;
  readonly templatesReady: boolean;
}): NewSessionSubmitController {
  const {
    directory,
    text,
    order,
    selected,
    edits,
    pendingAttachments,
    commandsData,
    setPendingAttachments,
    submittedRef,
    draftSaveTimerRef,
    draftKey,
    templatesReady,
  } = input;

  const navigate = useNavigate();
  const clearStore = useVirtualSessionStore((s) => s.clear);
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const createSession = useCreateSession();
  const instanceId = useInstanceStore((s) => s.instance?.id ?? null);
  const resolveDefaultAgent = useAgentStore((s) => s.resolveDefaultAgent);
  const resolveModel = useModelStore((s) => s.resolveModel);
  const isOverridingDefault = useModelStore((s) => s.isOverridingDefault);
  const resolveThinking = useThinkingStore((s) => s.resolve);
  const { mutate: globalMutate } = useSWRConfig();

  const [sending, setSending] = useState(false);
  const [sendingStatus, setSendingStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (override?: string) => {
      if (sending) return;
      if (!directory) {
        setError("No directory selected.");
        return;
      }
      if (!templatesReady) {
        setError("Init templates are still loading. Try again when they finish.");
        return;
      }
      const userMessage = (override ?? text).trim();
      const opencodeText = buildPromptFromSelection(
        userMessage,
        order.map((template) => ({
          id: template.id,
          name: template.name,
          body: template.prompt,
        })),
        selected,
        edits,
      );
      const archiveText = opencodeText;
      if (!opencodeText && pendingAttachments.length === 0) return;
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
            : await fetch(`/api/opencode/${port}/session/${sessionId}/prompt`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: opencodeText,
                  ...(archiveText !== opencodeText ? { archiveText } : {}),
                  ...(pendingAttachments.length > 0
                    ? { attachments: pendingAttachments }
                    : {}),
                  ...(pickedAgent ? { agent: pickedAgent } : {}),
                  ...(pickedModel ? { model: pickedModel } : {}),
                  ...(pickedThinking ? { thinking: pickedThinking } : {}),
                }),
              });
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
            key.startsWith(
              `/api/opencode/${port}/session/${sessionId}/messages`,
            ),
        );
        navigate({
          to: "/session/$id",
          params: { id: sessionId },
          search: { server: instanceId ?? undefined },
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
      order,
      selected,
      edits,
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
      templatesReady,
      setPendingAttachments,
      submittedRef,
      draftSaveTimerRef,
    ],
  );

  return { sending, sendingStatus, error, setError, handleSubmit };
}
