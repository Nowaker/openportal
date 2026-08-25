import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { z } from "zod/v4";
import { useVirtualSessionStore } from "@/stores/virtual-session-store";
import { useInstanceStore } from "@/stores/instance-store";
import { useComposerMaxHeight } from "@/hooks/use-composer-max-height";
import useMediaQuery from "@/hooks/use-media-query";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { useNewSessionTemplates } from "@/hooks/use-new-session-templates";
import {
  clearVirtualSessionIfAbandoned,
  useNewSessionDraft,
} from "@/hooks/use-new-session-draft";
import { useNewSessionAttachments } from "@/components/new-session-attachments";
import { useNewSessionCommands } from "@/hooks/use-new-session-commands";
import { useNewSessionSubmit } from "@/hooks/use-new-session-submit";
import { useNewSessionStt } from "@/hooks/use-new-session-stt";
import { NewSessionInitTemplatePicker } from "@/components/new-session-init-template-picker";
import { NewSessionComposer } from "@/components/new-session-composer";

const searchSchema = z.object({
  directory: z.string().optional(),
  autoPrompt: z.string().optional(),
});

export const Route = createFileRoute("/_app/session/new")({
  component: NewSessionPage,
  validateSearch: searchSchema,
});

function NewSessionPage() {
  const { directory: directoryFromUrl, autoPrompt } = Route.useSearch();
  const storeDir = useVirtualSessionStore((s) => s.directory);
  const setStoreDir = useVirtualSessionStore((s) => s.setDirectory);
  const clearStore = useVirtualSessionStore((s) => s.clear);
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const composerMaxHeight = useComposerMaxHeight();
  const { isMobile } = useMediaQuery();

  const directory = directoryFromUrl || storeDir || null;

  useEffect(() => {
    if (directoryFromUrl && directoryFromUrl !== storeDir) {
      setStoreDir(directoryFromUrl);
    }
  }, [directoryFromUrl, storeDir, setStoreDir]);

  const templates = useNewSessionTemplates(directory);
  const draft = useNewSessionDraft(directory, autoPrompt, isMobile);

  useEffect(() => {
    return () => {
      clearVirtualSessionIfAbandoned(draft.submittedRef, clearStore);
    };
  }, [clearStore]);

  const attachments = useNewSessionAttachments();
  const commands = useNewSessionCommands({
    textareaRef: draft.textareaRef,
    setText: draft.setText,
    scheduleDraftSave: draft.scheduleDraftSave,
    templateSlashEntries: templates.templateSlashEntries,
    slashExtras: templates.slashExtras,
  });
  const submit = useNewSessionSubmit({
    directory,
    text: draft.text,
    order: templates.order,
    selected: templates.selected,
    edits: templates.edits,
    pendingAttachments: attachments.pendingAttachments,
    commandsData: commands.commandsData,
    setPendingAttachments: attachments.setPendingAttachments,
    submittedRef: draft.submittedRef,
    draftSaveTimerRef: draft.draftSaveTimerRef,
    draftKey: draft.draftKey,
    templatesReady: templates.isReady,
  });
  const stt = useNewSessionStt({
    textareaRef: draft.textareaRef,
    setText: draft.setText,
    scheduleDraftSave: draft.scheduleDraftSave,
    hasUserEditedRef: draft.hasUserEditedRef,
    handleSubmit: submit.handleSubmit,
  });

  const autoSubmittedRef = useRef(false);

  useEffect(() => {
    if (autoSubmittedRef.current) return;
    if (!autoPrompt) return;
    if (!directory) return;
    if (!port) return;
    if (!templates.isReady) return;
    autoSubmittedRef.current = true;
    void submit.handleSubmit(autoPrompt);
  }, [autoPrompt, directory, port, submit.handleSubmit, templates.isReady]);

  if (!directory) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center text-muted-fg">
        No directory chosen. Use Open directory in the sidebar.
      </div>
    );
  }

  const showTemplatePicker =
    !autoPrompt && templates.isReady && templates.order.length > 0 && !submit.sending;
  const hasContent = draft.text.trim().length > 0;

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

        {submit.sending && (
          <div className="w-full max-w-2xl rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3 shrink-0">
            <div className="flex items-center gap-3">
              <Loader className="size-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-fg">
                  {submit.sendingStatus || "Starting session..."}
                </p>
                <p className="text-xs text-muted-fg mt-0.5">
                  Hang tight - OpenCode is processing this server-side. The chat
                  view will open as soon as the session is ready.
                </p>
              </div>
            </div>
            {hasContent && (
              <div className="rounded border border-border bg-bg/60 p-2 text-xs text-muted-fg max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
                {draft.text.trim()}
              </div>
            )}
          </div>
        )}

        {!autoPrompt && templates.isLoading && !submit.sending && (
          <div className="flex w-full max-w-2xl items-center justify-center gap-2 rounded-lg border border-border bg-bg/60 p-4 text-sm text-muted-fg">
            <Loader className="size-5" />
            Loading init templates...
          </div>
        )}

        {!autoPrompt && templates.error && !submit.sending && (
          <div
            role="alert"
            className="flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-lg border border-danger-subtle-fg/30 bg-danger-subtle p-3 text-sm text-danger-subtle-fg"
          >
            <span className="min-w-0 flex-1">
              Init templates could not be loaded. Retry before starting the session.
            </span>
            <Button
              size="xs"
              intent="outline"
              onPress={() => void templates.reload()}
            >
              Retry
            </Button>
          </div>
        )}

        {showTemplatePicker && (
          <NewSessionInitTemplatePicker controller={templates} />
        )}
      </div>

      <NewSessionComposer
        composerMaxHeight={composerMaxHeight}
        text={draft.text}
        setText={draft.setText}
        textareaRef={draft.textareaRef}
        hasUserEditedRef={draft.hasUserEditedRef}
        scheduleDraftSave={draft.scheduleDraftSave}
        sending={submit.sending}
        submissionDisabled={!templates.isReady}
        hasContent={hasContent}
        error={submit.error}
        commands={commands}
        stt={stt}
        attachments={attachments}
        handleSubmit={submit.handleSubmit}
      />
    </div>
  );
}
