import useSWR, { mutate as globalMutate } from "swr";

export interface FsTemplate {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  init: boolean;
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

// Mutator: create or update a template on disk. POSTs to the
// server which validates the location is inside a configured
// workspace root before writing. Invalidates both the all-templates
// SWR cache (settings) and any directory-scoped cache (new-session
// picker) so changes show up immediately everywhere.
export async function writeFsTemplate(input: {
  location: string;
  name: string;
  description?: string;
  enabled: boolean;
  init: boolean;
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
    undefined,
    { revalidate: true },
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
    undefined,
    { revalidate: true },
  );
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
