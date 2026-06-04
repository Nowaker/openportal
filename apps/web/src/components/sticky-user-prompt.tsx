import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import type { MessageWithParts, Part } from "@/hooks/use-session-messages";
import { parseOmoBlocks } from "@/lib/omo-injection";
import { OmoBlockCompact } from "@/components/omo-block-compact";
import { MessageMetaStack } from "@/components/message-meta-stack";
import { computeMessageMeta, type ProvidersData } from "@/lib/message-meta";
import { useChatDisplayStore } from "@/stores/chat-display-store";
import { useDateFormatStore } from "@/stores/date-format-store";
import {
  formatMessageTime,
  formatAbsoluteAndRelative,
} from "@/lib/format-time";

function extractText(parts: Part[]): string {
  const chunks: string[] = [];
  for (const p of parts) {
    if ((p as { type?: string }).type === "text") {
      const t = (p as { text?: string }).text;
      if (t && t.trim()) chunks.push(t);
    }
  }
  return chunks.join("\n\n").trim();
}

const TOP_EPSILON_PX = 4;
// Fallback hide-threshold used until the sticky element has rendered
// and its real height is measured. Roughly: two text lines + meta line
// + padding + border.
const FALLBACK_STICKY_HEIGHT_PX = 96;

export function StickyUserPromptOverlay({
  containerRef,
  messages,
  providersData,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  messages: MessageWithParts[];
  providersData: ProvidersData | undefined;
}) {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const rafRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef<HTMLDivElement | null>(null);
  const stickyHeightRef = useRef(FALLBACK_STICKY_HEIGHT_PX);
  const dateFormat = useDateFormatStore((s) => s.format);
  const shortenOmoAgent = useChatDisplayStore((s) => s.shortenOmoAgentNames);

  const messageById = useMemo(() => {
    const m = new Map<string, MessageWithParts>();
    for (const msg of messages) m.set(msg.info.id, msg);
    return m;
  }, [messages]);

  const userMessageIndexById = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].info.role === "user") m.set(messages[i].info.id, i);
    }
    return m;
  }, [messages]);

  const update = useCallback(() => {
    const c = containerRef.current;
    if (!c) {
      setCurrentId(null);
      return;
    }
    const userEls = c.querySelectorAll<HTMLElement>('[data-role="user"]');
    if (userEls.length === 0) {
      setCurrentId(null);
      return;
    }
    const containerTop = c.getBoundingClientRect().top;
    let lastAbove: HTMLElement | null = null;
    let firstNotAbove: HTMLElement | null = null;
    for (const el of userEls) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= containerTop + TOP_EPSILON_PX) {
        lastAbove = el;
        continue;
      }
      firstNotAbove = el;
      break;
    }
    // Hide the sticky when the next visible user prompt is still close
    // enough to the top bar that overlaying its predecessor as a sticky
    // would visually crowd it. Threshold = the sticky's own rendered
    // height (so the sticky never overlaps a user-message header row).
    if (lastAbove && firstNotAbove) {
      const rect = firstNotAbove.getBoundingClientRect();
      const distanceFromTop = rect.top - containerTop;
      const threshold = stickyHeightRef.current || FALLBACK_STICKY_HEIGHT_PX;
      if (distanceFromTop < threshold) {
        setCurrentId(null);
        return;
      }
    }
    setCurrentId(lastAbove?.dataset.messageId ?? null);
  }, [containerRef]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        update();
      });
    };
    c.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(c);
    update();
    return () => {
      c.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [containerRef, update]);

  useEffect(() => {
    update();
  }, [messages, update]);

  useEffect(() => {
    setExpanded(false);
    setIsTruncated(false);
  }, [currentId]);

  // Keep stickyHeightRef in sync with the rendered sticky element so the
  // "hide when next prompt nears top" threshold uses the real height.
  useEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.offsetHeight;
      if (h > 0 && h !== stickyHeightRef.current) {
        stickyHeightRef.current = h;
        // Re-evaluate visibility with the new threshold.
        update();
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentId, expanded, update]);

  useLayoutEffect(() => {
    if (expanded) return;
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      if (!bodyRef.current) return;
      const node = bodyRef.current;
      setIsTruncated(node.scrollHeight > node.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentId, expanded]);

  const handleJump = useCallback(() => {
    const c = containerRef.current;
    if (!c || !currentId) return;
    const target = c.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(currentId)}"]`,
    );
    if (target) {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [containerRef, currentId]);

  const handleBoxClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest("button, a, input, textarea")) return;
      handleJump();
    },
    [handleJump],
  );

  if (!currentId) return null;
  const message = messageById.get(currentId);
  if (!message || message.info.role !== "user") return null;
  const text = extractText(message.parts);

  const myIdx = userMessageIndexById.get(currentId) ?? -1;
  let nextAssistantInfo: MessageWithParts["info"] | null = null;
  if (myIdx >= 0) {
    for (let j = myIdx + 1; j < messages.length; j++) {
      if (messages[j].info.role === "assistant") {
        nextAssistantInfo = messages[j].info;
        break;
      }
    }
  }
  const meta = computeMessageMeta(
    message.info,
    nextAssistantInfo,
    false,
    providersData,
    undefined,
    { shortenOmoAgent },
  );

  const created = message.info.time?.created;
  const timestamp = created ? formatMessageTime(created, dateFormat) : "";
  const titleAt = formatAbsoluteAndRelative(created) ?? "";

  const blocks = text ? parseOmoBlocks(text) : [];

  const showChevron = expanded || isTruncated;
  const copyText = text || null;

  return (
    <div className="pointer-events-none absolute top-0 left-0 right-0 z-20 px-3 pt-2">
      <div
        ref={stickyRef}
        role="button"
        tabIndex={0}
        onClick={handleBoxClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleJump();
          }
        }}
        className="pointer-events-auto cursor-pointer rounded-md border border-primary/30 bg-primary/15 shadow-sm backdrop-blur-sm hover:bg-primary/20"
        title="Click to jump to this prompt"
        aria-label="Jump to this prompt"
      >
        <div className="flex items-start gap-1.5 px-3 py-2">
          <div className="flex-1 min-w-0 text-sm text-fg">
            <div
              ref={bodyRef}
              className={
                expanded
                  ? "whitespace-pre-wrap break-words overflow-y-auto"
                  : "line-clamp-2 whitespace-pre-wrap break-words"
              }
              style={expanded ? { maxHeight: "40vh" } : undefined}
            >
              {blocks.length === 0 && text}
              {blocks.map((b, i) =>
                b.kind === "omo" ? (
                  <OmoBlockCompact
                    key={i}
                    header={b.header ?? ""}
                    summary={b.summary}
                    segments={b.segments}
                  />
                ) : (
                  <span key={i}>{b.text}</span>
                ),
              )}
            </div>
            <MessageMetaStack
              messageId={currentId}
              className="mt-1 text-[10px] text-muted-fg/70"
              align="right"
              inline
              copyText={copyText}
              timestamp={
                timestamp ? { display: timestamp, title: titleAt } : null
              }
              meta={meta}
            />
          </div>
          {showChevron && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="rounded p-1 text-muted-fg hover:bg-primary/20 hover:text-fg"
              aria-label={expanded ? "Collapse prompt" : "Expand prompt"}
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <ChevronUpIcon className="size-4" />
              ) : (
                <ChevronDownIcon className="size-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
