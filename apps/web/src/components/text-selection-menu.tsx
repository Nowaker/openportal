import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface TextSelectionMenuProps {
  containerRef: React.RefObject<HTMLElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setHasContent: (has: boolean) => void;
}

interface MenuPos {
  top: number;
  left: number;
  flipUp: boolean;
  text: string;
}

function insertAtCursor(
  textarea: HTMLTextAreaElement,
  insert: string,
): string {
  const value = textarea.value;
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const before = value.substring(0, start);
  const after = value.substring(end);
  const sepBefore =
    before && !before.endsWith(" ") && !before.endsWith("\n") ? " " : "";
  const sepAfter =
    after && !after.startsWith(" ") && !after.startsWith("\n") ? " " : "";
  const composed = `${sepBefore}${insert}${sepAfter}`;
  const next = before + composed + after;
  textarea.value = next;
  const caret = start + composed.length - sepAfter.length;
  textarea.selectionStart = caret;
  textarea.selectionEnd = caret;
  return next;
}

function quoteMultiline(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function TextSelectionMenu({
  containerRef,
  textareaRef,
  setHasContent,
}: TextSelectionMenuProps) {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dismissingRef = useRef(false);

  useEffect(() => {
    const handle = () => {
      if (dismissingRef.current) {
        dismissingRef.current = false;
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setPos(null);
        return;
      }
      const text = sel.toString().trim();
      if (!text) {
        setPos(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const node =
        range.commonAncestorContainer.nodeType === 1
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement;
      const container = containerRef.current;
      if (!container || !node || !container.contains(node)) {
        setPos(null);
        return;
      }
      const rects = range.getClientRects();
      if (rects.length === 0) {
        setPos(null);
        return;
      }
      const firstRect = rects[0];
      const lastRect = rects[rects.length - 1];

      // Flip menu opposite to drag direction so it never covers the cells
      // the cursor is dragging toward. Forward drag (down/right): menu above
      // the bottom-most rect. Backward drag (up/left): menu below the
      // top-most rect.
      const isForward =
        sel.anchorNode === range.startContainer &&
        sel.anchorOffset === range.startOffset;

      const GAP = 6;
      const MARGIN = 8;
      const top = isForward ? lastRect.top - GAP : firstRect.bottom + GAP;
      const rawLeft = isForward ? lastRect.right - 120 : firstRect.left;
      // Clamp left into the viewport: the menu is position:fixed, so a
      // far-right selection would otherwise push it past the right edge and
      // trigger horizontal page scroll. menuRef gives the real width after
      // first render; 240 is a safe over-estimate before then.
      const viewportWidth = document.documentElement.clientWidth;
      const menuWidth = menuRef.current?.offsetWidth ?? 240;
      const maxLeft = Math.max(MARGIN, viewportWidth - menuWidth - MARGIN);
      const left = Math.min(Math.max(MARGIN, rawLeft), maxLeft);
      setPos({ top, left, flipUp: isForward, text });
    };

    document.addEventListener("selectionchange", handle);
    return () => document.removeEventListener("selectionchange", handle);
  }, [containerRef]);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dismissingRef.current = true;
        window.getSelection()?.removeAllRanges();
        setPos(null);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      setPos(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [pos]);

  if (!pos) return null;

  const dismiss = () => {
    dismissingRef.current = true;
    window.getSelection()?.removeAllRanges();
    setPos(null);
  };

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(pos.text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed - clipboard permission denied?");
    }
    dismiss();
  };

  const doQuoteInline = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const collapsed = pos.text.replace(/\s+/g, " ").trim();
    const wrapped = `\`${collapsed}\``;
    insertAtCursor(ta, wrapped);
    setHasContent(ta.value.length > 0);
    ta.focus();
    dismiss();
  };

  const doQuoteMultiline = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const block = quoteMultiline(pos.text);
    const final = ta.value.length > 0 ? `\n${block}\n` : `${block}\n`;
    insertAtCursor(ta, final);
    setHasContent(ta.value.length > 0);
    ta.focus();
    dismiss();
  };

  return (
    <div
      ref={menuRef}
      role="toolbar"
      aria-label="Selection actions"
      style={{
        top: pos.top,
        left: pos.left,
        transform: pos.flipUp ? "translateY(-100%)" : undefined,
      }}
      className="fixed z-50 flex gap-1 rounded-md border border-border bg-overlay px-1 py-0.5 text-xs shadow-md"
      data-test="portal-selection-menu"
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        onClick={doCopy}
        className="rounded px-2 py-1 hover:bg-muted"
        data-test="portal-selection-copy"
        title="Copy selection to clipboard"
      >
        Copy
      </button>
      <button
        type="button"
        onClick={doQuoteInline}
        className="rounded px-2 py-1 hover:bg-muted"
        data-test="portal-selection-quote-inline"
        title="Insert selection into composer as inline `code`"
      >
        Quote inline
      </button>
      <button
        type="button"
        onClick={doQuoteMultiline}
        className="rounded px-2 py-1 hover:bg-muted"
        data-test="portal-selection-quote-multiline"
        title="Insert selection into composer as a > quoted block"
      >
        Quote block
      </button>
    </div>
  );
}
