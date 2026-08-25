import type { RefObject } from "react";
import { AgentSelect } from "@/components/agent-select";
import { ModelSelect } from "@/components/model-select";
import { ThinkingSelect } from "@/components/thinking-select";
import { PhotoIcon, PaperClipIcon } from "@heroicons/react/24/outline";
import {
  NewSessionAttachmentInputs,
  NewSessionAttachmentList,
  type NewSessionAttachmentsController,
} from "@/components/new-session-attachments";
import { NewSessionComposerField } from "@/components/new-session-composer-field";
import type { NewSessionCommandsController } from "@/hooks/use-new-session-commands";
import type { NewSessionSttController } from "@/hooks/use-new-session-stt";

interface NewSessionComposerProps {
  readonly composerMaxHeight: number;
  readonly text: string;
  readonly setText: React.Dispatch<React.SetStateAction<string>>;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly hasUserEditedRef: RefObject<boolean>;
  readonly scheduleDraftSave: (value: string) => void;
  readonly sending: boolean;
  readonly submissionDisabled: boolean;
  readonly hasContent: boolean;
  readonly error: string | null;
  readonly commands: NewSessionCommandsController;
  readonly stt: NewSessionSttController;
  readonly attachments: NewSessionAttachmentsController;
  readonly handleSubmit: (override?: string) => Promise<void>;
}

export function NewSessionComposer({
  composerMaxHeight,
  text,
  setText,
  textareaRef,
  hasUserEditedRef,
  scheduleDraftSave,
  sending,
  submissionDisabled,
  hasContent,
  error,
  commands,
  stt,
  attachments,
  handleSubmit,
}: NewSessionComposerProps) {
  const { fileAttachInputRef, anyFileAttachInputRef } = attachments;
  return (
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
      <div className="pt-0.5 flex-1 min-h-0 flex flex-col">
        <NewSessionAttachmentInputs controller={attachments} />
        <NewSessionAttachmentList controller={attachments} />
        {error && (
          <div className="mb-2 text-sm text-danger-subtle-fg bg-danger-subtle px-3 py-2 rounded">
            {error}
          </div>
        )}
        <NewSessionComposerField
          text={text}
          setText={setText}
          textareaRef={textareaRef}
          hasUserEditedRef={hasUserEditedRef}
          scheduleDraftSave={scheduleDraftSave}
          sending={sending}
          submissionDisabled={submissionDisabled}
          hasContent={hasContent}
          commands={commands}
          stt={stt}
          attachments={attachments}
          handleSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
