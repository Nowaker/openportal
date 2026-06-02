import { useState } from "react";
import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { copyTextToClipboard } from "@/lib/clipboard";

export function CopyMarkdownButton({ text }: { text: string }) {
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
