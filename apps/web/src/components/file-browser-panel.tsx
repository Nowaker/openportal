import { useEffect, useRef, useState } from "react";

import { useFileBrowserPanelStore } from "@/stores/file-browser-panel-store";

const MIN_WIDTH = 360;
const MAX_WIDTH = 1200;
const DEFAULT_WIDTH = 720;
const WIDTH_STORAGE_KEY = "openportal-file-browser-panel-width";

function readPersistedWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
  } catch {
    /* localStorage may be unavailable; fall through */
  }
  return DEFAULT_WIDTH;
}

function persistWidth(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(value));
  } catch {
    /* best-effort */
  }
}

export function FileBrowserPanel() {
  const { isOpen, initialPath, close } = useFileBrowserPanelStore();
  const [width, setWidth] = useState<number>(readPersistedWidth);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string } | null;
      if (data?.type === "fb-close") close();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [close]);

  if (!isOpen) return null;

  const src = initialPath
    ? `/files?panel=1&path=${encodeURIComponent(initialPath)}`
    : "/files?panel=1";

  // Pointer capture binds every move + up event to the handle until
  // release - critical for an iframe-adjacent resizer. Without it, the
  // moment the cursor crosses into iframe territory the iframe
  // document captures pointer events and the parent stops seeing them:
  // dragging right (to shrink) breaks immediately, and pointerup never
  // fires on the parent so dragState leaks and subsequent moves keep
  // updating the width.
  //
  // pointer-events: none on the iframe during drag is belt-and-
  // suspenders: even with pointer capture, an iframe that absorbs
  // hover events can still feel wrong during the drag. Disabling
  // pointer-events keeps the cursor visually consistent and avoids
  // selecting iframe content as a side effect.
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = { startX: e.clientX, startWidth: width };
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s) return;
    const dx = s.startX - e.clientX;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, s.startWidth + dx));
    if (next !== width) setWidth(next);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may have been released by the browser already */
      }
    }
    if (dragStateRef.current) {
      persistWidth(width);
    }
    dragStateRef.current = null;
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <aside
      className="hidden md:flex shrink-0 flex-col border-l border-border bg-bg relative"
      style={{ width: `${width}px` }}
    >
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 z-10 touch-none"
        aria-label="Resize file browser panel"
        role="separator"
        aria-orientation="vertical"
      />
      <iframe
        title="File browser"
        src={src}
        className={`h-full w-full flex-1 border-0 ${
          dragging ? "pointer-events-none" : ""
        }`}
      />
    </aside>
  );
}
