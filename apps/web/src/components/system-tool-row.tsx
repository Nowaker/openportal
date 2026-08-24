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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToolsStore } from "@/stores/tools-store";

export function SystemToolRow({
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
      <div className={TEMPLATE_ROW_LAYOUT_CLASS}>
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
          className={TEMPLATE_ROW_WIDE_TITLE_CLASS}
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
        className={TEMPLATE_ROW_NARROW_TITLE_CLASS}
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
