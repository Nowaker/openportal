import useSWR from "swr";
import { z } from "zod";

import type { PathInputEntry } from "@/components/ui/path-input";
import { splitInput } from "@/lib/path-utils";

const directoryListSchema = z.object({
  entries: z
    .array(z.object({ name: z.string(), isDir: z.boolean() }))
    .readonly()
    .optional(),
});

async function fetchDirectoryList(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return directoryListSchema.parse(await response.json());
}

type DirectoryCompletion = {
  readonly entries: readonly PathInputEntry[];
  readonly isLoading: boolean;
  readonly error?: Error;
};

export function useDirectoryCompletion(
  workspace: string,
  subpath: string,
): DirectoryCompletion {
  const { dir } = splitInput(subpath);
  const root = workspace.replace(/\/+$/, "");
  const relativeDir = dir.replace(/^\/+/, "");
  const path = relativeDir ? `${root}/${relativeDir}` : root;
  const query = new URLSearchParams({ path });
  const { data, error, isLoading } = useSWR(
    workspace ? `/api/fs/list?${query.toString()}` : null,
    fetchDirectoryList,
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  return {
    entries: data?.entries ?? [],
    isLoading,
    error: error instanceof Error ? error : undefined,
  };
}
