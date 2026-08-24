import { Bars3Icon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";

import {
  FLAG_HELP,
  FlagCheckbox,
  TEMPLATE_ROW_LAYOUT_CLASS,
  TEMPLATE_ROW_NARROW_TITLE_CLASS,
  TEMPLATE_ROW_WIDE_TITLE_CLASS,
  TemplateTitleBlock,
} from "@/components/template-settings-shared";
import { TemplateIconPicker } from "@/components/template-icon-picker";
import type { ToolRowProps } from "@/components/tool-row-types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToolsStore } from "@/stores/tools-store";

export function CustomToolRow({
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
      <div className={TEMPLATE_ROW_LAYOUT_CLASS}>
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
          className={TEMPLATE_ROW_WIDE_TITLE_CLASS}
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
        className={TEMPLATE_ROW_NARROW_TITLE_CLASS}
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
