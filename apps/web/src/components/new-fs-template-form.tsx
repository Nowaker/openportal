import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PathInput } from "@/components/ui/path-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FLAG_HELP, FlagCheckbox } from "@/components/template-settings-shared";
import {
  templateBasenameForName,
  writeFsTemplate,
} from "@/hooks/use-vibekick-templates";
import { useDirectoryCompletion } from "@/hooks/use-directory-completion";

export type NewFsTemplateInitialValues = {
  readonly workspace?: string;
  readonly subpath?: string;
  readonly name?: string;
  readonly description?: string;
  readonly prompt?: string;
  readonly enabled?: boolean;
  readonly init?: boolean;
  readonly defaultOn?: boolean;
  readonly slash?: boolean;
};

type NewFsTemplateFormProps = {
  readonly workspaces: readonly string[];
  readonly onClose: () => void;
  readonly initialValues?: NewFsTemplateInitialValues;
};

export function NewFsTemplateForm({
  workspaces,
  onClose,
  initialValues,
}: NewFsTemplateFormProps) {
  const workspaceLabelId = useId();
  const subpathInputId = useId();
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
  const completion = useDirectoryCompletion(workspace, subpath);

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
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span
          id={workspaceLabelId}
          className="text-xs font-medium text-muted-fg sm:w-32 sm:shrink-0"
        >
          Workspace
        </span>
        <Select
          aria-labelledby={workspaceLabelId}
          selectedKey={workspace}
          onSelectionChange={(k) => setWorkspace(String(k))}
          className="min-w-0 flex-1"
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
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <label
          htmlFor={subpathInputId}
          className="text-xs font-medium text-muted-fg sm:w-32 sm:shrink-0"
        >
          Sub-path
        </label>
        <div className="min-w-0 flex-1">
          <PathInput
            id={subpathInputId}
            value={subpath}
            onChange={setSubpath}
            onSubmit={() => void submit()}
            entries={completion.entries}
            pathMode="relative"
            placeholder="e.g. webapps/portal - empty for workspace root"
          />
          {completion.isLoading && completion.entries.length === 0 && (
            <p role="status" className="mt-1 text-xs text-muted-fg">
              Loading path suggestions...
            </p>
          )}
          {completion.error && (
            <p role="alert" className="mt-1 text-xs text-danger-fg">
              Path suggestions unavailable: {completion.error.message}
            </p>
          )}
        </div>
      </div>
      <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="text-xs font-medium text-muted-fg sm:w-32 sm:shrink-0">
          Name
        </span>
        <Input
          className="min-w-0 flex-1"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="text-xs font-medium text-muted-fg sm:w-32 sm:shrink-0">
          Description
        </span>
        <Input
          className="min-w-0 flex-1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
        />
      </label>
      <label className="block space-y-1 text-xs font-medium text-muted-fg">
        <span>Prompt</span>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={8}
        />
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <span className="text-xs font-medium text-muted-fg sm:w-32 sm:shrink-0">
          Flags
        </span>
        <div className="flex min-w-0 flex-wrap items-start gap-3">
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
      {error && (
        <p role="alert" className="text-xs text-danger-fg">
          {error}
        </p>
      )}
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
