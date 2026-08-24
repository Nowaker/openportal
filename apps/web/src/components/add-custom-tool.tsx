import { useEffect, useState } from "react";

import { FLAG_HELP, FlagCheckbox } from "@/components/template-settings-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useResolvedTools } from "@/hooks/use-resolved-tools";
import { useToolsStore } from "@/stores/tools-store";

type AddCustomToolInitialValues = {
  readonly name?: string;
  readonly description?: string;
  readonly prompt?: string;
  readonly burger?: boolean;
  readonly init?: boolean;
  readonly defaultOn?: boolean;
  readonly slash?: boolean;
};

type AddCustomToolProps = {
  readonly initialValues?: AddCustomToolInitialValues;
  readonly onCreated?: () => void;
};

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

export function AddCustomTool({
  initialValues,
  onCreated,
}: AddCustomToolProps = {}) {
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
