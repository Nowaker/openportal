import { useMemo, useState } from "react";

import {
  FsTemplateRow,
  type FsTemplateToggleField,
} from "@/components/fs-template-row";
import type { FsTemplateEdit } from "@/components/fs-template-editor";
import {
  NewFsTemplateForm,
  type NewFsTemplateInitialValues,
} from "@/components/new-fs-template-form";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  deleteFsTemplate,
  forceRescanFsTemplates,
  useAllFsTemplates,
  writeFsTemplate,
  type FsTemplate,
} from "@/hooks/use-vibekick-templates";
import { compareFsTemplatePriority } from "@/lib/vibekick-template-contract";

function duplicateInitialValues(
  template: FsTemplate,
): NewFsTemplateInitialValues {
  return {
    workspace: template.workspaceRoot,
    subpath: template.scope,
    name: `${template.name} (copy)`,
    description: template.description,
    prompt: template.prompt,
    enabled: template.enabled,
    init: template.init,
    defaultOn: template.defaultOn,
    slash: template.slash,
  };
}

type FsTemplatesSectionProps = {
  readonly onFormOpenChange: (open: boolean) => void;
};

export function FsTemplatesSection({
  onFormOpenChange,
}: FsTemplatesSectionProps) {
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
    } catch (caught) {
      setRescanError(
        caught instanceof Error
          ? caught.message
          : "Failed to rescan filesystem",
      );
    } finally {
      setRescanning(false);
    }
  };

  const workspaces = data?.workspaces ?? [];
  const templates = data?.templates ?? [];
  const scanSettled =
    Boolean(data) &&
    !isLoading &&
    !isValidating &&
    !rescanning &&
    !error &&
    !rescanError;

  const byWorkspace = useMemo(() => {
    const groups = new Map<string, FsTemplate[]>();
    for (const template of templates) {
      const group = groups.get(template.workspaceRoot) ?? [];
      group.push(template);
      groups.set(template.workspaceRoot, group);
    }
    for (const group of groups.values()) {
      group.sort(compareFsTemplatePriority);
    }
    return groups;
  }, [templates]);

  const handleToggle = async (
    template: FsTemplate,
    field: FsTemplateToggleField,
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

  const handleSaveEdit = async (template: FsTemplate, next: FsTemplateEdit) => {
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

  const closeForm = () => {
    setCreating(false);
    setDuplicateSource(null);
    onFormOpenChange(false);
  };

  return (
    <section
      className={creating || duplicateSource ? "space-y-3" : "space-y-3 pb-32"}
    >
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">Your templates - filesystem</h3>
          {(rescanning || (isValidating && templates.length > 0)) && (
            <span
              role="status"
              className="inline-flex items-center gap-1 text-[10px] text-muted-fg/80"
            >
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
              Refresh
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-fg">
          Templates stored next to your code at{" "}
          <code>
            &lt;workspace&gt;/&lt;…&gt;/.vibekick/templates/&lt;slug&gt;.md
          </code>
          . Each file&apos;s YAML frontmatter carries its flags (burger / init /
          defaultOn / slash) and ordering. The backend caches the scan in memory
          and rebuilds it every 5 minutes; flag toggles update the cache in
          place (no rescan). Hit Refresh to force a fresh disk scan now.
        </p>
        {rescanError && (
          <p role="alert" className="text-xs text-danger-fg mt-1">
            {rescanError}
          </p>
        )}
      </div>

      {isLoading && templates.length === 0 && (
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

      {scanSettled && templates.length === 0 && (
        <p className="text-xs text-muted-fg">
          No filesystem templates found. Add one below; it lands at the location
          you choose.
        </p>
      )}

      {workspaces.map((workspace) => {
        const group = byWorkspace.get(workspace) ?? [];
        if (group.length === 0) return null;
        return (
          <div key={workspace} className="space-y-1">
            <h4 className="break-all text-xs text-muted-fg/80 font-mono">
              {workspace}
            </h4>
            <div className="space-y-1.5">
              {group.map((template) => (
                <FsTemplateRow
                  key={template.id}
                  template={template}
                  onToggle={(field, next) =>
                    handleToggle(template, field, next)
                  }
                  onSaveEdit={(next) => handleSaveEdit(template, next)}
                  onDelete={() => deleteFsTemplate(template.location)}
                  onDuplicate={() => {
                    setCreating(false);
                    setDuplicateSource(template);
                    onFormOpenChange(true);
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
          onClose={closeForm}
          initialValues={
            duplicateSource
              ? duplicateInitialValues(duplicateSource)
              : undefined
          }
        />
      ) : (
        <Button
          intent="outline"
          size="sm"
          onPress={() => {
            setCreating(true);
            onFormOpenChange(true);
          }}
        >
          + New filesystem template
        </Button>
      )}
    </section>
  );
}
