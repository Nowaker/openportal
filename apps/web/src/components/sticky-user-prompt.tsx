import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import type { MessageWithParts, Part } from "@/hooks/use-session-messages";

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

export function StickyUserPromptOverlay({
  containerRef,
  messages,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  messages: MessageWithParts[];
}) {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const rafRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const textById = useMemo(() => {
    const m = new Map<string, string>();
    for (const msg of messages) {
      if (msg.info.role === "user") {
        const txt = extractText(msg.parts);
        if (txt) m.set(msg.info.id, txt);
      }
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
    for (const el of userEls) {
      const relTop = el.getBoundingClientRect().top - containerTop;
      if (relTop < -TOP_EPSILON_PX) {
        lastAbove = el;
        continue;
      }
      if (relTop <= TOP_EPSILON_PX) {
        // A user prompt is sitting at the very top of the viewport
        // (jumped here, or natural scroll-stop). The user can already
        // see this prompt - the previous one is irrelevant.
        setCurrentId(null);
        return;
      }
      break;
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

  // Detect whether collapsed body is being truncated by line-clamp.
  // When the full text fits in 2 lines the chevron is useless and just
  // adds noise - the user's feedback was to hide it in that case.
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

  if (!currentId) return null;
  const text = textById.get(currentId);
  if (!text) return null;

  const showChevron = expanded || isTruncated;

  return (
    <div className="pointer-events-none absolute top-0 left-0 right-0 z-20 px-3 pt-2">
      <div className="pointer-events-auto rounded-md border border-primary/30 bg-primary/15 shadow-sm backdrop-blur-sm">
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
              {text}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-0.5">
            {showChevron && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
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
            <button
              type="button"
              onClick={handleJump}
              className="rounded px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-fg hover:bg-primary/20 hover:text-fg"
              title="Jump to this prompt"
              aria-label="Jump to this prompt"
            >
              jump
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
