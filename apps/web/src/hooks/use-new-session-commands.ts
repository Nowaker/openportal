import { useMemo, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useFileMention } from "@/components/file-mention-popover";
import {
  useCommands,
  useSlashCommand,
  type SlashItem,
} from "@/components/slash-command-popover";
import { insertSlashTemplate } from "@/lib/prompt-template-format";
import type { TemplateSlashEntry } from "@/hooks/use-new-session-templates";

export interface NewSessionCommandsController {
  readonly fileMention: ReturnType<typeof useFileMention>;
  readonly slashCommand: ReturnType<typeof useSlashCommand>;
  readonly commandsData:
    | readonly { name: string; description?: string }[]
    | undefined;
  readonly fileResults: readonly string[];
  readonly setFileResults: Dispatch<SetStateAction<string[]>>;
  readonly filteredCommands: readonly SlashItem[];
  readonly slashExtras: SlashItem[];
  readonly applySlashSelect: (commandName: string) => void;
}

export function useNewSessionCommands({
  textareaRef,
  setText,
  scheduleDraftSave,
  templateSlashEntries,
  slashExtras,
}: {
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly scheduleDraftSave: (value: string) => void;
  readonly templateSlashEntries: readonly TemplateSlashEntry[];
  readonly slashExtras: readonly SlashItem[];
}): NewSessionCommandsController {
  const fileMention = useFileMention();
  const slashCommand = useSlashCommand();
  const { data: commandsData } = useCommands();
  const [fileResults, setFileResults] = useState<string[]>([]);
  const popoverSlashExtras = useMemo(() => [...slashExtras], [slashExtras]);

  const filteredCommands = useMemo(() => {
    const lc = slashCommand.searchQuery.toLowerCase();
    const all: SlashItem[] = [...(commandsData ?? []), ...slashExtras];
    return all.filter((c) => c.name.toLowerCase().startsWith(lc));
  }, [commandsData, slashExtras, slashCommand.searchQuery]);

  // Shared by click + Enter/Tab: templates inline via the same preamble format as the checkbox picker above.
  const applySlashSelect = (commandName: string) => {
    const current = textareaRef.current?.value ?? "";
    const template = templateSlashEntries.find((t) => t.name === commandName);
    if (template && slashCommand.slashStart !== null) {
      const slashStart = slashCommand.slashStart;
      const firstNewline = current.indexOf("\n", slashStart);
      const endOfCommand = firstNewline === -1 ? current.length : firstNewline;
      const tokenLen = endOfCommand - slashStart;
      const { newValue, cursorPos } = insertSlashTemplate(
        current,
        slashStart,
        tokenLen,
        { name: template.name.replace(/^template /, ""), body: template.body },
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
    const newValue = slashCommand.handleSelect(commandName, current);
    if (textareaRef.current) {
      textareaRef.current.value = newValue;
      setText(newValue);
      scheduleDraftSave(newValue);
      textareaRef.current.focus();
      const cursorPos = newValue.length;
      textareaRef.current.setSelectionRange(cursorPos, cursorPos);
    }
  };

  return {
    fileMention,
    slashCommand,
    commandsData,
    fileResults,
    setFileResults,
    filteredCommands,
    slashExtras: popoverSlashExtras,
    applySlashSelect,
  };
}
