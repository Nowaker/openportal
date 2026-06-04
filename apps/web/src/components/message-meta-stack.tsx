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
  // When true, render leading/copy/trailing/meta/timestamp on a SINGLE
  // horizontal line joined by " · " separators. Used by the sticky
  // overlay where vertical space is precious. Default (false) renders
  // the two-line stacked layout used per-message in the chat log.
  inline?: boolean;
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
  inline = false,
}: MessageMetaStackProps) {
  const hasMeta = !!meta && meta.parts.length > 0;
  const hasLine1 = !!(leading || copyText || timestamp || timestampPlain || trailing);
  if (!hasLine1 && !hasMeta) return null;

  if (inline) {
    const justifyAlign = align === "right" ? "justify-end" : "justify-start";
    const permalinkDisplay = timestamp
      ? timestamp.stepDurationLabel
        ? `${timestamp.stepDurationLabel} - ${timestamp.display}`
        : timestamp.display
      : null;
    const permalinkTitle = timestamp
      ? timestamp.stepDurationLabel
        ? `Step duration: ${timestamp.stepDurationLabel}\n${timestamp.title}`
        : timestamp.title
      : "";
    return (
      <div
        className={`flex items-center ${justifyAlign} gap-1.5 ${className ?? ""}`}
        data-test={dataTest}
      >
        {leading}
        {copyText && <CopyMarkdownButton text={copyText} />}
        {trailing}
        {hasMeta && (
          <span
            className="font-mono tabular-nums whitespace-nowrap"
            data-test="portal-msg-meta-line"
            title={meta?.title}
          >
            {meta!.parts.join(" \u00b7 ")}
          </span>
        )}
        {hasMeta && (timestamp || timestampPlain) && (
          <span className="font-mono text-muted-fg/70">{"\u00b7"}</span>
        )}
        {timestamp && permalinkDisplay && (
          <MessagePermalinkTimestamp
            messageId={messageId}
            display={permalinkDisplay}
            titleAt={permalinkTitle}
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
    );
  }

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
