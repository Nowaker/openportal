import useSWR, { mutate as globalMutate } from "swr";

const KEY = "/api/content-settings";

export type Visibility =
  | "show-fully"
  | "show-max-bytes"
  | "show-max-bytes-with-ajax"
  | "ajax-only"
  | "hide";

export const ALL_VISIBILITIES: readonly Visibility[] = [
  "show-fully",
  "show-max-bytes",
  "show-max-bytes-with-ajax",
  "ajax-only",
  "hide",
];

export type ContentType =
  | "reasoning"
  | "tool-call-params"
  | "tool-call-output"
  | "file-read"
  | "file-write"
  | "bash-command"
  | "bash-output"
  | "omo-injection"
  | "compaction-summary"
  | "attached-file"
  | "synthetic-marker";

export const ALL_CONTENT_TYPES: readonly ContentType[] = [
  "reasoning",
  "tool-call-params",
  "tool-call-output",
  "file-read",
  "file-write",
  "bash-command",
  "bash-output",
  "omo-injection",
  "compaction-summary",
  "attached-file",
  "synthetic-marker",
];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  "reasoning": "Reasoning / thinking",
  "tool-call-params": "Tool call params",
  "tool-call-output": "Tool call output",
  "file-read": "File reads (read tool)",
  "file-write": "File writes (write tool)",
  "bash-command": "Bash command",
  "bash-output": "Bash output",
  "omo-injection": "OMO injections",
  "compaction-summary": "Compaction summary",
  "attached-file": "User-attached files",
  "synthetic-marker": "Synthetic markers (audit msgs)",
};

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  "show-fully": "Show fully",
  "show-max-bytes": "Show max N bytes",
  "show-max-bytes-with-ajax": "Show max N bytes + ajax for more",
  "ajax-only": "Ajax only (click to load)",
  "hide": "Hide entirely",
};

export interface ContentRule {
  visibility: Visibility;
  maxBytes: number | null;
}

export interface ContentSettings {
  rules: Record<ContentType, ContentRule>;
}

const DEFAULT_RULE: ContentRule = { visibility: "show-fully", maxBytes: null };

function emptyRules(): Record<ContentType, ContentRule> {
  const out = {} as Record<ContentType, ContentRule>;
  for (const t of ALL_CONTENT_TYPES) {
    out[t] = { ...DEFAULT_RULE };
  }
  out["omo-injection"] = { visibility: "ajax-only", maxBytes: null };
  return out;
}

export const EMPTY_CONTENT_SETTINGS: ContentSettings = { rules: emptyRules() };

async function fetcher(url: string): Promise<ContentSettings> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`content-settings fetch failed: ${r.status}`);
  return (await r.json()) as ContentSettings;
}

export function useContentSettings(): {
  settings: ContentSettings;
  isLoading: boolean;
  error: Error | undefined;
} {
  const { data, isLoading, error } = useSWR<ContentSettings>(KEY, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 2000,
    keepPreviousData: true,
  });
  return {
    settings: data ?? EMPTY_CONTENT_SETTINGS,
    isLoading: isLoading && !data,
    error: error as Error | undefined,
  };
}

export async function setContentRule(
  contentType: ContentType,
  rule: ContentRule,
): Promise<void> {
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contentType,
      visibility: rule.visibility,
      maxBytes: rule.maxBytes,
    }),
  });
  if (!r.ok) throw new Error(`setContentRule failed: ${r.status}`);
  const next = (await r.json()) as ContentSettings;
  await globalMutate(KEY, next, { revalidate: false });
}

export async function resetContentSettings(): Promise<void> {
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reset: true }),
  });
  if (!r.ok) throw new Error(`resetContentSettings failed: ${r.status}`);
  const next = (await r.json()) as ContentSettings;
  await globalMutate(KEY, next, { revalidate: false });
}
