import { useState } from "react";
import {
  ModalOverlay,
  Modal,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import {
  ClipboardDocumentIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { MODAL_OVERLAY_CLASSES } from "@/lib/ui-classes";
import { ShikiCodeBlock } from "@/components/code-block-shiki";
import { toast } from "@/components/ui/toast";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  messageInfo: unknown;
  messageParts: unknown;
  messageId: string;
}

export function MessageInfoModal({
  isOpen,
  onOpenChange,
  messageInfo,
  messageParts,
  messageId,
}: Props) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(
    { info: messageInfo, parts: messageParts },
    null,
    2,
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      toast.success("Message metadata copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className={MODAL_OVERLAY_CLASSES}
    >
      <Modal className="w-full max-w-3xl max-h-[85dvh] flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col flex-1 min-h-0 outline-none">
          {({ close }) => (
            <>
              <header className="shrink-0 flex items-start gap-2 border-b border-border px-4 py-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold">Message metadata</h2>
                  <p className="mt-1 text-xs text-muted-fg font-mono">
                    {messageId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void copy()}
                  data-test="portal-msg-info-copy"
                  title="Copy full JSON to clipboard"
                  className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs hover:bg-muted/30"
                >
                  <ClipboardDocumentIcon className="size-3.5" />
                  {copied ? "Copied!" : "Copy JSON"}
                </button>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
                >
                  <XMarkIcon className="size-4" />
                </button>
              </header>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ShikiCodeBlock content={json} language="json" />
              </div>
            </>
          )}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}
