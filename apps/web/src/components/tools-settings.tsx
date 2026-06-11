import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { TEMPLATE_ICONS, templateIconFor } from "@/lib/template-icons";
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
  const outsideBurgerIds = useToolsStore((s) => s.outsideBurgerIds);
  const iconOverrides = useToolsStore((s) => s.iconOverrides);
  const systemOverrides = useToolsStore((s) => s.systemOverrides);
  const customTools = useToolsStore((s) => s.customTools);
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const defaultOnInitIds = useToolsStore((s) => s.defaultOnInitIds);
  const slashCommandIds = useToolsStore((s) => s.slashCommandIds);
  return useMemo(
    () =>
      resolveToolsFromState({
        disabledIds,
        burgerHiddenIds,
        outsideBurgerIds,
        iconOverrides,
        systemOverrides,
        customTools,
        projectInitOrder,
        defaultOnInitIds,
        slashCommandIds,
      }),
    [
      disabledIds,
      burgerHiddenIds,
      outsideBurgerIds,
      iconOverrides,
      systemOverrides,
      customTools,
      projectInitOrder,
      defaultOnInitIds,
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
      .slice(0, 40) || "template";
  const id = `custom.${base}`;
  if (!taken.has(id)) return id;
  return `custom.${base}-${Date.now().toString(36)}`;
}

const FLAG_HELP = {
  burger: "Visible in the topbar templates menu.",
  init: "Shown in the new-session template list.",
  defaultOn:
    "Pre-checked when the new-session template list opens. You can still uncheck it for that session.",
  slash:
    "Available in composer slash autocomplete as /template <name>; accepting it inserts the template body.",
  outside:
    "Promoted out of the hamburger into the title bar as its own desktop icon button.",
};

// Inline checkbox used in compact template flag groups. The custom
// group-hover tooltip appears instantly; native title tooltips wait too
// long and do not match the rest of OpenPortal's overlay styling.
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
      className={`group relative flex w-20 items-center gap-1 text-[11px] tracking-wide text-muted-fg ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
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
      <span>{label}</span>
      {/* Desktop-only: revealed on hover/focus at sm+. On mobile a tap
          focuses the checkbox, which would latch the tooltip open and
          cover adjacent rows, so it stays hidden below sm. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-64 rounded-md border border-(--tooltip-border) [--tooltip-border:var(--color-muted-fg)]/30 bg-overlay px-2 py-1 text-xs normal-case tracking-normal text-overlay-fg shadow-md sm:group-hover:block sm:group-focus-within:block"
      >
        {title}
      </span>
    </label>
  );
}

function TemplateTitleBlock({
  name,
  description,
  badge,
  scope,
  className = "",
}: {
  name: string;
  description?: string;
  badge?: ReactNode;
  scope?: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 flex-1 px-2 ${className}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-sm">{name}</span>
        {scope && (
          <span className="text-[10px] text-muted-fg/70 font-mono">
            {scope}
          </span>
        )}
        {badge}
      </div>
      {description && (
        <p className="text-xs text-muted-fg mt-0.5">{description}</p>
      )}
    </div>
  );
}

function TemplateIconPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (iconId: string | null) => void;
}) {
  const Current = templateIconFor(value);
  return (
    <Select
      selectedKey={value ?? "__default__"}
      onSelectionChange={(k) =>
        onChange(k === "__default__" ? null : String(k))
      }
      aria-label="Title-bar icon"
      className="w-36 shrink-0"
    >
      <SelectTrigger>
        <span className="inline-flex items-center gap-1.5">
          <Current className="size-4" />
          <span className="text-xs">Icon</span>
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectLabel>Title-bar icon</SelectLabel>
        <SelectItem id="__default__" textValue="Default">
          <span className="inline-flex items-center gap-2">
            {(() => {
              const D = templateIconFor(undefined);
              return <D className="size-4" />;
            })()}
            Default
          </span>
        </SelectItem>
        {TEMPLATE_ICONS.map((entry) => (
          <SelectItem key={entry.id} id={entry.id} textValue={entry.label}>
            <span className="inline-flex items-center gap-2">
              <entry.Icon className="size-4" />
              {entry.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  const toggleDefaultOnInit = useToolsStore((s) => s.toggleDefaultOnInit);
  const toggleSlashCommand = useToolsStore((s) => s.toggleSlashCommand);
  const setOutsideBurger = useToolsStore((s) => s.setOutsideBurger);
  const setTemplateIcon = useToolsStore((s) => s.setTemplateIcon);
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
      <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap sm:items-center">
        <Bars3Icon
          className={`size-4 shrink-0 mt-1 sm:mt-0 ${
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
        <div className="flex shrink-0 items-start gap-3">
          <div className="space-y-1">
            <FlagCheckbox
              label="Burger"
              title={FLAG_HELP.burger}
              checked={tool.isInBurger && !isDisabled}
              disabled={isDisabled}
              onChange={(next) => setBurgerVisible(tool.id, next)}
            />
            <FlagCheckbox
              label="Outside"
              title={FLAG_HELP.outside}
              checked={tool.isOutsideBurger && !isDisabled}
              disabled={isDisabled}
              onChange={(next) => setOutsideBurger(tool.id, next)}
            />
          </div>
          <div className="space-y-1">
            <FlagCheckbox
              label="Init"
              title={FLAG_HELP.init}
              checked={tool.isInit && !isDisabled}
              disabled={isDisabled}
              onChange={(next) => toggleProjectInit(tool.id, next)}
            />
            <FlagCheckbox
              label="Default on"
              title={FLAG_HELP.defaultOn}
              checked={tool.isDefaultOn && tool.isInit && !isDisabled}
              disabled={isDisabled || !tool.isInit}
              onChange={(next) => toggleDefaultOnInit(tool.id, next)}
            />
          </div>
          <FlagCheckbox
            label="Slash"
            title={FLAG_HELP.slash}
            checked={tool.isSlash && !isDisabled}
            disabled={isDisabled}
            onChange={(next) => toggleSlashCommand(tool.id, next)}
          />
        </div>
        {tool.isOutsideBurger && !isDisabled && (
          <TemplateIconPicker
            value={tool.iconId}
            onChange={(ic) => setTemplateIcon(tool.id, ic)}
          />
        )}
        <TemplateTitleBlock
          className="hidden sm:block"
          name={tool.name}
          description={tool.description}
          badge={
            tool.isOverridden ? (
              <span className="text-[10px] uppercase tracking-wide text-warning-subtle-fg bg-warning-subtle px-1.5 py-0.5 rounded">
                Edited
              </span>
            ) : null
          }
        />
        <div className="flex items-center gap-1 shrink-0 ml-auto">
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
      <TemplateTitleBlock
        className="sm:hidden"
        name={tool.name}
        description={tool.description}
        badge={
          tool.isOverridden ? (
            <span className="text-[10px] uppercase tracking-wide text-warning-subtle-fg bg-warning-subtle px-1.5 py-0.5 rounded">
              Edited
            </span>
          ) : null
        }
      />
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
  const toggleDefaultOnInit = useToolsStore((s) => s.toggleDefaultOnInit);
  const toggleSlashCommand = useToolsStore((s) => s.toggleSlashCommand);
  const setOutsideBurger = useToolsStore((s) => s.setOutsideBurger);
  const setTemplateIcon = useToolsStore((s) => s.setTemplateIcon);
  const upsertCustomTool = useToolsStore((s) => s.upsertCustomTool);
  const removeCustomTool = useToolsStore((s) => s.removeCustomTool);

  const customDescription =
    tool.kind === "custom" ? (tool.description ?? "") : "";

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(tool.name);
  const [draftDescription, setDraftDescription] = useState(customDescription);
  const [draftPrompt, setDraftPrompt] = useState(tool.prompt);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

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
      <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap sm:items-center">
        <Bars3Icon
          className={`size-4 shrink-0 mt-1 sm:mt-0 ${
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
        <div className="flex shrink-0 items-start gap-3">
          <div className="space-y-1">
            <FlagCheckbox
              label="Burger"
              title={FLAG_HELP.burger}
              checked={tool.isInBurger}
              onChange={(next) => setBurgerVisible(tool.id, next)}
            />
            <FlagCheckbox
              label="Outside"
              title={FLAG_HELP.outside}
              checked={tool.isOutsideBurger}
              onChange={(next) => setOutsideBurger(tool.id, next)}
            />
          </div>
          <div className="space-y-1">
            <FlagCheckbox
              label="Init"
              title={FLAG_HELP.init}
              checked={tool.isInit}
              onChange={(next) => toggleProjectInit(tool.id, next)}
            />
            <FlagCheckbox
              label="Default on"
              title={FLAG_HELP.defaultOn}
              checked={tool.isDefaultOn && tool.isInit}
              disabled={!tool.isInit}
              onChange={(next) => toggleDefaultOnInit(tool.id, next)}
            />
          </div>
          <FlagCheckbox
            label="Slash"
            title={FLAG_HELP.slash}
            checked={tool.isSlash}
            onChange={(next) => toggleSlashCommand(tool.id, next)}
          />
        </div>
        {tool.isOutsideBurger && (
          <TemplateIconPicker
            value={tool.iconId}
            onChange={(ic) => setTemplateIcon(tool.id, ic)}
          />
        )}
        <TemplateTitleBlock
          className="hidden sm:block"
          name={tool.name}
          description={tool.description}
        />
        <div className="flex items-center gap-1 shrink-0 ml-auto">
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
            onPress={() => setDeleteConfirmOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>
      <TemplateTitleBlock
        className="sm:hidden"
        name={tool.name}
        description={tool.description}
      />
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
                  name: draftName.trim() || "Untitled template",
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
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title={`Delete custom template "${tool.name}"?`}
        description="This removes the template from localStorage. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          removeCustomTool(tool.id);
          setDeleteConfirmOpen(false);
        }}
        onClose={() => setDeleteConfirmOpen(false)}
      />
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
    defaultOn?: boolean;
    slash?: boolean;
  };
  onCreated?: () => void;
} = {}) {
  const upsertCustomTool = useToolsStore((s) => s.upsertCustomTool);
  const setBurgerVisible = useToolsStore((s) => s.setBurgerVisible);
  const toggleProjectInit = useToolsStore((s) => s.toggleProjectInit);
  const toggleDefaultOnInit = useToolsStore((s) => s.toggleDefaultOnInit);
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
  const [defaultOn, setDefaultOn] = useState(
    initialValues?.defaultOn ?? initialValues?.init ?? false,
  );
  const [slash, setSlash] = useState(initialValues?.slash ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initialValues) return;
    setOpen(true);
    setName(initialValues.name ?? "");
    setDescription(initialValues.description ?? "");
    setPrompt(initialValues.prompt ?? "");
    setBurger(initialValues.burger ?? true);
    setInit(initialValues.init ?? false);
    setDefaultOn(initialValues.defaultOn ?? initialValues.init ?? false);
    setSlash(initialValues.slash ?? false);
    setError(null);
  }, [initialValues]);

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
    setDefaultOn(false);
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
      if (init) {
        toggleProjectInit(id, true);
        if (defaultOn) toggleDefaultOnInit(id, true);
      }
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
        <div className="flex items-start gap-3">
          <FlagCheckbox
            label="Burger"
            title={FLAG_HELP.burger}
            checked={burger}
            onChange={setBurger}
          />
          <div className="space-y-1">
            <FlagCheckbox
              label="Init"
              title={FLAG_HELP.init}
              checked={init}
              onChange={(next) => {
                setInit(next);
                if (!next) setDefaultOn(false);
              }}
            />
            <FlagCheckbox
              label="Default on"
              title={FLAG_HELP.defaultOn}
              checked={defaultOn && init}
              disabled={!init}
              onChange={setDefaultOn}
            />
          </div>
          <FlagCheckbox
            label="Slash"
            title={FLAG_HELP.slash}
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

// Row order MUST NOT derive from projectInitOrder: toggling Init mutates
// it, which made rows jump mid-click (AGENTS.md "List stability under
// inline toggles"). Order is frozen in state, reseeded only on add/remove.
function useStableRowOrder(
  list: ResolvedTool[],
  alpha: boolean,
): {
  rows: ResolvedTool[];
  orderIds: string[];
  setOrderIds: (ids: string[]) => void;
} {
  const byId = useMemo(
    () => new Map(list.map((t) => [t.id, t] as const)),
    [list],
  );
  const seedIds = useMemo(() => {
    const arr = alpha
      ? [...list].sort((a, b) => a.name.localeCompare(b.name))
      : list;
    return arr.map((t) => t.id);
  }, [list, alpha]);
  // Changes on add/remove only, not on flag toggle (same id set).
  const idsKey = useMemo(
    () => [...byId.keys()].sort().join(" "),
    [byId],
  );
  const [orderIds, setOrderIds] = useState<string[]>(seedIds);
  useEffect(() => {
    setOrderIds((prev) => {
      const present = new Set(byId.keys());
      const kept = prev.filter((id) => present.has(id));
      const keptSet = new Set(kept);
      const added = seedIds.filter((id) => !keptSet.has(id));
      const next = [...kept, ...added];
      const same =
        next.length === prev.length && next.every((id, i) => id === prev[i]);
      return same ? prev : next;
    });
    // Intentionally keyed on membership only - see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  const rows = useMemo(
    () =>
      orderIds
        .map((id) => byId.get(id))
        .filter((t): t is ResolvedTool => Boolean(t)),
    [orderIds, byId],
  );
  return { rows, orderIds, setOrderIds };
}

function UnifiedToolList({ tools }: { tools: ResolvedTool[] }) {
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const reorderProjectInit = useToolsStore((s) => s.reorderProjectInit);

  const systemTools = useMemo(
    () => tools.filter((t) => t.kind === "system"),
    [tools],
  );
  const customTools = useMemo(
    () => tools.filter((t) => t.kind === "custom"),
    [tools],
  );

  const sortedSystem = useStableRowOrder(systemTools, true);
  const sortedCustom = useStableRowOrder(customTools, true);

  const dragSourceIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Drag is the only allowed reorder gesture: it moves the visual row and
  // rewrites projectInitOrder (the prompt concatenation order) to match.
  const handleDrop = (targetId: string) => {
    const sourceId = dragSourceIdRef.current;
    dragSourceIdRef.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const moveWithin = (ids: string[]): string[] | null => {
      const fromIdx = ids.indexOf(sourceId);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return null;
      const next = ids.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    };
    const nextSystem = moveWithin(sortedSystem.orderIds);
    if (nextSystem) sortedSystem.setOrderIds(nextSystem);
    const nextCustom = moveWithin(sortedCustom.orderIds);
    if (nextCustom) sortedCustom.setOrderIds(nextCustom);
    const initSet = new Set(projectInitOrder);
    const systemIds = nextSystem ?? sortedSystem.orderIds;
    const customIds = nextCustom ?? sortedCustom.orderIds;
    reorderProjectInit([
      ...systemIds.filter((id) => initSet.has(id)),
      ...customIds.filter((id) => initSet.has(id)),
    ]);
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
        <div className="space-y-1.5">{sortedSystem.rows.map(renderRow)}</div>
      </section>
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Your templates - global</h3>
          <p className="text-xs text-muted-fg">
            Templates you create live in this browser&apos;s localStorage.
            Mark Init to drag-reorder; mark Slash to register a{" "}
            <code>/template &lt;name&gt;</code> autocomplete entry in
            composers.
          </p>
        </div>
        <div className="space-y-1.5">
          {sortedCustom.rows.length === 0 ? (
            <p className="text-xs italic text-muted-fg/70">
              No custom templates yet. Use the &quot;+ Add custom
              template&quot; button at the bottom.
            </p>
          ) : (
            sortedCustom.rows.map(renderRow)
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
    field: "enabled" | "init" | "defaultOn" | "slash",
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
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
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
      <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap sm:items-center">
        <div className="flex shrink-0 items-start gap-3">
          <FlagCheckbox
            label="Burger"
            title={FLAG_HELP.burger}
            checked={template.enabled}
            onChange={(v) => void onToggle("enabled", v)}
          />
          <div className="space-y-1">
            <FlagCheckbox
              label="Init"
              title={FLAG_HELP.init}
              checked={template.init}
              onChange={(v) => void onToggle("init", v)}
            />
            <FlagCheckbox
              label="Default on"
              title={FLAG_HELP.defaultOn}
              checked={template.defaultOn && template.init}
              disabled={!template.init}
              onChange={(v) => void onToggle("defaultOn", v)}
            />
          </div>
          <FlagCheckbox
            label="Slash"
            title={FLAG_HELP.slash}
            checked={template.slash}
            onChange={(v) => void onToggle("slash", v)}
          />
        </div>
        <TemplateTitleBlock
          className="hidden sm:block"
          name={template.name}
          description={template.description}
          scope={template.scope}
        />
        <div className="flex items-center gap-1 shrink-0 ml-auto">
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
            onPress={() => setDeleteConfirmOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>
      <TemplateTitleBlock
        className="sm:hidden"
        name={template.name}
        description={template.description}
        scope={template.scope}
      />
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
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title={`Delete filesystem template "${template.name}"?`}
        description={
          <div className="space-y-2 text-sm text-muted-fg">
            <p>This removes the template file from disk.</p>
            <p className="font-mono text-xs break-all">{template.location}</p>
          </div>
        }
        confirmLabel="Delete"
        tone="danger"
        busy={deleting}
        onConfirm={async () => {
          setDeleting(true);
          setError(null);
          try {
            await onDelete();
            setDeleteConfirmOpen(false);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to delete");
          } finally {
            setDeleting(false);
          }
        }}
        onClose={() => {
          if (!deleting) setDeleteConfirmOpen(false);
        }}
      />
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
    defaultOn?: boolean;
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
  const [defaultOn, setDefaultOn] = useState(
    initialValues?.defaultOn ?? initialValues?.init ?? false,
  );
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
        defaultOn: init && defaultOn,
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
          onSubmit={() => void submit()}
          entries={[]}
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
        <div className="flex items-start gap-3">
          <FlagCheckbox
            label="Burger"
            title={FLAG_HELP.burger}
            checked={enabled}
            onChange={setEnabled}
          />
          <div className="space-y-1">
            <FlagCheckbox
              label="Init"
              title={FLAG_HELP.init}
              checked={init}
              onChange={(next) => {
                setInit(next);
                if (!next) setDefaultOn(false);
              }}
            />
            <FlagCheckbox
              label="Default on"
              title={FLAG_HELP.defaultOn}
              checked={defaultOn && init}
              disabled={!init}
              onChange={setDefaultOn}
            />
          </div>
          <FlagCheckbox
            label="Slash"
            title={FLAG_HELP.slash}
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
    field: "enabled" | "init" | "defaultOn" | "slash",
    next: boolean,
  ) => {
    await writeFsTemplate({
      location: template.location,
      name: template.name,
      description: template.description,
      enabled: field === "enabled" ? next : template.enabled,
      init: field === "init" ? next : template.init,
      defaultOn:
        field === "init"
          ? next && template.defaultOn
          : field === "defaultOn"
            ? next
            : template.defaultOn,
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
      defaultOn: template.defaultOn,
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
            >
              {rescanning ? "Rescanning…" : "Refresh"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-fg">
          Templates stored next to your code at{" "}
          <code>&lt;workspace&gt;/&lt;…&gt;/.vibekick/templates/&lt;slug&gt;.md</code>.
          Each file&apos;s YAML frontmatter carries its flags (burger /
          init / defaultOn / slash) and ordering. The backend caches the scan in
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
                  defaultOn: duplicateSource.defaultOn,
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
          Templates can appear in the topbar menu, the new-session picker,
          and composer slash autocomplete. These flags control where each
          template shows up:
        </p>
        <ul className="text-xs text-muted-fg list-disc pl-5 space-y-0.5">
          <li>
            <strong>Burger</strong> - visible in the topbar templates menu.
          </li>
          <li>
            <strong>Init</strong> - shown in the new-session template list.
            Checked rows are prepended (in drag order below) to the first
            prompt on submit.
          </li>
          <li>
            <strong>Default on</strong> - pre-checked when the new-session
            template list opens. You can still uncheck it for that session.
          </li>
          <li>
            <strong>Slash</strong> - appears in the composer
            &quot;/&quot; autocomplete as <code>/template Full name</code>.
            Accepting it replaces the token with the template body.
          </li>
          <li>
            <strong>Outside</strong> - promoted out of the hamburger into
            the title bar as its own icon button (desktop, session routes).
            Pick the icon with the selector that appears when enabled.
          </li>
        </ul>
        <p className="text-xs text-muted-fg">
          Edit a system template&apos;s prompt to customise it - your edit
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
