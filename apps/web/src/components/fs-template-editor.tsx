import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FsTemplate } from "@/hooks/use-vibekick-templates";

export type FsTemplateEdit = {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
};

type FsTemplateEditorProps = {
  readonly template: FsTemplate;
  readonly onSave: (next: FsTemplateEdit) => Promise<void>;
  readonly onClose: () => void;
};

export function FsTemplateEditor({
  template,
  onSave,
  onClose,
}: FsTemplateEditorProps) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [prompt, setPrompt] = useState(template.prompt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim() || template.name,
        description: description.trim(),
        prompt,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border/50 pt-2">
      <label className="block space-y-1 text-xs font-medium text-muted-fg">
        <span>Name</span>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="block space-y-1 text-xs font-medium text-muted-fg">
        <span>Description (optional)</span>
        <Input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="block space-y-1 text-xs font-medium text-muted-fg">
        <span>Prompt</span>
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={8}
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-danger-fg">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          size="xs"
          intent="outline"
          onPress={onClose}
          isDisabled={saving}
        >
          Cancel
        </Button>
        <Button size="xs" onPress={handleSave} isDisabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
