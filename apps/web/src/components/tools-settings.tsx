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

function useResolvedTools(): ResolvedTool[] {
  const disabledIds = useToolsStore((s) => s.disabledIds);
  const systemOverrides = useToolsStore((s) => s.systemOverrides);
  const customTools = useToolsStore((s) => s.customTools);
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const slashCommandIds = useToolsStore((s) => s.slashCommandIds);
  return useMemo(
    () =>
      resolveToolsFromState({
        disabledIds,
        systemOverrides,
        customTools,
        projectInitOrder,
        slashCommandIds,
      }),
    [disabledIds, systemOverrides, customTools, projectInitOrder, slashCommandIds],
  );
}

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

// Inline checkbox cluster on the left side of every row. Three flags
// per template, three columns. Fixed widths keep the columns aligned
// vertically across rows regardless of tool name length.
function FlagCheckbox({
  label,
  checked,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
}) {
  return (
    <label
      className="inline-flex w-14 items-center gap-1 text-[10px] uppercase tracking-wide text-muted-fg cursor-pointer"
      title={title}
    >
      <input
        type="checkbox"
        className="size-4 cursor-pointer accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

interface ToolRowProps {
  tool: ResolvedTool;
  draggable: boolean;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function SystemToolRow({
  tool,
  draggable,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: ToolRowProps) {
  const setEnabled = useToolsStore((s) => s.setEnabled);
  const toggleProjectInit = useToolsStore((s) => s.toggleProjectInit);
  const toggleSlashCommand = useToolsStore((s) => s.toggleSlashCommand);
  const setSystemOverride = useToolsStore((s) => s.setSystemOverride);
  const resetSystemOverride = useToolsStore((s) => s.resetSystemOverride);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(tool.name);
  const [draftPrompt, setDraftPrompt] = useState(tool.prompt);

  useEffect(() => {
    if (!editing) {
      setDraftName(tool.name);
      setDraftPrompt(tool.prompt);
    }
  }, [editing, tool.name, tool.prompt]);

  if (tool.kind !== "system") return null;

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      className={`rounded-lg border border-border bg-bg p-2 space-y-2 ${
        isDragOver ? "border-primary/40 bg-primary/5" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <Bars3Icon
          className={`size-4 shrink-0 ${
            draggable
              ? "text-muted-fg cursor-grab active:cursor-grabbing"
              : "text-muted-fg/30"
          }`}
          title={
            draggable
              ? "Drag to reorder among init templates"
              : "Mark as Init to enable drag-reorder"
          }
        />
        <FlagCheckbox
          label="On"
          title="Enabled - appears in the topbar Tools menu"
          checked={tool.enabled}
          onChange={(next) => setEnabled(tool.id, next)}
        />
        <FlagCheckbox
          label="Init"
          title="Include in new-project init prompt"
          checked={tool.isInit}
          onChange={(next) => toggleProjectInit(tool.id, next)}
        />
        <FlagCheckbox
          label="Slash"
          title="Available as /<name> slash command in composers"
          checked={tool.isSlash}
          onChange={(next) => toggleSlashCommand(tool.id, next)}
        />
        <div className="min-w-0 flex-1 px-2">
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
          <Button
            size="xs"
            intent="outline"
            onPress={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            size="xs"
            intent="outline"
            onPress={() => setEnabled(tool.id, !tool.enabled)}
          >
            {tool.enabled ? "Disable" : "Enable"}
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
                  name:
                    draftName.trim() === tool.name
                      ? undefined
                      : draftName.trim(),
                  prompt:
                    draftPrompt === tool.prompt ? undefined : draftPrompt,
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

function CustomToolRow({
  tool,
  draggable,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: ToolRowProps) {
  const setEnabled = useToolsStore((s) => s.setEnabled);
  const toggleProjectInit = useToolsStore((s) => s.toggleProjectInit);
  const toggleSlashCommand = useToolsStore((s) => s.toggleSlashCommand);
  const upsertCustomTool = useToolsStore((s) => s.upsertCustomTool);
  const removeCustomTool = useToolsStore((s) => s.removeCustomTool);

  const customDescription =
    tool.kind === "custom" ? (tool.description ?? "") : "";

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(tool.name);
  const [draftDescription, setDraftDescription] = useState(customDescription);
  const [draftPrompt, setDraftPrompt] = useState(tool.prompt);

  useEffect(() => {
    if (!editing) {
      setDraftName(tool.name);
      setDraftDescription(customDescription);
      setDraftPrompt(tool.prompt);
    }
  }, [editing, tool.name, tool.prompt, customDescription]);

  if (tool.kind !== "custom") return null;

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      className={`rounded-lg border border-border bg-bg p-2 space-y-2 ${
        isDragOver ? "border-primary/40 bg-primary/5" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <Bars3Icon
          className={`size-4 shrink-0 ${
            draggable
              ? "text-muted-fg cursor-grab active:cursor-grabbing"
              : "text-muted-fg/30"
          }`}
          title={
            draggable
              ? "Drag to reorder among init templates"
              : "Mark as Init to enable drag-reorder"
          }
        />
        <FlagCheckbox
          label="On"
          title="Enabled - appears in the topbar Tools menu"
          checked={tool.enabled}
          onChange={(next) => setEnabled(tool.id, next)}
        />
        <FlagCheckbox
          label="Init"
          title="Include in new-project init prompt"
          checked={tool.isInit}
          onChange={(next) => toggleProjectInit(tool.id, next)}
        />
        <FlagCheckbox
          label="Slash"
          title="Available as /<name> slash command in composers"
          checked={tool.isSlash}
          onChange={(next) => toggleSlashCommand(tool.id, next)}
        />
        <div className="min-w-0 flex-1 px-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{tool.name}</span>
          </div>
          {tool.description && (
            <p className="text-xs text-muted-fg mt-0.5">{tool.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
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
      <Button intent="outline" size="sm" onPress={() => setOpen(true)}>
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

// One unified list of tools (system + custom). Drag-reorder is active
// ONLY for tools the user has marked as Init - that's the order that
// flows into the new-project init prompt. Non-init rows render the
// drag handle as a passive affordance so the user knows what's missing.
function UnifiedToolList({ tools }: { tools: ResolvedTool[] }) {
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const reorderProjectInit = useToolsStore((s) => s.reorderProjectInit);
  const dragSourceIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Init tools first (in their explicit projectInitOrder), then everyone
  // else alphabetically. Stock and custom tools coexist in this single
  // list - the section header for custom tools is gone.
  const ordered = useMemo(() => {
    const byId = new Map(tools.map((t) => [t.id, t]));
    const initSet = new Set(projectInitOrder);
    const initFirst = projectInitOrder
      .map((id) => byId.get(id))
      .filter((t): t is ResolvedTool => Boolean(t));
    const others = tools
      .filter((t) => !initSet.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...initFirst, ...others];
  }, [tools, projectInitOrder]);

  const handleDragStart = (id: string) => {
    dragSourceIdRef.current = id;
  };

  const handleDragOver = (id: string) => (e: React.DragEvent) => {
    const src = dragSourceIdRef.current;
    if (!src) return;
    if (!projectInitOrder.includes(src)) return;
    if (!projectInitOrder.includes(id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverId !== id) setDragOverId(id);
  };

  const handleDrop = (targetId: string) => {
    const sourceId = dragSourceIdRef.current;
    dragSourceIdRef.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    if (!projectInitOrder.includes(sourceId)) return;
    if (!projectInitOrder.includes(targetId)) return;
    const order = projectInitOrder.slice();
    const from = order.indexOf(sourceId);
    const to = order.indexOf(targetId);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, sourceId);
    reorderProjectInit(order);
  };

  const handleDragEnd = () => {
    dragSourceIdRef.current = null;
    setDragOverId(null);
  };

  return (
    <div className="space-y-2">
      {ordered.map((tool) => {
        const isInit = projectInitOrder.includes(tool.id);
        const props: ToolRowProps = {
          tool,
          draggable: isInit,
          isDragOver: dragOverId === tool.id,
          onDragStart: () => handleDragStart(tool.id),
          onDragOver: handleDragOver(tool.id),
          onDragLeave: () => {
            if (dragOverId === tool.id) setDragOverId(null);
          },
          onDrop: () => handleDrop(tool.id),
          onDragEnd: handleDragEnd,
        };
        if (tool.kind === "system") {
          return <SystemToolRow key={tool.id} {...props} />;
        }
        return <CustomToolRow key={tool.id} {...props} />;
      })}
    </div>
  );
}

export function ToolsSettings() {
  const tools = useResolvedTools();

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-xs text-muted-fg">
          Tools appear in the topbar action menu. Three flags per tool
          control where it shows up:
        </p>
        <ul className="text-xs text-muted-fg list-disc pl-5 space-y-0.5">
          <li>
            <strong>On</strong> — visible in the topbar Tools menu.
          </li>
          <li>
            <strong>Init</strong> — pre-checked in the create-project
            modal and concatenated (in drag order below) as the new
            session&apos;s first prompt.
          </li>
          <li>
            <strong>Slash</strong> — appears in the composer
            &quot;/&quot; autocomplete as <code>/template Full name</code>.
            Accepting it replaces the token with the template body.
          </li>
        </ul>
        <p className="text-xs text-muted-fg">
          Edit a system tool&apos;s prompt to customise it - your edit
          survives future updates and you can hit Reset to restore the
          shipped version. Add your own templates with the button at
          the bottom. Drag the handle on any Init-marked row to
          reorder the init prompt.
        </p>
      </section>

      <UnifiedToolList tools={tools} />

      <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-bg border-t border-border/40">
        <AddCustomTool />
      </div>
    </div>
  );
}
