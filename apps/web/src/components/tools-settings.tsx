import { useEffect, useMemo, useRef, useState } from "react";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  resolveToolsFromState,
  useToolsStore,
  type ResolvedTool,
} from "@/stores/tools-store";

function ProjectInitCheckbox({ toolId }: { toolId: string }) {
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const toggleProjectInit = useToolsStore((s) => s.toggleProjectInit);
  const isInit = projectInitOrder.includes(toolId);
  // Fixed-width slot so the Init column aligns vertically across rows
  // regardless of which action buttons (Edit/Reset/Delete) follow on each
  // row. w-20 fits the longest variant ("Init" label + checkbox + breathing
  // room) without crowding the action buttons on its right.
  return (
    <label
      className="inline-flex w-20 items-center gap-2 text-[11px] uppercase tracking-wide text-muted-fg cursor-pointer select-none px-2"
      title="Include this template when creating a new project"
    >
      <input
        type="checkbox"
        className="size-4 cursor-pointer accent-primary"
        checked={isInit}
        onChange={(e) => toggleProjectInit(toolId, e.target.checked)}
      />
      Init
    </label>
  );
}

// Subscribe to the persisted slices and derive the resolved list via
// useMemo. Calling resolveTools()/enabledTools() inside a Zustand
// selector returns a fresh array identity on every render and trips
// React error #185 (infinite update depth).
function useResolvedTools(): ResolvedTool[] {
  const disabledIds = useToolsStore((s) => s.disabledIds);
  const systemOverrides = useToolsStore((s) => s.systemOverrides);
  const customTools = useToolsStore((s) => s.customTools);
  return useMemo(
    () =>
      resolveToolsFromState({ disabledIds, systemOverrides, customTools }),
    [disabledIds, systemOverrides, customTools],
  );
}

// Slugifies a free-form name into a stable id for new custom tools.
// Falls back to a timestamp suffix if the user picks an empty name or
// one that collides with an existing tool.
function makeCustomId(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "tool";
  const id = `custom.${base}`;
  if (!taken.has(id)) return id;
  return `custom.${base}-${Date.now().toString(36)}`;
}

interface ToolRowProps {
  tool: ResolvedTool;
}

