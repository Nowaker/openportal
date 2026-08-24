import { z } from "zod/v4";

export const fsTemplateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    enabled: z.boolean(),
    init: z.boolean(),
    defaultOn: z.boolean(),
    slash: z.boolean(),
    order: z.number().int(),
    prompt: z.string(),
    location: z.string(),
    workspaceRoot: z.string(),
    scope: z.string(),
  })
  .readonly();

export type FsTemplate = z.infer<typeof fsTemplateSchema>;

const templateVersionShape = {
  serverStartedAt: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
} as const;

export const templateVersionSchema = z.object(templateVersionShape).readonly();

export type TemplateVersion = z.infer<typeof templateVersionSchema>;

export function compareTemplateVersions(
  left: TemplateVersion,
  right: TemplateVersion,
): number {
  return (
    left.serverStartedAt - right.serverStartedAt ||
    left.revision - right.revision
  );
}

export function isTemplateVersionOlder(
  candidate: TemplateVersion,
  current: TemplateVersion,
): boolean {
  return compareTemplateVersions(candidate, current) < 0;
}

export const templateSnapshotSchema = z
  .object({
    workspaces: z.array(z.string()).readonly(),
    templates: z.array(fsTemplateSchema).readonly(),
    builtAt: z.number().int().nonnegative(),
    ...templateVersionShape,
  })
  .readonly();

export type TemplateSnapshot = z.infer<typeof templateSnapshotSchema>;

export const templateScanEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("start"),
      workspaces: z.array(z.string()).readonly(),
      ...templateVersionShape,
    })
    .readonly(),
  z
    .object({
      type: z.literal("batch"),
      templates: z.array(fsTemplateSchema).readonly(),
      removedLocations: z.array(z.string()).readonly(),
      ...templateVersionShape,
    })
    .readonly(),
  z
    .object({
      type: z.literal("complete"),
      snapshot: templateSnapshotSchema,
    })
    .readonly(),
  z
    .object({
      type: z.literal("failed"),
      error: z.string(),
    })
    .readonly(),
]);

export type TemplateScanEvent = z.infer<typeof templateScanEventSchema>;

export function templateDirectoryDepth(scope: string): number {
  const markerIndex = scope
    .split(/[/\\]/)
    .findIndex((segment) => segment === ".vibekick");
  return markerIndex === -1 ? Number.MAX_SAFE_INTEGER : markerIndex;
}

export function compareFsTemplatePriority(
  left: FsTemplate,
  right: FsTemplate,
): number {
  return (
    templateDirectoryDepth(left.scope) - templateDirectoryDepth(right.scope) ||
    left.order - right.order ||
    left.scope.localeCompare(right.scope) ||
    left.location.localeCompare(right.location)
  );
}

export function sortFsTemplates(templates: Iterable<FsTemplate>): FsTemplate[] {
  return Array.from(templates).sort(compareFsTemplatePriority);
}
