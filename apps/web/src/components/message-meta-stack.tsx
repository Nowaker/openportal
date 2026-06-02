import type { ReactNode } from "react";
import { CopyMarkdownButton } from "@/components/copy-markdown-button";
import { MessagePermalinkTimestamp } from "@/components/message-permalink-timestamp";

export interface MessageMetaStackProps {
  messageId: string;
  copyText?: string | null;
  timestamp?: {
    display: string;
    title: string;
    stepDurationLabel?: string | null;
  } | null;
  // Caller-controlled plain-text timestamp (no permalink behavior). Used
  // for pending messages whose ID is local-only and not navigable.
  timestampPlain?: { display: string; title: string } | null;
  leading?: ReactNode;
  trailing?: ReactNode;
  meta?: { parts: string[]; title: string } | null;
  align?: "left" | "right";
  className?: string;
  dataTest?: string;
}

export function MessageMetaStack({
  messageId,
  copyText,
  timestamp,
  timestampPlain,
  leading,
  trailing,
  meta,
  align = "right",
  className,
  dataTest,
}: MessageMetaStackProps) {
  const hasMeta = !!meta && meta.parts.length > 0;
  const hasLine1 = !!(leading || copyText || timestamp || timestampPlain || trailing);
  if (!hasLine1 && !hasMeta) return null;
  const itemsAlign = align === "right" ? "items-end" : "items-start";
  return (
    <div
      className={`flex flex-col ${itemsAlign} gap-0.5 ${className ?? ""}`}
      data-test={dataTest}
    >
      {hasLine1 && (
        <div className="flex items-center gap-1.5">
          {leading}
          {copyText && <CopyMarkdownButton text={copyText} />}
          {trailing}
          {timestamp && (
            <MessagePermalinkTimestamp
              messageId={messageId}
              display={
                timestamp.stepDurationLabel
                  ? `${timestamp.stepDurationLabel} - ${timestamp.display}`
                  : timestamp.display
              }
              titleAt={
                timestamp.stepDurationLabel
                  ? `Step duration: ${timestamp.stepDurationLabel}\n${timestamp.title}`
                  : timestamp.title
              }
              className="font-mono tabular-nums whitespace-nowrap"
            />
          )}
          {timestampPlain && (
            <span
              className="font-mono tabular-nums whitespace-nowrap"
              title={timestampPlain.title}
            >
              {timestampPlain.display}
            </span>
          )}
        </div>
      )}
      {hasMeta && (
        <span
          className="font-mono tabular-nums whitespace-nowrap"
          data-test="portal-msg-meta-line"
          title={meta.title}
        >
          {meta.parts.join(" · ")}
        </span>
      )}
    </div>
  );
}