function SystemToolRow({ tool }: ToolRowProps) {
  const setEnabled = useToolsStore((s) => s.setEnabled);
  const setSystemOverride = useToolsStore((s) => s.setSystemOverride);
  const resetSystemOverride = useToolsStore((s) => s.resetSystemOverride);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(tool.name);
  const [draftPrompt, setDraftPrompt] = useState(tool.prompt);

  // Sync drafts back to current tool state when not editing. Deps are
  // primitives (the strings themselves) rather than the tool object so
  // a parent re-render with a new tool reference but identical values
  // does NOT re-fire setState - this avoids React error #185.
  useEffect(() => {
    if (!editing) {
      setDraftName(tool.name);
      setDraftPrompt(tool.prompt);
    }
  }, [editing, tool.name, tool.prompt]);

  if (tool.kind !== "system") return null;

  return (
    <div className="rounded-lg border border-border bg-bg p-3 space-y-2">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Enable ${tool.name}`}
          className="mt-1 size-4 cursor-pointer accent-primary"
          checked={tool.enabled}
          onChange={(e) => setEnabled(tool.id, e.target.checked)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{tool.name}</span>
            {tool.isOverridden && (
              <span className="text-[10px] uppercase tracking-wide text-warning-subtle-fg bg-warning-subtle px-1.5 py-0.5 rounded">
                Edited
              </span>
            )}
          </div>
          <p className="text-xs text-muted-fg mt-0.5">{tool.description}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ProjectInitCheckbox toolId={tool.id} />
          <Button
            size="xs"
            intent="outline"
            onPress={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          {tool.isOverridden && (
            <Button
              size="xs"
              intent="outline"
              onPress={() => {
                resetSystemOverride(tool.id);
                setEditing(false);
              }}
            >
              Reset
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <div className="space-y-2 pt-2 border-t border-border/50">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-fg">
              Display name
            </label>
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder={tool.name}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-fg">
              Prompt sent to the agent
            </label>
            <Textarea
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              rows={8}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="xs"
              intent="outline"
              onPress={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              onPress={() => {
                setSystemOverride(tool.id, {
                  name: draftName.trim() === tool.name ? undefined : draftName.trim(),
                  prompt: draftPrompt === tool.prompt ? undefined : draftPrompt,
                });
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CustomToolRow({ tool }: ToolRowProps) {
  const setEnabled = useToolsStore((s) => s.setEnabled);
  const upsertCustomTool = useToolsStore((s) => s.upsertCustomTool);
  const removeCustomTool = useToolsStore((s) => s.removeCustomTool);

  const customDescription =
    tool.kind === "custom" ? (tool.description ?? "") : "";

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(tool.name);
  const [draftDescription, setDraftDescription] = useState(customDescription);
  const [draftPrompt, setDraftPrompt] = useState(tool.prompt);

  // Sync drafts when the underlying tool changes via primitive deps
  // (NOT [tool] - the object reference is fresh on every parent render
  // and would cause a redundant effect that, combined with React 18's
  // strict double-invocation, can blank the page on rapid toggles).
  useEffect(() => {
    if (!editing) {
      setDraftName(tool.name);
      setDraftDescription(customDescription);
      setDraftPrompt(tool.prompt);
    }
  }, [editing, tool.name, tool.prompt, customDescription]);

  if (tool.kind !== "custom") return null;

  return (
    <div className="rounded-lg border border-border bg-bg p-3 space-y-2">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Enable ${tool.name}`}
          className="mt-1 size-4 cursor-pointer accent-primary"
          checked={tool.enabled}
          onChange={(e) => setEnabled(tool.id, e.target.checked)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{tool.name}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-fg bg-muted px-1.5 py-0.5 rounded">
              Custom
            </span>
          </div>
          {tool.description && (
            <p className="text-xs text-muted-fg mt-0.5">{tool.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ProjectInitCheckbox toolId={tool.id} />
          <Button
            size="xs"
            intent="outline"
            onPress={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            size="xs"
            intent="danger"
            onPress={() => {
              if (
                typeof window !== "undefined" &&
                !window.confirm(`Delete custom tool "${tool.name}"?`)
              ) {
                return;
              }
              removeCustomTool(tool.id);
            }}
          >
            Delete
          </Button>
        </div>
      </div>
      {editing && (
        <div className="space-y-2 pt-2 border-t border-border/50">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-fg">Name</label>
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-fg">
              Description (optional)
            </label>
            <Input
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-fg">
              Prompt sent to the agent
            </label>
            <Textarea
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              rows={8}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="xs"
              intent="outline"
              onPress={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              onPress={() => {
                upsertCustomTool({
                  id: tool.id,
                  name: draftName.trim() || "Untitled tool",
                  description: draftDescription.trim() || undefined,
                  prompt: draftPrompt,
                });
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddCustomTool() {
  const upsertCustomTool = useToolsStore((s) => s.upsertCustomTool);
  const tools = useResolvedTools();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");

  if (!open) {
    return (
      <Button
        intent="outline"
        size="sm"
        onPress={() => setOpen(true)}
      >
        + Add custom tool
      </Button>
    );
  }

  const reset = () => {
    setOpen(false);
    setName("");
    setDescription("");
    setPrompt("");
  };

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-fg">Name</label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Run tests"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-fg">
          Description (optional)
        </label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Run all unit tests and report any failures"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-fg">Prompt</label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          placeholder="What should the agent do when this tool is invoked?"
          className="font-mono text-xs"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button intent="outline" size="xs" onPress={reset}>
          Cancel
        </Button>
        <Button
          size="xs"
          isDisabled={!name.trim() || !prompt.trim()}
          onPress={() => {
            const taken = new Set(tools.map((t) => t.id));
            const id = makeCustomId(name, taken);
            upsertCustomTool({
              id,
              name: name.trim(),
              description: description.trim() || undefined,
              prompt,
            });
            reset();
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function ProjectInitOrderingSection({ tools }: { tools: ResolvedTool[] }) {
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const reorderProjectInit = useToolsStore((s) => s.reorderProjectInit);
  const dragSourceIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const orderedInitTools = useMemo(() => {
    const byId = new Map(tools.map((t) => [t.id, t]));
    return projectInitOrder
      .map((id) => byId.get(id))
      .filter((t): t is ResolvedTool => Boolean(t));
  }, [projectInitOrder, tools]);

  if (orderedInitTools.length === 0) return null;

  const handleDrop = (targetId: string) => {
    const sourceId = dragSourceIdRef.current;
    dragSourceIdRef.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const order = projectInitOrder.slice();
    const from = order.indexOf(sourceId);
    const to = order.indexOf(targetId);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, sourceId);
    reorderProjectInit(order);
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-fg">
        Project init template ordering
      </h4>
      <p className="text-xs text-muted-fg">
        Drag to reorder. When you create a new project, these templates
        are pre-checked in the create-project modal and concatenated in
        this order as the new session's first auto-prompt.
      </p>
      <div className="space-y-1">
        {orderedInitTools.map((tool) => {
          const isDragOver = dragOverId === tool.id;
          return (
            <div
              key={tool.id}
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
              className={`flex items-center gap-2 rounded-md border border-border bg-bg/60 px-2 py-1.5 text-sm cursor-grab active:cursor-grabbing ${
                isDragOver ? "bg-primary/10 border-primary/40" : ""
              }`}
            >
              <Bars3Icon className="size-4 text-muted-fg shrink-0" />
              <span className="flex-1 min-w-0 truncate">{tool.name}</span>
              {!tool.enabled && (
                <span className="text-[10px] uppercase tracking-wide text-muted-fg">
                  disabled
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ToolsSettings() {
  const tools = useResolvedTools();

  const systemTools = tools.filter((t) => t.kind === "system");
  const customTools = tools.filter((t) => t.kind === "custom");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Tools</h3>
        <p className="text-xs text-muted-fg">
          Tools appear in the topbar action menu. Disable any you don't want
          to see; edit a system tool's prompt to customise it (your edit
          survives future updates and you can hit Reset to restore the
          shipped version). Add your own prompt templates with the button
          at the bottom. Use the <strong>Init</strong> checkbox on any
          template to mark it as a project-init template.
        </p>
      </div>

      <ProjectInitOrderingSection tools={tools} />

      <div className="space-y-2">
        {systemTools.map((tool) => (
          <SystemToolRow key={tool.id} tool={tool} />
        ))}
      </div>

      {customTools.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-fg">
            Your custom tools
          </h4>
          {customTools.map((tool) => (
            <CustomToolRow key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      <AddCustomTool />
    </div>
  );
}
