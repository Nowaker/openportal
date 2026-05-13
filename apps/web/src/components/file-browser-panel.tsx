import { useEffect, useRef, useState } from "react";

import { useFileBrowserPanelStore } from "@/stores/file-browser-panel-store";

// Desktop-only right-side panel. Lives as a flex sibling of
// SidebarInset (in _app.tsx) so when it's open the main content
// reflows to share width with it - same layout pattern as the left
// AppSidebar. The iframe is mounted only while isOpen is true so the
// heavy /files bundle is paid for only on first open and torn down
// completely on close.
//
// Width is user-resizable via a left-edge drag handle (mirrors the
// left AppSidebar UX). Width persists per-session in component state
// only; the panel store itself only tracks open/closed + initialPath.
// The close button moved into the iframe's own toolbar (files.tsx
// renders it next to refresh when ?panel=1 is in the URL) so the
// panel no longer needs its own title bar - the iframe owns the
// whole content area.
//
// File browser closes via window.postMessage({type:'fb-close'}) from
// inside the iframe to its parent (this panel), which fires the
// store's close().

const MIN_WIDTH = 360;
const MAX_WIDTH = 1200;
const DEFAULT_WIDTH = 720;

export function FileBrowserPanel() {
  const { isOpen, initialPath, close } = useFileBrowserPanelStore();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
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

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const s = dragStateRef.current;
      if (!s) return;
      const dx = s.startX - e.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, s.startWidth + dx));
      setWidth(next);
    }
    function onUp() {
      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  if (!isOpen) return null;

  const src = initialPath
    ? `/files?panel=1&path=${encodeURIComponent(initialPath)}`
    : "/files?panel=1";

  const onDragStart = (e: React.PointerEvent) => {
    dragStateRef.current = { startX: e.clientX, startWidth: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <aside
      className="hidden md:flex shrink-0 flex-col border-l border-border bg-bg relative"
      style={{ width: `${width}px` }}
    >
      <div
        onPointerDown={onDragStart}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 z-10"
        aria-label="Resize file browser panel"
        role="separator"
        aria-orientation="vertical"
      />
      <iframe
        title="File browser"
        src={src}
        className="h-full w-full flex-1 border-0"
      />
    </aside>
  );
}
