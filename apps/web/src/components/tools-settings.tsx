import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToolsStore, type ResolvedTool } from "@/stores/tools-store";

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
        <Checkbox
          isSelected={tool.enabled}
          onChange={(value) => setEnabled(tool.id, value)}
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

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(tool.name);
  const [draftDescription, setDraftDescription] = useState(
    "description" in tool ? (tool.description ?? "") : "",
  );
  const [draftPrompt, setDraftPrompt] = useState(tool.prompt);

  useEffect(() => {
    if (!editing) {
      setDraftName(tool.name);
      setDraftDescription("description" in tool ? (tool.description ?? "") : "");
      setDraftPrompt(tool.prompt);
    }
  }, [editing, tool]);

  if (tool.kind !== "custom") return null;

  return (
    <div className="rounded-lg border border-border bg-bg p-3 space-y-2">
      <div className="flex items-start gap-3">
        <Checkbox
          isSelected={tool.enabled}
          onChange={(value) => setEnabled(tool.id, value)}
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
  const tools = useToolsStore((s) => s.resolveTools());
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

export function ToolsSettings() {
  const tools = useToolsStore((s) => s.resolveTools());

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
          at the bottom.
        </p>
      </div>

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
