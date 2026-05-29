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

function FsTemplatesSection() {
  const { data, isLoading, isValidating, error } = useAllFsTemplates();
  const [creating, setCreating] = useState(false);

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
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Your templates - filesystem</h3>
          {isValidating && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-fg/80">
              <Loader className="size-3" />
              Rescanning files…
            </span>
          )}
        </div>
        <p className="text-xs text-muted-fg">
          Templates stored next to your code at{" "}
          <code>&lt;workspace&gt;/&lt;…&gt;/.vibekick/templates/&lt;slug&gt;.md</code>.
          Each file&apos;s YAML frontmatter carries its flags (burger /
          init / slash) and ordering. Toggle a checkbox to rewrite the
          YAML. New-session pickers and the slash autocomplete show
          templates whose directory is current or a parent of the
          active project, up to the workspace root.
        </p>
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
                />
              ))}
            </div>
          </div>
        );
      })}

      {creating ? (
        <NewFsTemplateForm
          workspaces={workspaces}
          onClose={() => setCreating(false)}
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
