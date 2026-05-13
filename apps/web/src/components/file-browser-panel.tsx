import { XMarkIcon } from "@heroicons/react/24/outline";

import { useFileBrowserPanelStore } from "@/stores/file-browser-panel-store";

// Desktop-only right-side drawer. The iframe is rendered ONLY when
// isOpen is true so the heavy /files bundle isn't paid for until the
// user actually opens it. Closing returns to null mount, which the
// browser collapses into a full teardown of the iframe context -
// effectively the unmount-on-close "release memory" behavior the
// user spec'd. State machine: store flips isOpen, store flips back.
export function FileBrowserPanel() {
  const { isOpen, initialPath, close } = useFileBrowserPanelStore();
  if (!isOpen) return null;

  const src = initialPath
    ? `/files?path=${encodeURIComponent(initialPath)}`
    : "/files";

  return (
    <aside className="fixed inset-y-0 right-0 z-40 hidden w-[min(50vw,820px)] flex-col border-l border-border bg-bg shadow-2xl md:flex">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
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
