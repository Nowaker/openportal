import type { ReactNode } from "react";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
  Heading,
} from "react-aria-components";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Button } from "./button";

// In-app destructive-action confirmation.
//
// Replaces the native `window.confirm` / `alert` / `prompt` modals,
// which:
//   - block the main thread and the entire tab,
//   - can't be styled to match the app theme,
//   - look like a hung browser to users on dark mode,
//   - have no keyboard a11y story tied to the surrounding app.
//
// Usage pattern is uncontrolled: the parent owns a piece of state
// (the "target" being confirmed against). Open by setting the state,
// dismiss by clearing it. `onConfirm` runs the action; the consumer
// is responsible for catching errors and surfacing them via their
// own UI (toast / inline banner / etc.).

export interface ConfirmDialogProps {
  // Falsy = closed. Any truthy value = open. The value itself isn't
  // touched here; it just doubles as a discriminator so the parent
  // can pass {entry: ...} or similar and read it inside onConfirm.
  isOpen: boolean;
  // Headline (e.g. "Remove server?").
  title: string;
  // Body copy. Plain string renders as `whitespace-pre-line` paragraph
  // (multiline ok); pass a ReactNode (e.g. <pre>) for richer layouts
  // like dry-run output blobs.
  description?: ReactNode;
  // Confirm button label. Defaults to "Confirm".
  confirmLabel?: string;
  // Cancel button label. Defaults to "Cancel".
  cancelLabel?: string;
  // When the user confirms. The handler may be async; the dialog
  // stays mounted while it resolves (parent should set busy state if
  // it wants to disable buttons).
  onConfirm: () => void | Promise<void>;
  // Either explicit close (X / Cancel / backdrop) or post-confirm.
  // The parent typically clears its `isOpen`-driving state here.
  onClose: () => void;
  // Set true while the confirm action is in flight so we can disable
  // the buttons and avoid double-submits.
  busy?: boolean;
  // Tone. "danger" colours the confirm button red; default keeps the
  // primary blue. Use "danger" for delete / clear / similar.
  tone?: "default" | "danger";
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onClose,
  busy,
  tone = "default",
}: ConfirmDialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      isDismissable={!busy}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50"
    >
      <Modal className="outline-none w-full max-w-sm max-h-[90vh]">
        <PrimitiveDialog
          role="alertdialog"
          className="relative outline-none rounded-xl bg-bg shadow-2xl border border-border/50 flex flex-col max-h-[90vh]"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
            className="absolute right-2 top-2 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg disabled:opacity-50 z-10"
          >
            <XMarkIcon className="size-4" />
          </button>
          <div className="space-y-1 pr-6 px-5 pt-5 shrink-0">
            <Heading slot="title" className="text-base font-semibold">
              {title}
            </Heading>
          </div>
          {description !== undefined && description !== "" ? (
            <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-3">
              {typeof description === "string" ? (
                <p className="text-sm text-muted-fg whitespace-pre-line break-words">
                  {description}
                </p>
              ) : (
                description
              )}
            </div>
          ) : (
            <div className="h-2 shrink-0" />
          )}
          <div className="flex justify-end gap-2 px-5 pb-5 pt-2 shrink-0 border-t border-border/30">
            <Button
              size="sm"
              intent="secondary"
              onPress={onClose}
              isDisabled={busy}
            >
              {cancelLabel}
            </Button>
            <Button
              size="sm"
              intent={tone === "danger" ? "danger" : "primary"}
              onPress={() => {
                void onConfirm();
              }}
              isDisabled={busy}
            >
              {busy ? "Working\u2026" : confirmLabel}
            </Button>
          </div>
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}
