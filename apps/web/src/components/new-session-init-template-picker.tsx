import {
  Bars3Icon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/outline";
import { Textarea } from "@/components/ui/textarea";
import type { NewSessionTemplatesController } from "@/hooks/use-new-session-templates";

interface NewSessionInitTemplatePickerProps {
  readonly controller: NewSessionTemplatesController;
}

export function NewSessionInitTemplatePicker({
  controller,
}: NewSessionInitTemplatePickerProps) {
  const {
    order,
    dragOverId,
    expandedId,
    edits,
    selected,
    dragSourceIdRef,
    setDragOverId,
    setExpandedId,
    setEdits,
    toggle,
    handleDrop,
  } = controller;

  return (
    <div className="w-full max-w-2xl rounded-lg border border-border bg-bg/60 p-3 space-y-2 shrink-0">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-fg">
          Init templates
        </h2>
        <p className="text-[11px] text-muted-fg/80">
          Default-on templates start checked. Drag to reorder; checked templates
          are prepended on submit.
        </p>
      </div>
      <div className="space-y-1">
        {order.map((tool) => {
          const isDragOver = dragOverId === tool.id;
          const isSelected = selected.has(tool.id);
          const isExpanded = expandedId === tool.id;
          const editedBody = edits[tool.id];
          const isModified =
            editedBody !== undefined && editedBody !== tool.prompt;
          return (
            <div
              key={tool.id}
              className={`rounded-md border border-border bg-bg/60 overflow-hidden ${
                isDragOver ? "bg-primary/10 border-primary/40" : ""
              }`}
            >
              <div
                draggable
                onDragStart={(e) => {
                  dragSourceIdRef.current = tool.id;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", tool.id);
                }}
                onDragOver={(e) => {
                  if (!dragSourceIdRef.current) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverId !== tool.id) setDragOverId(tool.id);
                }}
                onDragLeave={() => {
                  if (dragOverId === tool.id) setDragOverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(tool.id);
                }}
                onDragEnd={() => {
                  dragSourceIdRef.current = null;
                  setDragOverId(null);
                }}
                className="flex items-center gap-2 px-2 py-1.5 text-sm"
              >
                <Bars3Icon className="size-4 text-muted-fg shrink-0 cursor-grab active:cursor-grabbing" />
                <label className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(tool.id)}
                    className="size-4 accent-primary shrink-0"
                  />
                  <span className="min-w-0 sm:truncate">
                    <span className="font-medium">{tool.name}</span>
                    {isModified && (
                      <span className="ml-1 text-accent/80 text-xs">
                        + modifications
                      </span>
                    )}
                    {tool.description && (
                      <span className="hidden text-xs text-muted-fg sm:ml-2 sm:inline">
                        {tool.description}
                      </span>
                    )}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId((prev) => (prev === tool.id ? null : tool.id))
                  }
                  className="shrink-0 rounded p-0.5 text-muted-fg hover:text-fg hover:bg-muted/30"
                  title="Preview / edit template body (one-time, not saved)"
                  aria-label="Preview / edit template body"
                >
                  {isExpanded ? (
                    <ChevronUpIcon className="size-4" />
                  ) : (
                    <ChevronDownIcon className="size-4" />
                  )}
                </button>
              </div>
              {tool.description && (
                <p className="border-t border-border/40 px-8 py-1 text-xs text-muted-fg sm:hidden">
                  {tool.description}
                </p>
              )}
              {isExpanded && (
                <div className="border-t border-border/60 p-2 bg-muted/10 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-fg/80">
                      Edit body (one-time, not saved)
                    </span>
                    {isModified && (
                      <button
                        type="button"
                        onClick={() =>
                          setEdits((prev) => {
                            const next = { ...prev };
                            delete next[tool.id];
                            return next;
                          })
                        }
                        className="text-[10px] text-muted-fg/70 underline hover:text-fg"
                      >
                        Reset to original
                      </button>
                    )}
                  </div>
                  <Textarea
                    value={editedBody !== undefined ? editedBody : tool.prompt}
                    onChange={(e) =>
                      setEdits((prev) => ({
                        ...prev,
                        [tool.id]: e.target.value,
                      }))
                    }
                    rows={8}
                    className="text-xs"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
