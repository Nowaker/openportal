import { useEffect, useMemo, useRef, useState } from "react";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { Textarea } from "@/components/ui/textarea";
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

// Two-section tool list (system + "Your custom tools" with its own
// header). Drag-reorder happens INLINE in each section - one list per
// section, no separate ordering panel - and only for Init-marked rows
// (projectInitOrder is the durable concatenation order). Cross-section
// drag is allowed because projectInitOrder is one flat array;
// dragging a custom init row above a system init row reorders them
// in the eventual new-session prompt, even though the visual section
// they live in stays put.
function ToolSectionList({
  tools,
  projectInitOrder,
  onReorder,
  dragSourceIdRef,
  dragOverId,
  setDragOverId,
}: {
  tools: ResolvedTool[];
  projectInitOrder: string[];
  onReorder: (next: string[]) => void;
  dragSourceIdRef: React.RefObject<string | null>;
  dragOverId: string | null;
  setDragOverId: (id: string | null) => void;
}) {
  const initSet = useMemo(
    () => new Set(projectInitOrder),
    [projectInitOrder],
  );
  const ordered = useMemo(() => {
    const byId = new Map(tools.map((t) => [t.id, t]));
    const initFirst = projectInitOrder
      .map((id) => byId.get(id))
      .filter((t): t is ResolvedTool => Boolean(t));
    const others = tools
      .filter((t) => !initSet.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...initFirst, ...others];
  }, [tools, projectInitOrder, initSet]);

  const handleDragOver = (id: string) => (e: React.DragEvent) => {
    const src = dragSourceIdRef.current;
    if (!src) return;
    if (!initSet.has(src) || !initSet.has(id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverId !== id) setDragOverId(id);
  };

  const handleDrop = (targetId: string) => {
    const sourceId = dragSourceIdRef.current;
    dragSourceIdRef.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    if (!initSet.has(sourceId) || !initSet.has(targetId)) return;
    const order = projectInitOrder.slice();
    const from = order.indexOf(sourceId);
    const to = order.indexOf(targetId);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, sourceId);
    onReorder(order);
  };

  const handleDragEnd = () => {
    dragSourceIdRef.current = null;
    setDragOverId(null);
  };

  return (
    <div className="space-y-2">
      {ordered.map((tool) => {
        const isInit = initSet.has(tool.id);
        const props: ToolRowProps = {
          tool,
          draggable: isInit,
          isDragOver: dragOverId === tool.id,
          onDragStart: () => {
            dragSourceIdRef.current = tool.id;
          },
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

function UnifiedToolList({ tools }: { tools: ResolvedTool[] }) {
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const reorderProjectInit = useToolsStore((s) => s.reorderProjectInit);
  const dragSourceIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const systemTools = useMemo(
    () => tools.filter((t) => t.kind === "system"),
    [tools],
  );
  const customTools = useMemo(
    () => tools.filter((t) => t.kind === "custom"),
    [tools],
  );

  return (
    <div className="space-y-4">
      <ToolSectionList
        tools={systemTools}
        projectInitOrder={projectInitOrder}
        onReorder={reorderProjectInit}
        dragSourceIdRef={dragSourceIdRef}
        dragOverId={dragOverId}
        setDragOverId={setDragOverId}
      />
      {customTools.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-fg">
            Your custom tools
          </h4>
          <ToolSectionList
            tools={customTools}
            projectInitOrder={projectInitOrder}
            onReorder={reorderProjectInit}
            dragSourceIdRef={dragSourceIdRef}
            dragOverId={dragOverId}
            setDragOverId={setDragOverId}
          />
        </div>
      )}
    </div>
  );
}

function FsTemplateRow({
  template,
  onToggle,
  onDelete,
}: {
  template: FsTemplate;
  onToggle: (
    field: "enabled" | "init" | "slash",
    next: boolean,
  ) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const wrapToggle = (field: "enabled" | "init" | "slash") => async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await onToggle(field, next);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-border bg-bg p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <Bars3Icon
          className="size-4 shrink-0 text-muted-fg/30"
          title="Filesystem templates carry their `order` in YAML; drag-reorder lives on the row's MD file."
        />
        <FlagCheckbox
          label="On"
          title="Enabled flag in this template's YAML frontmatter"
          checked={template.enabled}
          onChange={wrapToggle("enabled")}
        />
        <FlagCheckbox
          label="Init"
          title="Init flag in this template's YAML frontmatter"
          checked={template.init}
          onChange={wrapToggle("init")}
        />
        <FlagCheckbox
          label="Slash"
          title="Slash flag in this template's YAML frontmatter"
          checked={template.slash}
          onChange={wrapToggle("slash")}
        />
        <div className="min-w-0 flex-1 px-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{template.name}</span>
          </div>
          <p className="text-[10px] text-muted-fg/80 mt-0.5 font-mono truncate">
            {template.scope}
          </p>
          {template.description && (
            <p className="text-xs text-muted-fg mt-0.5">
              {template.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {busy && <Loader className="size-3 text-muted-fg" />}
          <Button
            size="xs"
            intent="danger"
            onPress={async () => {
              if (
                typeof window !== "undefined" &&
                !window.confirm(
                  `Delete filesystem template "${template.name}" from ${template.scope}?`,
                )
              ) {
                return;
              }
              setBusy(true);
              try {
                await onDelete();
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function NewFsTemplateForm({
  workspaces,
  onClose,
}: {
  workspaces: string[];
  onClose: () => void;
}) {
  const [workspace, setWorkspace] = useState(workspaces[0] ?? "");
  const [subpath, setSubpath] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (workspaces.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-fg">
        No workspace roots configured. Add a workspace path to
        <code className="mx-1">~/.openportal/openportal.json</code>
        under <code>directories</code> first.
        <div className="flex justify-end mt-2">
          <Button intent="outline" size="xs" onPress={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (!name.trim() || !prompt.trim()) {
      setError("Name and prompt are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const basename = templateBasenameForName(name);
      const trimmedSubpath = subpath
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      const dirPart = trimmedSubpath
        ? `${workspace}/${trimmedSubpath}`
        : workspace;
      const location = `${dirPart}/.vibekick/templates/${basename}`;
      await writeFsTemplate({
        location,
        name: name.trim(),
        description: description.trim() || undefined,
        enabled: true,
        init: false,
        slash: false,
        order: 0,
        prompt,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-fg">
          Workspace root
        </label>
        <select
          className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
        >
          {workspaces.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-fg">
          Sub-path under workspace (optional)
        </label>
        <Input
          value={subpath}
          onChange={(e) => setSubpath(e.target.value)}
          placeholder="webapps/portal  (leave empty for workspace root)"
        />
        <p className="text-[10px] text-muted-fg/80">
          Template lands in <code>&lt;workspace&gt;/&lt;subpath&gt;/.vibekick/templates/&lt;slug&gt;.md</code>.
          A template visible everywhere under the workspace sits at
          the workspace root with sub-path empty; one scoped to a
          specific project nests deeper.
        </p>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-fg">Name</label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="git worktree -> main -> deploy -> push"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-fg">
          Description (optional)
        </label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Cycle a feature branch into main with deploy + push"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-fg">Prompt</label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          placeholder="What should the agent do when this template is invoked?"
          className="font-mono text-xs"
        />
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
  const { data, isLoading, error } = useAllFsTemplates();
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

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Filesystem templates</h3>
        <p className="text-xs text-muted-fg">
          Templates stored next to your code at{" "}
          <code>&lt;workspace&gt;/&lt;…&gt;/.vibekick/templates/&lt;slug&gt;.md</code>.
          Each file&apos;s YAML frontmatter carries its flags
          (enabled / init / slash) and ordering. Toggle a checkbox to
          rewrite the YAML. New-session pickers and the slash
          autocomplete show templates whose directory is current or
          a parent of the active project, up to the workspace root.
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
