import * as React from "react";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import {
  ArrowsRightLeftIcon,
  FolderIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { DirectoryPicker } from "@/components/directory-picker/directory-picker";

// Section L: Fork dialog with project picker + multi-phase progress.
// Pre-Section-L the Fork button fired immediately with no indication
// anything was happening (violation of portal AGENTS.md async-action-
// feedback rule). This dialog adds:
//   1. Explicit choice between "fork to this directory" (the source
//      session's directory) and "fork to a different project" (opens
//      the shared DirectoryPicker from Section M).
//   2. A multi-phase progress label inside the button so the user
//      sees "Asking opencode..." -> "Forking..." -> "Opening...".
//   3. When a different directory is selected, the fork is followed
//      by an auto-move via the move-to-project endpoint so the new
//      session lands in the right project.

export type ForkPhase =
  | "idle"
  | "asking"
  | "moving"
  | "opening"
  | "error";

interface ForkDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (targetDirectory: string | null) => Promise<void>;
  currentDirectory: string | null;
  phase: ForkPhase;
  errorMessage: string | null;
}

const PHASE_LABEL: Record<ForkPhase, string> = {
  idle: "Fork",
  asking: "Asking opencode to fork...",
  moving: "Moving forked session...",
  opening: "Opening the new session...",
  error: "Retry",
};

export function ForkDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  currentDirectory,
  phase,
  errorMessage,
}: ForkDialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={phase === "idle" || phase === "error"}
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm"
    >
      <Modal className="w-full max-w-md flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col flex-1 min-h-0 outline-none">
          {({ close }) => (
            <Body
              currentDirectory={currentDirectory}
              phase={phase}
              errorMessage={errorMessage}
              onCancel={close}
              onConfirm={onConfirm}
            />
          )}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

function Body({
  currentDirectory,
  phase,
  errorMessage,
  onCancel,
  onConfirm,
}: {
  currentDirectory: string | null;
  phase: ForkPhase;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: (targetDirectory: string | null) => Promise<void>;
}) {
  type Choice = "same" | "different";
  const [choice, setChoice] = React.useState<Choice>("same");
  const [pickedPath, setPickedPath] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const busy = phase !== "idle" && phase !== "error";

  const handleSubmit = async () => {
    if (choice === "same") {
      await onConfirm(null);
    } else if (pickedPath) {
      await onConfirm(pickedPath);
    }
  };

  const canSubmit =
    !busy &&
    (choice === "same" || (choice === "different" && pickedPath !== null));

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold">Fork session</h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          disabled={busy}
          className="inline-flex items-center justify-center size-7 rounded text-muted-fg hover:bg-muted hover:text-fg disabled:opacity-40"
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted-fg">
          Forking creates a copy of the conversation up to this point in a new
          session. Choose where the new session lives:
        </p>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name="fork-target"
            checked={choice === "same"}
            onChange={() => {
              setChoice("same");
              setPickedPath(null);
            }}
            disabled={busy}
            className="mt-1"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Fork to this directory</div>
            <div className="text-xs text-muted-fg truncate font-mono">
              {currentDirectory ?? "(no directory)"}
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name="fork-target"
            checked={choice === "different"}
            onChange={() => setChoice("different")}
            disabled={busy}
            className="mt-1"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Fork to a different project</div>
            {pickedPath ? (
              <div className="text-xs text-muted-fg truncate font-mono">
                {pickedPath}
              </div>
            ) : choice === "different" ? (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={busy}
                className="text-xs text-accent underline underline-offset-2 disabled:opacity-40"
              >
                Choose project...
              </button>
            ) : (
              <div className="text-xs text-muted-fg">
                Pick a target project after selecting this option.
              </div>
            )}
            {choice === "different" && pickedPath && !busy && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="text-xs text-accent underline underline-offset-2 mt-0.5"
              >
                Change target
              </button>
            )}
          </div>
          <FolderIcon className="size-4 text-muted-fg shrink-0 mt-0.5" />
        </label>

        {phase === "error" && errorMessage && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            <div className="font-medium">Fork failed</div>
            <div className="mt-1 opacity-80">{errorMessage}</div>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
            <Loader className="size-3" />
            {PHASE_LABEL[phase]}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            intent="outline"
            size="sm"
            onPress={onCancel}
            isDisabled={busy}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onPress={() => {
              void handleSubmit();
            }}
            isDisabled={!canSubmit}
            data-test="portal-fork-confirm"
          >
            <ArrowsRightLeftIcon className="size-4" data-slot="icon" />
            {busy ? PHASE_LABEL[phase] : phase === "error" ? "Retry" : "Fork"}
          </Button>
        </div>
      </div>
      <DirectoryPicker
        isOpen={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(path) => {
          setPickedPath(path);
          setPickerOpen(false);
        }}
        title="Choose target project for the forked session"
        excludePath={currentDirectory}
      />
    </>
  );
}
