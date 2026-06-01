import { useEffect, useMemo, useRef, useState } from "react";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import {
  PathInput,
  type PathInputEntry,
  type PathInputHandle,
} from "@/components/ui/path-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { splitInput } from "@/lib/path-utils";
import {
  resolveToolsFromState,
  useToolsStore,
  type ResolvedTool,
} from "@/stores/tools-store";
import {
  deleteFsTemplate,
  forceRescanFsTemplates,
  templateBasenameForName,
  useAllFsTemplates,
  writeFsTemplate,
  type FsTemplate,
} from "@/hooks/use-vibekick-templates";

function useResolvedTools(): ResolvedTool[] {
  const disabledIds = useToolsStore((s) => s.disabledIds);
  const burgerHiddenIds = useToolsStore((s) => s.burgerHiddenIds);
  const systemOverrides = useToolsStore((s) => s.systemOverrides);
  const customTools = useToolsStore((s) => s.customTools);
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const slashCommandIds = useToolsStore((s) => s.slashCommandIds);
  return useMemo(
    () =>
      resolveToolsFromState({
        disabledIds,
        burgerHiddenIds,
        systemOverrides,
        customTools,
        projectInitOrder,
        slashCommandIds,
      }),
    [
      disabledIds,
      burgerHiddenIds,
      systemOverrides,
      customTools,
      projectInitOrder,
      slashCommandIds,
    ],
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
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`inline-flex w-14 items-center gap-1 text-[10px] uppercase tracking-wide text-muted-fg ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
      title={title}
    >
      <input
        type="checkbox"
        className={`size-4 accent-primary ${
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        }`}
        checked={checked}
        disabled={disabled}
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
  const setBurgerVisible = useToolsStore((s) => s.setBurgerVisible);
  const setFullyDisabled = useToolsStore((s) => s.setFullyDisabled);
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

  const isDisabled = tool.isDisabled;

  return (
    <div
      draggable={draggable && !isDisabled}
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
      } ${isDisabled ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-2">
        <Bars3Icon
          className={`size-4 shrink-0 ${
            draggable && !isDisabled
              ? "text-muted-fg cursor-grab active:cursor-grabbing"
              : "text-muted-fg/30"
          }`}
          title={
            isDisabled
              ? "Re-enable this template to drag-reorder"
              : draggable
                ? "Drag to reorder among init templates"
                : "Mark as Init to enable drag-reorder"
          }
        />
        <FlagCheckbox
          label="Burger"
          title="Show in the topbar Tools (burger) menu"
          checked={tool.isInBurger && !isDisabled}
          disabled={isDisabled}
          onChange={(next) => setBurgerVisible(tool.id, next)}
        />
        <FlagCheckbox
          label="Init"
          title="Pre-checked in the new-session picker"
          checked={tool.isInit && !isDisabled}
          disabled={isDisabled}
          onChange={(next) => toggleProjectInit(tool.id, next)}
        />
        <FlagCheckbox
          label="Slash"
          title="Available as /template <name> slash command in composers"
          checked={tool.isSlash && !isDisabled}
          disabled={isDisabled}
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
            isDisabled={isDisabled}
            onPress={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            size="xs"
            intent="outline"
            onPress={() => setFullyDisabled(tool.id, !isDisabled)}
          >
            {isDisabled ? "Enable" : "Disable"}
          </Button>
          {tool.isOverridden && !isDisabled && (
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
      {editing && !isDisabled && (
        <div className="space-y-2 pt-2 border-t border-border/50">
          <div className="flex items-start gap-3">
            <label className="text-xs font-medium text-muted-fg w-32 shrink-0 pt-2">
              Display name
            </label>
            <Input
              className="flex-1"
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
  const setBurgerVisible = useToolsStore((s) => s.setBurgerVisible);
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
          label="Burger"
          title="Show in the topbar Tools (burger) menu"
          checked={tool.isInBurger}
          onChange={(next) => setBurgerVisible(tool.id, next)}
        />
        <FlagCheckbox
          label="Init"
          title="Pre-checked in the new-session picker"
          checked={tool.isInit}
          onChange={(next) => toggleProjectInit(tool.id, next)}
        />
        <FlagCheckbox
          label="Slash"
          title="Available as /template <name> slash command in composers"
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

function AddCustomTool({
  initialValues,
  onCreated,
}: {
  initialValues?: {
    name?: string;
    description?: string;
    prompt?: string;
    burger?: boolean;
    init?: boolean;
    slash?: boolean;
  };
  onCreated?: () => void;
} = {}) {
  const upsertCustomTool = useToolsStore((s) => s.upsertCustomTool);
  const setBurgerVisible = useToolsStore((s) => s.setBurgerVisible);
  const toggleProjectInit = useToolsStore((s) => s.toggleProjectInit);
  const toggleSlashCommand = useToolsStore((s) => s.toggleSlashCommand);
  const tools = useResolvedTools();
  const [open, setOpen] = useState(Boolean(initialValues));
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(
    initialValues?.description ?? "",
  );
  const [prompt, setPrompt] = useState(initialValues?.prompt ?? "");
  const [burger, setBurger] = useState(initialValues?.burger ?? true);
  const [init, setInit] = useState(initialValues?.init ?? false);
  const [slash, setSlash] = useState(initialValues?.slash ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <Button intent="outline" size="sm" onPress={() => setOpen(true)}>
        + Add custom template
      </Button>
    );
  }

  const reset = () => {
    setOpen(false);
    setName("");
    setDescription("");
    setPrompt("");
    setBurger(true);
    setInit(false);
    setSlash(false);
    setError(null);
  };
  const onClose = reset;

  const submit = () => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!prompt.trim()) {
      setError("Prompt is required");
      return;
    }
    setSaving(true);
    try {
      const takenIds = new Set(tools.map((t) => t.id));
      const id = makeCustomId(name, takenIds);
      upsertCustomTool({
        id,
        name: name.trim(),
        description: description.trim() || undefined,
        prompt,
      });
      if (!burger) setBurgerVisible(id, false);
      if (init) toggleProjectInit(id, true);
      if (slash) toggleSlashCommand(id, true);
      reset();
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create template");
    } finally {
      setSaving(false);
    }
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
          placeholder="What should the agent do when this template is invoked?"
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-muted-fg w-32 shrink-0">
          Flags
        </span>
        <div className="flex items-center gap-2">
          <FlagCheckbox
            label="Burger"
            title="Show in the topbar Tools (burger) menu (YAML enabled)"
            checked={burger}
            onChange={setBurger}
          />
          <FlagCheckbox
            label="Init"
            title="Pre-checked in the new-session picker"
            checked={init}
            onChange={setInit}
          />
          <FlagCheckbox
            label="Slash"
            title="Available as /template <name> in composers"
            checked={slash}
            onChange={setSlash}
          />
        </div>
      </div>
      {error && <p className="text-xs text-danger-fg">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          intent="outline"
          size="xs"
          onPress={onClose}
          isDisabled={saving}
        >
          Cancel
        </Button>
        <Button
          size="xs"
          isDisabled={saving || !name.trim() || !prompt.trim()}
          onPress={submit}
        >
          {saving ? "Saving..." : "Create"}
        </Button>
      </div>
    </div>
  );
}

function UnifiedToolList({ tools }: { tools: ResolvedTool[] }) {
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const reorderProjectInit = useToolsStore((s) => s.reorderProjectInit);

  const systemTools = tools.filter((t) => t.kind === "system");
  const customTools = tools.filter((t) => t.kind === "custom");

  const sortTools = (list: ResolvedTool[]): ResolvedTool[] => {
    const initIds = new Set(projectInitOrder);
    const initRows = projectInitOrder
      .map((id) => list.find((t) => t.id === id))
      .filter((t): t is ResolvedTool => Boolean(t));
    const otherRows = list
      .filter((t) => !initIds.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...initRows, ...otherRows];
  };

  const sortedSystem = sortTools(systemTools);
  const sortedCustom = sortTools(customTools);

  const dragSourceIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDrop = (targetId: string) => {
    const sourceId = dragSourceIdRef.current;
    dragSourceIdRef.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const order = projectInitOrder.slice();
    const fromIdx = order.indexOf(sourceId);
    const toIdx = order.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);
    reorderProjectInit(order);
  };

  const renderRow = (tool: ResolvedTool) => {
    const isInit = projectInitOrder.includes(tool.id);
    const draggable = isInit && !tool.isDisabled;
    const props: ToolRowProps = {
      tool,
      draggable,
      isDragOver: dragOverId === tool.id,
      onDragStart: () => {
        if (draggable) dragSourceIdRef.current = tool.id;
      },
      onDragOver: (e) => {
        if (!dragSourceIdRef.current) return;
        if (!isInit) return;
        e.preventDefault();
        if (dragOverId !== tool.id) setDragOverId(tool.id);
      },
      onDragLeave: () => {
        if (dragOverId === tool.id) setDragOverId(null);
      },
      onDrop: () => handleDrop(tool.id),
      onDragEnd: () => {
        dragSourceIdRef.current = null;
        setDragOverId(null);
      },
    };
    return tool.kind === "system" ? (
      <SystemToolRow key={tool.id} {...props} />
    ) : (
      <CustomToolRow key={tool.id} {...props} />
    );
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">System templates</h3>
          <p className="text-xs text-muted-fg">
            Shipped by OpenPortal. Edit the prompt to customise -
            your edit survives future updates; hit Reset to restore
            the shipped version. Disable to hide everywhere.
          </p>
        </div>
        <div className="space-y-1.5">{sortedSystem.map(renderRow)}</div>
      </section>
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Your custom templates</h3>
          <p className="text-xs text-muted-fg">
            Templates you create live in this browser&apos;s localStorage.
            Mark Init to drag-reorder; mark Slash to register a{" "}
            <code>/template &lt;name&gt;</code> autocomplete entry in
            composers.
          </p>
        </div>
        <div className="space-y-1.5">
          {sortedCustom.length === 0 ? (
            <p className="text-xs italic text-muted-fg/70">
              No custom templates yet. Use the &quot;+ Add custom
              template&quot; button at the bottom.
            </p>
          ) : (
            sortedCustom.map(renderRow)
          )}
        </div>
      </section>
    </div>
  );
}

function FsTemplateRow({
  template,
  onToggle,
  onSaveEdit,
  onDelete,
  onDuplicate,
}: {
  template: FsTemplate;
  onToggle: (
    field: "enabled" | "init" | "slash",
    next: boolean,
  ) => Promise<void>;
  onSaveEdit: (next: {
    name: string;
    description: string;
    prompt: string;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
  onDuplicate?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(template.name);
  const [draftDescription, setDraftDescription] = useState(
    template.description ?? "",
  );
  const [draftPrompt, setDraftPrompt] = useState(template.prompt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraftName(template.name);
      setDraftDescription(template.description ?? "");
      setDraftPrompt(template.prompt);
      setError(null);
    }
  }, [editing, template.name, template.description, template.prompt]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSaveEdit({
        name: draftName.trim() || template.name,
        description: draftDescription.trim(),
        prompt: draftPrompt,
      });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-bg p-2 space-y-2">
      <div className="flex items-center gap-2">
        <FlagCheckbox
          label="Burger"
          title="Show in the topbar Tools menu (maps to YAML 'enabled')"
          checked={template.enabled}
          onChange={(v) => void onToggle("enabled", v)}
        />
        <FlagCheckbox
          label="Init"
          title="Pre-checked in the new-session picker"
          checked={template.init}
          onChange={(v) => void onToggle("init", v)}
        />
        <FlagCheckbox
          label="Slash"
          title="Available as /template <name> slash command in composers"
          checked={template.slash}
          onChange={(v) => void onToggle("slash", v)}
        />
        <div className="min-w-0 flex-1 px-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{template.name}</span>
            <span className="text-[10px] text-muted-fg/70 font-mono">
              {template.scope}
            </span>
          </div>
          {template.description && (
            <p className="text-xs text-muted-fg mt-0.5">
              {template.description}
            </p>
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
          {onDuplicate && (
            <Button size="xs" intent="outline" onPress={onDuplicate}>
              Duplicate
            </Button>
          )}
          <Button
            size="xs"
            intent="danger"
            onPress={() => {
              if (
                typeof window !== "undefined" &&
                !window.confirm(
                  `Delete filesystem template "${template.name}" at ${template.location}?`,
                )
              ) {
                return;
              }
              void onDelete();
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
            <label className="text-xs font-medium text-muted-fg">Prompt</label>
            <Textarea
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              rows={8}
            />
          </div>
          {error && <p className="text-xs text-danger-fg">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              size="xs"
              intent="outline"
              onPress={() => setEditing(false)}
              isDisabled={saving}
            >
              Cancel
            </Button>
            <Button size="xs" onPress={handleSave} isDisabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewFsTemplateForm({
  workspaces,
  onClose,
  initialValues,
}: {
  workspaces: string[];
  onClose: () => void;
  initialValues?: {
    workspace?: string;
    subpath?: string;
    name?: string;
    description?: string;
    prompt?: string;
    enabled?: boolean;
    init?: boolean;
    slash?: boolean;
  };
}) {
  const [workspace, setWorkspace] = useState(
    initialValues?.workspace ?? workspaces[0] ?? "",
  );
  const [subpath, setSubpath] = useState(initialValues?.subpath ?? "");
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(
    initialValues?.description ?? "",
  );
  const [prompt, setPrompt] = useState(initialValues?.prompt ?? "");
  const [enabled, setEnabled] = useState(initialValues?.enabled ?? true);
  const [init, setInit] = useState(initialValues?.init ?? false);
  const [slash, setSlash] = useState(initialValues?.slash ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!prompt.trim()) {
      setError("Prompt is required");
      return;
    }
    if (!workspace) {
      setError("Pick a workspace");
      return;
    }
    setSaving(true);
    try {
      const basename = templateBasenameForName(name);
      const cleanSubpath = subpath.replace(/^\/+/, "").replace(/\/+$/, "");
      const dir = cleanSubpath ? `${workspace}/${cleanSubpath}` : workspace;
      const location = `${dir}/.vibekick/templates/${basename}`;
      await writeFsTemplate({
        location,
        name: name.trim(),
        description: description.trim() || undefined,
        enabled,
        init,
        slash,
        order: 0,
        prompt,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-muted-fg w-32 shrink-0">
          Workspace
        </label>
        <Select
          selectedKey={workspace}
          onSelectionChange={(k) => setWorkspace(String(k))}
          className="flex-1"
        >
          <SelectTrigger>
            <span className="font-mono text-xs">{workspace || "(select)"}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectLabel>Configured workspace roots</SelectLabel>
            {workspaces.map((ws) => (
              <SelectItem key={ws} id={ws}>
                {ws}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-muted-fg w-32 shrink-0">
          Sub-path
        </label>
        <PathInput
          className="flex-1"
          value={subpath}
          onChange={setSubpath}
          placeholder="e.g. webapps/portal - empty for workspace root"
        />
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-muted-fg w-32 shrink-0">
          Name
        </label>
        <Input
          className="flex-1"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-muted-fg w-32 shrink-0">
          Description
        </label>
        <Input
          className="flex-1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-fg">Prompt</label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={8}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-muted-fg w-32 shrink-0">
          Flags
        </span>
        <div className="flex items-center gap-2">
          <FlagCheckbox
            label="Burger"
            title="Show in the topbar Tools (burger) menu (YAML enabled)"
            checked={enabled}
            onChange={setEnabled}
          />
          <FlagCheckbox
            label="Init"
            title="Pre-checked in the new-session picker"
            checked={init}
            onChange={setInit}
          />
          <FlagCheckbox
            label="Slash"
            title="Available as /template <name> in composers"
            checked={slash}
            onChange={setSlash}
          />
        </div>
      </div>
      {error && <p className="text-xs text-danger-fg">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          intent="outline"
          size="xs"
          onPress={onClose}
          isDisabled={saving}
        >
          Cancel
        </Button>
        <Button
          size="xs"
          isDisabled={saving || !name.trim() || !prompt.trim() || !workspace}
          onPress={() => void submit()}
        >
          {saving ? "Saving..." : "Create"}
        </Button>
      </div>
    </div>
  );
}

function FsTemplatesSection() {
  const { data, isLoading, isValidating, error } = useAllFsTemplates();
  const [creating, setCreating] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState<FsTemplate | null>(
    null,
  );
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);

  const handleRescan = async () => {
    setRescanning(true);
    setRescanError(null);
    try {
      await forceRescanFsTemplates();
    } catch (e) {
      setRescanError(
        e instanceof Error ? e.message : "Failed to rescan filesystem",
      );
    } finally {
      setRescanning(false);
    }
  };

  const workspaces = data?.workspaces ?? [];
  const templates = data?.templates ?? [];

  // Group templates by their workspace root so each section header
  // matches the workspace the templates live under. Sort within a
  // workspace by YAML order then scope path.
  const byWorkspace = useMemo(() => {
    const groups = new Map<string, FsTemplate[]>();
    for (const tpl of templates) {
      const list = groups.get(tpl.workspaceRoot) ?? [];
      list.push(tpl);
      groups.set(tpl.workspaceRoot, list);
    }
    for (const list of groups.values()) {
      list.sort(
        (a, b) => a.order - b.order || a.scope.localeCompare(b.scope),
      );
    }
    return groups;
  }, [templates]);

  const handleToggle = async (
    template: FsTemplate,
    field: "enabled" | "init" | "slash",
    next: boolean,
  ) => {
    await writeFsTemplate({
      location: template.location,
      name: template.name,
      description: template.description,
      enabled: field === "enabled" ? next : template.enabled,
      init: field === "init" ? next : template.init,
      slash: field === "slash" ? next : template.slash,
      order: template.order,
      prompt: template.prompt,
    });
  };

  const handleSaveEdit = async (
    template: FsTemplate,
    next: { name: string; description: string; prompt: string },
  ) => {
    await writeFsTemplate({
      location: template.location,
      name: next.name,
      description: next.description || undefined,
      enabled: template.enabled,
      init: template.init,
      slash: template.slash,
      order: template.order,
      prompt: next.prompt,
    });
  };

  return (
    <section className="space-y-3">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">Your templates - filesystem</h3>
          {(rescanning || isValidating) && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-fg/80">
              <Loader className="size-3" />
              {rescanning ? "Rescanning filesystem…" : "Refreshing…"}
            </span>
          )}
          <div className="ml-auto">
            <Button
              size="xs"
              intent="outline"
              isDisabled={rescanning}
              onPress={() => void handleRescan()}
              title="Force a fresh filesystem scan. Toggling flags does not need this - they update instantly via the in-memory snapshot. Use this if you edited a .md file on disk and want the change picked up before the 5-min periodic refresh."
            >
              {rescanning ? "Rescanning…" : "Refresh"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-fg">
          Templates stored next to your code at{" "}
          <code>&lt;workspace&gt;/&lt;…&gt;/.vibekick/templates/&lt;slug&gt;.md</code>.
          Each file&apos;s YAML frontmatter carries its flags (burger /
          init / slash) and ordering. The backend caches the scan in
          memory and rebuilds it every 5 minutes; flag toggles update
          the cache in place (no rescan). Hit Refresh to force a fresh
          disk scan now.
        </p>
        {rescanError && (
          <p className="text-xs text-danger-fg mt-1">{rescanError}</p>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-fg">
          <Loader className="size-4" />
          Scanning workspaces for .vibekick/templates/…
        </div>
      )}
      {error && (
        <p className="text-xs text-danger-fg">
          Failed to load filesystem templates:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </p>
      )}

      {!isLoading && templates.length === 0 && (
        <p className="text-xs text-muted-fg">
          No filesystem templates found. Add one below; it lands at
          the location you choose.
        </p>
      )}

      {workspaces.map((workspace) => {
        const list = byWorkspace.get(workspace) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={workspace} className="space-y-1">
            <h4 className="text-xs text-muted-fg/80 font-mono">
              {workspace}
            </h4>
            <div className="space-y-1.5">
              {list.map((tpl) => (
                <FsTemplateRow
                  key={tpl.id}
                  template={tpl}
                  onToggle={(field, next) =>
                    handleToggle(tpl, field, next)
                  }
                  onSaveEdit={(next) => handleSaveEdit(tpl, next)}
                  onDelete={() => deleteFsTemplate(tpl.location)}
                  onDuplicate={() => {
                    setCreating(false);
                    setDuplicateSource(tpl);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}

      {creating || duplicateSource ? (
        <NewFsTemplateForm
          workspaces={workspaces}
          onClose={() => {
            setCreating(false);
            setDuplicateSource(null);
          }}
          initialValues={
            duplicateSource
              ? {
                  workspace: duplicateSource.workspaceRoot,
                  subpath: duplicateSource.scope,
                  name: `${duplicateSource.name} (copy)`,
                  description: duplicateSource.description,
                  prompt: duplicateSource.prompt,
                  enabled: duplicateSource.enabled,
                  init: duplicateSource.init,
                  slash: duplicateSource.slash,
                }
              : undefined
          }
        />
      ) : (
        <Button
          intent="outline"
          size="sm"
          onPress={() => setCreating(true)}
        >
          + New filesystem template
        </Button>
      )}
    </section>
  );
}

export function ToolsSettings() {
  const tools = useResolvedTools();

  return (
    <div className="space-y-8">
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

      <FsTemplatesSection />

      <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-bg border-t border-border/40">
        <AddCustomTool />
      </div>
    </div>
  );
}
