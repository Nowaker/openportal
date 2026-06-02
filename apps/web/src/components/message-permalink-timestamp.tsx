import { useRef, useState, type MouseEvent } from "react";
import { copyTextToClipboard } from "@/lib/clipboard";

export function flashMessageHighlight(messageId: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(`msg-${messageId}`);
  if (!el) return;
  el.classList.add("permalink-highlight");
  window.setTimeout(() => {
    el.classList.remove("permalink-highlight");
  }, 2400);
}

export function MessagePermalinkTimestamp({
  messageId,
  display,
  titleAt,
  className,
}: {
  messageId: string;
  display: string;
  titleAt: string | undefined;
  className: string;
}) {
  const safeTitleAt = titleAt ?? "";
  const [copied, setCopied] = useState(false);
  const buildAbsoluteUrl = (): string => {
    const hash = `#msg-${encodeURIComponent(messageId)}`;
    if (typeof window === "undefined") return hash;
    const url = new URL(window.location.href);
    url.hash = hash;
    return url.toString();
  };
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const inPage =
      typeof document !== "undefined" &&
      document.getElementById(`msg-${messageId}`) !== null;
    if (inPage) {
      e.preventDefault();
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        if (typeof window !== "undefined") {
          const hash = `#msg-${encodeURIComponent(messageId)}`;
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}${hash}`,
          );
        }
        flashMessageHighlight(messageId);
      }
    }
  };
  const handleContextMenu = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    void copyTextToClipboard(buildAbsoluteUrl()).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  const longPressTimerRef = useRef<number | null>(null);
  const handleTouchStart = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      void copyTextToClipboard(buildAbsoluteUrl()).then((ok) => {
        if (!ok) return;
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      });
    }, 600);
  };
  const handleTouchEnd = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };
  const titleSuffix = copied
    ? " - link copied!"
    : " - click to jump, right-click / long-press to copy permalink";
  return (
    <a
      href={`#msg-${encodeURIComponent(messageId)}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      title={`${safeTitleAt}${titleSuffix}`}
      aria-label="Jump to message (right-click / long-press copies permalink)"
      className={`${className} cursor-pointer hover:text-fg hover:underline decoration-dotted underline-offset-2 transition-colors`}
    >
      {copied ? "copied!" : display}
    </a>
  );
}
