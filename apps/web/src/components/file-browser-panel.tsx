import { XMarkIcon } from "@heroicons/react/24/outline";

import { useFileBrowserPanelStore } from "@/stores/file-browser-panel-store";

// Desktop-only right-side panel. Lives as a flex sibling of
// SidebarInset (in _app.tsx) so when it's open the main content
// reflows to share width with it - same layout pattern as the left
// AppSidebar. The iframe is mounted only while isOpen is true so the
// heavy /files bundle is paid for only on first open and torn down
// completely on close (the user-spec'd "release memory" behavior).
export function FileBrowserPanel() {
  const { isOpen, initialPath, close } = useFileBrowserPanelStore();
  if (!isOpen) return null;

  const src = initialPath
    ? `/files?path=${encodeURIComponent(initialPath)}`
    : "/files";

  return (
    <aside className="hidden md:flex shrink-0 w-[min(50vw,820px)] flex-col border-l border-border bg-bg">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 shrink-0">
        <span className="text-sm font-semibold">File browser</span>
        <button
          type="button"
          onClick={close}
          aria-label="Close file browser"
          className="inline-flex size-7 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg"
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
      <iframe
        title="File browser"
        src={src}
        className="h-full w-full flex-1 border-0"
      />
    </aside>
  );
}
