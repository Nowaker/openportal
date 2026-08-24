import { useState } from "react";

import {
  FsTemplateEditor,
  type FsTemplateEdit,
} from "@/components/fs-template-editor";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  FLAG_HELP,
  FlagCheckbox,
  TEMPLATE_ROW_LAYOUT_CLASS,
  TEMPLATE_ROW_NARROW_TITLE_CLASS,
  TEMPLATE_ROW_WIDE_TITLE_CLASS,
  TemplateTitleBlock,
} from "@/components/template-settings-shared";
import type { FsTemplate } from "@/hooks/use-vibekick-templates";

export type FsTemplateToggleField = "enabled" | "init" | "defaultOn" | "slash";

const TOGGLE_LABELS = {
  enabled: "Burger",
  init: "Init",
  defaultOn: "Default on",
  slash: "Slash",
} as const satisfies Record<FsTemplateToggleField, string>;

type FsTemplateRowProps = {
  readonly template: FsTemplate;
  readonly onToggle: (
    field: FsTemplateToggleField,
    next: boolean,
  ) => Promise<void>;
  readonly onSaveEdit: (next: FsTemplateEdit) => Promise<void>;
  readonly onDelete: () => Promise<void>;
  readonly onDuplicate?: () => void;
};

export function FsTemplateRow({
  template,
  onToggle,
  onSaveEdit,
  onDelete,
  onDuplicate,
}: FsTemplateRowProps) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] =
    useState<FsTemplateToggleField | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const handleToggle = async (field: FsTemplateToggleField, next: boolean) => {
    setPendingToggle(field);
    setToggleError(null);
    try {
      await onToggle(field, next);
    } catch (caught) {
      setToggleError(
        caught instanceof Error ? caught.message : "Failed to update flag",
      );
    } finally {
      setPendingToggle(null);
    }
  };

  return (
    <div
      className="rounded-lg border border-border bg-bg p-2 space-y-2"
      aria-busy={pendingToggle !== null}
    >
      <div className={TEMPLATE_ROW_LAYOUT_CLASS}>
        <div className="flex shrink-0 items-start gap-3">
          <FlagCheckbox
            label="Burger"
            title={FLAG_HELP.burger}
            checked={template.enabled}
            disabled={pendingToggle !== null}
            onChange={(next) => void handleToggle("enabled", next)}
          />
          <div className="space-y-1">
            <FlagCheckbox
              label="Init"
              title={FLAG_HELP.init}
              checked={template.init}
              disabled={pendingToggle !== null}
              onChange={(next) => void handleToggle("init", next)}
            />
            <FlagCheckbox
              label="Default on"
              title={FLAG_HELP.defaultOn}
              checked={template.defaultOn && template.init}
              disabled={!template.init || pendingToggle !== null}
              onChange={(next) => void handleToggle("defaultOn", next)}
            />
          </div>
          <FlagCheckbox
            label="Slash"
            title={FLAG_HELP.slash}
            checked={template.slash}
            disabled={pendingToggle !== null}
            onChange={(next) => void handleToggle("slash", next)}
          />
        </div>
        <TemplateTitleBlock
          className={TEMPLATE_ROW_WIDE_TITLE_CLASS}
          name={template.name}
          description={template.description}
          scope={template.scope}
        />
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          <Button
            size="xs"
            intent="outline"
            isDisabled={pendingToggle !== null}
            onPress={() => setEditing((value) => !value)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          {onDuplicate && (
            <Button
              size="xs"
              intent="outline"
              isDisabled={pendingToggle !== null}
              onPress={onDuplicate}
            >
              Duplicate
            </Button>
          )}
          <Button
            size="xs"
            intent="danger"
            isDisabled={pendingToggle !== null}
            onPress={() => {
              setDeleteError(null);
              setDeleteConfirmOpen(true);
            }}
          >
            Delete
          </Button>
        </div>
      </div>
      <TemplateTitleBlock
        className={TEMPLATE_ROW_NARROW_TITLE_CLASS}
        name={template.name}
        description={template.description}
        scope={template.scope}
      />
      {pendingToggle && (
        <p role="status" className="text-xs text-muted-fg">
          Saving {TOGGLE_LABELS[pendingToggle]} flag...
        </p>
      )}
      {toggleError && (
        <p role="alert" className="text-xs text-danger-fg">
          {toggleError}
        </p>
      )}
      {editing && (
        <FsTemplateEditor
          template={template}
          onSave={onSaveEdit}
          onClose={() => setEditing(false)}
        />
      )}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title={`Delete filesystem template "${template.name}"?`}
        description={
          <div className="space-y-2 text-sm text-muted-fg">
            <p>This removes the template file from disk.</p>
            <p className="font-mono text-xs break-all">{template.location}</p>
            {deleteError && (
              <p role="alert" className="text-xs text-danger-fg">
                {deleteError}
              </p>
            )}
          </div>
        }
        confirmLabel="Delete"
        tone="danger"
        busy={deleting}
        onConfirm={async () => {
          setDeleting(true);
          setDeleteError(null);
          try {
            await onDelete();
            setDeleteConfirmOpen(false);
          } catch (caught) {
            setDeleteError(
              caught instanceof Error ? caught.message : "Failed to delete",
            );
          } finally {
            setDeleting(false);
          }
        }}
        onClose={() => {
          if (!deleting) {
            setDeleteConfirmOpen(false);
            setDeleteError(null);
          }
        }}
      />
    </div>
  );
}
