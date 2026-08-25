import useSWR, { mutate as globalMutate } from "swr";
import { z } from "zod/v4";

import {
  fsTemplateSchema,
  isTemplateVersionOlder,
  sortFsTemplates,
  templateSnapshotSchema,
  templateVersionSchema,
  type FsTemplate,
  type TemplateSnapshot,
  type TemplateVersion,
} from "@/lib/vibekick-template-contract";
import {
  consumeTemplateScanResponse,
  reconcileTemplateScanProgress,
} from "@/lib/vibekick-template-stream-client";

export type { FsTemplate } from "@/lib/vibekick-template-contract";
export type AllFsTemplatesResponse = TemplateSnapshot;

const directoryFsTemplatesResponseSchema = z
  .object({
    directory: z.string(),
    workspaceRoot: z.string(),
    templates: z.array(fsTemplateSchema).readonly(),
  })
  .readonly();

export type DirectoryFsTemplatesResponse = z.infer<
  typeof directoryFsTemplatesResponseSchema
>;

const templateWriteResponseSchema = z.intersection(
  z
    .object({
      template: fsTemplateSchema,
    })
    .readonly(),
  templateVersionSchema,
);

const templateDeleteResponseSchema = z.intersection(
  z
    .object({
      ok: z.literal(true),
    })
    .readonly(),
  templateVersionSchema,
);

class TemplateRequestError extends Error {
  override readonly name = "TemplateRequestError";

  constructor(readonly status: number) {
    super(`Filesystem template request failed: ${status}`);
  }
}

const ALL_KEY = "/api/vibekick-templates";
let allRequestGeneration = 0;
let publicationQueue = Promise.resolve();

async function serializePublication(
  publish: () => Promise<unknown>,
): Promise<void> {
  const next = publicationQueue.then(publish);
  publicationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  await next;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new TemplateRequestError(response.status);
  return response.json();
}

async function fetchAllTemplates(
  url: string,
  force: boolean,
): Promise<TemplateSnapshot> {
  const requestGeneration = ++allRequestGeneration;
  const query = new URLSearchParams({ stream: "1" });
  if (force) query.set("rescan", "1");
  const response = await fetch(`${url}?${query.toString()}`);
  let currentSnapshot: TemplateSnapshot | null = null;
  let needsRefresh = false;
  const remoteSnapshot = await consumeTemplateScanResponse(
    response,
    async (progress) => {
      await serializePublication(() =>
        globalMutate(
          ALL_KEY,
          (current: unknown) => {
            if (requestGeneration !== allRequestGeneration) {
              const parsed = templateSnapshotSchema.safeParse(current);
              if (parsed.success) currentSnapshot = parsed.data;
              return current;
            }
            const applied = reconcileTemplateScanProgress(current, progress);
            currentSnapshot = applied.snapshot;
            needsRefresh ||= applied.stale;
            return applied.snapshot;
          },
          { revalidate: false },
        ),
      );
    },
  );
  if (needsRefresh) {
    setTimeout(() => {
      void globalMutate(ALL_KEY);
    }, 0);
  }
  return currentSnapshot ?? remoteSnapshot;
}

async function fetchDirectoryTemplates(
  url: string,
): Promise<DirectoryFsTemplatesResponse> {
  const parsed = directoryFsTemplatesResponseSchema.safeParse(
    await readJson(await fetch(url)),
  );
  if (!parsed.success) {
    throw new TemplateRequestError(502);
  }
  return parsed.data;
}

export function useAllFsTemplates() {
  return useSWR<AllFsTemplatesResponse>(
    ALL_KEY,
    (url: string) => fetchAllTemplates(url, false),
    { revalidateOnFocus: false, keepPreviousData: true },
  );
}

export function useFsTemplatesForDirectory(directory?: string | null) {
  const key = directory
    ? `/api/vibekick-templates?directory=${encodeURIComponent(directory)}`
    : null;
  return useSWR<DirectoryFsTemplatesResponse>(key, fetchDirectoryTemplates, {
    revalidateOnFocus: false,
    keepPreviousData: false,
  });
}

export type FsTemplateWriteInput = {
  readonly location: string;
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly init: boolean;
  readonly defaultOn: boolean;
  readonly slash: boolean;
  readonly order: number;
  readonly prompt: string;
};

function patchTemplateInPlace(
  current: unknown,
  template: FsTemplate,
  version: TemplateVersion,
): unknown {
  const parsed = templateSnapshotSchema.safeParse(current);
  if (!parsed.success) return current;
  if (isTemplateVersionOlder(version, parsed.data)) return current;
  const templates = parsed.data.templates.slice();
  const index = templates.findIndex(
    (candidate) => candidate.location === template.location,
  );
  if (index === -1) templates.push(template);
  else templates[index] = template;
  return {
    ...parsed.data,
    templates: sortFsTemplates(templates),
    ...version,
  };
}

async function revalidateDirectoryTemplateCaches(): Promise<void> {
  await globalMutate(
    (key) => typeof key === "string" && key.startsWith(`${ALL_KEY}?directory=`),
    undefined,
    { revalidate: true },
  );
}

export async function writeFsTemplate(
  input: FsTemplateWriteInput,
): Promise<FsTemplate> {
  const response = await fetch(ALL_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const parsed = templateWriteResponseSchema.safeParse(
    await readJson(response),
  );
  if (!parsed.success) throw new TemplateRequestError(502);
  await serializePublication(() =>
    globalMutate(
      ALL_KEY,
      (current: unknown) =>
        patchTemplateInPlace(current, parsed.data.template, parsed.data),
      { revalidate: false },
    ),
  );
  await revalidateDirectoryTemplateCaches();
  return parsed.data.template;
}

export async function deleteFsTemplate(location: string): Promise<void> {
  const query = new URLSearchParams({ location });
  const response = await fetch(`${ALL_KEY}?${query.toString()}`, {
    method: "DELETE",
  });
  const parsed = templateDeleteResponseSchema.safeParse(
    await readJson(response),
  );
  if (!parsed.success) throw new TemplateRequestError(502);
  await serializePublication(() =>
    globalMutate(
      ALL_KEY,
      (current: unknown) => {
        const collection = templateSnapshotSchema.safeParse(current);
        if (!collection.success) return current;
        if (isTemplateVersionOlder(parsed.data, collection.data))
          return current;
        return {
          ...collection.data,
          templates: collection.data.templates.filter(
            (template) => template.location !== location,
          ),
          serverStartedAt: parsed.data.serverStartedAt,
          revision: parsed.data.revision,
        };
      },
      { revalidate: false },
    ),
  );
  await revalidateDirectoryTemplateCaches();
}

export function forceRescanFsTemplates(): Promise<AllFsTemplatesResponse> {
  return fetchAllTemplates(ALL_KEY, true);
}

export function templateBasenameForName(name: string): string {
  const slug =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "template";
  return `${slug}.md`;
}
