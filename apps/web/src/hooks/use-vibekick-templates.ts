import useSWR, { mutate as globalMutate } from "swr";

export interface FsTemplate {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  init: boolean;
  defaultOn: boolean;
  slash: boolean;
  order: number;
  prompt: string;
  location: string;
  workspaceRoot: string;
  scope: string;
}

export interface AllFsTemplatesResponse {
  workspaces: string[];
  templates: FsTemplate[];
}

export interface DirectoryFsTemplatesResponse {
  directory: string;
  workspaceRoot: string;
  templates: FsTemplate[];
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

const ALL_KEY = "/api/vibekick-templates";

export function useAllFsTemplates() {
  // keepPreviousData: when SWR revalidates (e.g. after a toggle write
  // calls globalMutate), the cached list stays painted instead of
  // unmounting to a loader. The consumer can read `isValidating` from
  // the returned object to render a "Rescanning files…" indicator
  // without dropping the visible rows.
  return useSWR<AllFsTemplatesResponse>(ALL_KEY, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}

export function useFsTemplatesForDirectory(directory?: string | null) {
  const key = directory
    ? `/api/vibekick-templates?directory=${encodeURIComponent(directory)}`
    : null;
  return useSWR<DirectoryFsTemplatesResponse>(key, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}

// Patches the SWR cache in place with the returned template -
// NO revalidate. Re-enabling revalidate here triggers a backend
// rescan on every flag toggle and blocks the UI mid-rescan
// (the bug AI_TODO #150 was reported about). Backend snapshot
// stays consistent via applyTemplateUpdate inside the POST handler.
export async function writeFsTemplate(input: {
  location: string;
  name: string;
  description?: string;
  enabled: boolean;
  init: boolean;
  defaultOn: boolean;
  slash: boolean;
  order: number;
  prompt: string;
}): Promise<FsTemplate> {
  const res = await fetch("/api/vibekick-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let detail = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch {
      /* swallow */
    }
    throw new Error(detail);
  }
  const data = (await res.json()) as { template: FsTemplate };
  await globalMutate(
    (key) =>
      typeof key === "string" && key.startsWith("/api/vibekick-templates"),
    (current: unknown) => patchTemplateInPlace(current, data.template),
    { revalidate: false },
  );
  return data.template;
}

export async function deleteFsTemplate(location: string): Promise<void> {
  const url = `/api/vibekick-templates?location=${encodeURIComponent(location)}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    let detail = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch {
      /* swallow */
    }
    throw new Error(detail);
  }
  await globalMutate(
    (key) =>
      typeof key === "string" && key.startsWith("/api/vibekick-templates"),
    (current: unknown) => removeTemplateInPlace(current, location),
    { revalidate: false },
  );
}

// Force-rescan: explicit user gesture (Refresh button in Settings).
// Tells the backend to rebuild the in-memory snapshot from disk;
// the new snapshot replaces the SWR all-templates cache. Directory-
// scoped caches revalidate on their own next-poll - they hit a
// separate code path on the backend that isn't snapshot-cached.
export async function forceRescanFsTemplates(): Promise<AllFsTemplatesResponse> {
  const res = await fetch("/api/vibekick-templates?rescan=1");
  if (!res.ok) {
    let detail = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch {
      /* swallow */
    }
    throw new Error(detail);
  }
  const data = (await res.json()) as AllFsTemplatesResponse;
  await globalMutate(ALL_KEY, data, { revalidate: false });
  return data;
}

function patchTemplateInPlace(current: unknown, template: FsTemplate): unknown {
  if (!current || typeof current !== "object") return current;
  const obj = current as { templates?: FsTemplate[] };
  if (!Array.isArray(obj.templates)) return current;
  const next = obj.templates.slice();
  const idx = next.findIndex((t) => t.location === template.location);
  if (idx === -1) next.push(template);
  else next[idx] = template;
  return { ...obj, templates: next };
}

function removeTemplateInPlace(current: unknown, location: string): unknown {
  if (!current || typeof current !== "object") return current;
  const obj = current as { templates?: FsTemplate[] };
  if (!Array.isArray(obj.templates)) return current;
  return {
    ...obj,
    templates: obj.templates.filter((t) => t.location !== location),
  };
}

// Slugify a name into a filesystem-safe basename for new templates.
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
