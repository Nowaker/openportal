import type { Dispatch, RefObject, SetStateAction } from "react";
import { FileMentionPopover } from "@/components/file-mention-popover";
import { SlashCommandPopover } from "@/components/slash-command-popover";
import { Textarea } from "@/components/ui/textarea";
import { useComposerStore } from "@/stores/composer-store";
import useMediaQuery from "@/hooks/use-media-query";
import type { NewSessionCommandsController } from "@/hooks/use-new-session-commands";
import type { NewSessionSttController } from "@/hooks/use-new-session-stt";
import type { NewSessionAttachmentsController } from "@/components/new-session-attachments";
import { NewSessionComposerActions } from "@/components/new-session-composer-actions";

interface NewSessionComposerFieldProps {
  readonly text: string;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly hasUserEditedRef: RefObject<boolean>;
  readonly scheduleDraftSave: (value: string) => void;
  readonly sending: boolean;
  readonly hasContent: boolean;
  readonly commands: NewSessionCommandsController;
  readonly stt: NewSessionSttController;
  readonly attachments: NewSessionAttachmentsController;
  readonly handleSubmit: (override?: string) => Promise<void>;
}

export function NewSessionComposerField({
  text,
  setText,
  textareaRef,
  hasUserEditedRef,
  scheduleDraftSave,
  sending,
  hasContent,
  commands,
  stt,
  attachments,
  handleSubmit,
}: NewSessionComposerFieldProps) {
  const { isMobile } = useMediaQuery();
  const enterKeyAction = useComposerStore((s) => s.enterKeyAction);
  const {
    fileMention,
    slashCommand,
    filteredCommands,
    fileResults,
    setFileResults,
    slashExtras,
    applySlashSelect,
  } = commands;
  const { speechRecognition, sttTimeoutProgress, cancelSttTimeout } = stt;
  const { handleAttachFiles, pendingAttachments } = attachments;

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

  return (
    <>
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
        extraItems={slashCommand.mode === "command" ? slashExtras : undefined}
        textareaRef={textareaRef}
        slashStart={slashCommand.slashStart}
        selectedIndex={slashCommand.selectedIndex}
        onSelectedIndexChange={slashCommand.setSelectedIndex}
        onClose={slashCommand.close}
        onSelect={applySlashSelect}
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
              const cursorPos = e.target.selectionStart ?? value.length;
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
                  if (selectedCmd) applySlashSelect(selectedCmd.name);
                }
                return;
              }
              const mentionHandled = fileMention.handleKeyDown(
                e,
                fileResults.length,
              );
              if (mentionHandled) return;
              onKeyDown(e);
            }}
            placeholder="What do you want to do?"
            style={{
              paddingLeft: 5,
              paddingTop: 3,
              paddingBottom: 3,
              paddingRight: 46,
            }}
            className="resize-none overflow-y-auto text-sm min-h-[120px] rounded-none border-x-0 border-b-0 focus:border-x focus:border-b focus:ring-0"
            disabled={sending}
          />
          <NewSessionComposerActions
            stt={stt}
            sending={sending}
            hasContent={hasContent}
            pendingAttachmentsCount={pendingAttachments.length}
          />
        </div>
      </form>
    </>
  );
}
