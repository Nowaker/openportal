import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import type {
  FilePart,
  Message,
  Part,
  ToolPart,
  ToolState,
  TextPart,
} from "@opencode-ai/sdk";
import type {
  PermissionRequest,
  QuestionAnswer,
  QuestionInfo,
  QuestionOption,
  QuestionRequest,
} from "@opencode-ai/sdk/v2";
import { useInstanceStore } from "@/stores/instance-store";
import { usePollMs } from "@/hooks/use-opencode";

export type {
  FilePart,
  Message,
  Part,
  ToolPart,
  ToolState,
  TextPart,
  PermissionRequest,
  QuestionAnswer,
  QuestionInfo,
  QuestionOption,
  QuestionRequest,
};

export interface MessageWithParts {
  info: Message;
  parts: Part[];
  isQueued?: boolean;
}

const fetcher = async (url: string): Promise<MessageWithParts[]> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch messages");
  }
  const data = await response.json();
  return data || [];
};

function usePort() {
  const instance = useInstanceStore((s) => s.instance);
  return instance?.port ?? null;
}

export interface UseSessionMessagesOptions {
  loadAll?: boolean;
  limit?: number;
  enabled?: boolean;
}

export function useSessionMessages(
  sessionId: string | undefined,
  options: UseSessionMessagesOptions = {},
) {
  const port = usePort();
  const enabled = options.enabled !== false;
  const key =
    enabled && port && sessionId
      ? getMessagesKey(port, sessionId, options.loadAll, options.limit)
      : null;

  const pollMs = usePollMs(3000);
  const {
    data,
    error,
    isLoading,
    mutate: boundMutate,
  } = useSWR<MessageWithParts[]>(key, fetcher, {
    refreshInterval: pollMs,
    keepPreviousData: true,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  return {
    messages: data || [],
    error,
    isLoading,
    mutate: boundMutate,
  };
}

export function getMessagesKey(
  port: number,
  sessionId: string,
  loadAll = false,
  limit?: number,
) {
  const base = `/api/opencode/${port}/session/${sessionId}/messages`;
  if (loadAll) return `${base}?limit=all`;
  if (typeof limit === "number" && limit > 0) return `${base}?limit=${limit}`;
  return base;
}

export function mutateSessionMessages(port: number, sessionId: string) {
  // Revalidate any cached variant of this session's messages key, so callers
  // that loaded the full history still get refreshed without us having to
  // know which variant they used.
  mutate(
    (key) =>
      typeof key === "string" &&
      key.startsWith(`/api/opencode/${port}/session/${sessionId}/messages`),
  );
}

function isMessagesKeyForSession(
  port: number,
  sessionId: string,
  key: unknown,
): key is string {
  return (
    typeof key === "string" &&
    key.startsWith(`/api/opencode/${port}/session/${sessionId}/messages`)
  );
}

// Append an optimistic message to every cached variant of this session's
// messages key (paginated `?limit=<n>`, `?limit=all`, or unsuffixed).
// Targeting only the unsuffixed + ?limit=all variants would miss the
// active SWR subscription whenever the page mounted with a numeric limit,
// causing the message to silently disappear from the chat until F5.
export function addOptimisticMessage(
  port: number,
  sessionId: string,
  message: MessageWithParts,
): () => void {
  const matchedKeys: string[] = [];
  mutate(
    (key) => {
      if (isMessagesKeyForSession(port, sessionId, key)) {
        matchedKeys.push(key);
        return true;
      }
      return false;
    },
    (current: MessageWithParts[] | undefined) =>
      current ? [...current, message] : [message],
    { revalidate: false },
  );

  return () => {
    mutate(
      (key) => isMessagesKeyForSession(port, sessionId, key),
      (current: MessageWithParts[] | undefined) =>
        current
          ? current.filter((m) => m.info.id !== message.info.id)
          : current,
      { revalidate: false },
    );
  };
}

export function updateOptimisticMessage(
  port: number,
  sessionId: string,
  messageId: string,
  updates: Partial<MessageWithParts>,
) {
  mutate(
    (key) => isMessagesKeyForSession(port, sessionId, key),
    (current: MessageWithParts[] | undefined) => {
      if (!current) return current;
      return current.map((m) =>
        m.info.id === messageId ? { ...m, ...updates } : m,
      );
    },
    { revalidate: false },
  );
}

export function removeOptimisticMessage(
  port: number,
  sessionId: string,
  messageId: string,
) {
  mutate(
    (key) => isMessagesKeyForSession(port, sessionId, key),
    (current: MessageWithParts[] | undefined) => {
      if (!current) return current;
      return current.filter((m) => m.info.id !== messageId);
    },
    { revalidate: false },
  );
}

// Permalink-mode window loader.
//
// Drives a 4-fetch journey for the URL-fragment permalink feature: when
// the page lands with `#msg-<id>`, this hook fires four independent
// requests in parallel against the extended /messages endpoint:
//
//   1. target  -> ?id=<msgId>                  (single message)
//   2. before  -> ?before=<msgId>&limit=10     (10 messages before)
//   3. after   -> ?after=<msgId>&limit=10      (10 messages after)
//   4. latest  -> ?limit=10                    (10 most recent)
//
// Each fetch updates state independently so the UI can render the
// target as soon as it lands and surface spinners on the still-pending
// windows. The hook owns NO SWR cache key for the merged view - it's
// a one-shot loader. Once everything settles, the route can choose to
// transition into normal polling mode by clearing `enabled` and
// letting useSessionMessages take over.
export interface PermalinkWindowState {
  messages: MessageWithParts[];
  loading: {
    target: boolean;
    before: boolean;
    after: boolean;
    latest: boolean;
  };
  targetFound: boolean | null;
  targetIndex: number | null;
  totalCount: number | null;
  error: string | null;
}

async function fetchWindow(
  url: string,
): Promise<{
  messages: MessageWithParts[];
  total: number | null;
  targetIndex: number | null;
  targetFound: boolean | null;
}> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const data = (await res.json()) as MessageWithParts[] | null;
  const totalHdr = res.headers.get("X-Messages-Total");
  const idxHdr = res.headers.get("X-Target-Index");
  const foundHdr = res.headers.get("X-Target-Found");
  const total = totalHdr !== null ? Number(totalHdr) : null;
  const targetIndex = idxHdr !== null ? Number(idxHdr) : null;
  const targetFound =
    foundHdr === "true" ? true : foundHdr === "false" ? false : null;
  return {
    messages: data ?? [],
    total: Number.isFinite(total) ? total : null,
    targetIndex: Number.isFinite(targetIndex) ? targetIndex : null,
    targetFound,
  };
}

function mergeByIdSorted(
  buckets: MessageWithParts[][],
): MessageWithParts[] {
  const seen = new Map<string, MessageWithParts>();
  for (const bucket of buckets) {
    for (const m of bucket) {
      if (!seen.has(m.info.id)) seen.set(m.info.id, m);
    }
  }
  const all = Array.from(seen.values());
  all.sort((a, b) => {
    const ta = a.info.time?.created ?? 0;
    const tb = b.info.time?.created ?? 0;
    if (ta !== tb) return ta - tb;
    return a.info.id < b.info.id ? -1 : a.info.id > b.info.id ? 1 : 0;
  });
  return all;
}

export function useSessionMessagesAround(
  sessionId: string | undefined,
  targetMessageId: string | null,
  options: { windowSize?: number; latestSize?: number; enabled?: boolean } = {},
): PermalinkWindowState {
  const port = usePort();
  const windowSize = options.windowSize ?? 10;
  const latestSize = options.latestSize ?? 10;
  const enabled = options.enabled !== false;

  const [target, setTarget] = useState<MessageWithParts[]>([]);
  const [before, setBefore] = useState<MessageWithParts[]>([]);
  const [after, setAfter] = useState<MessageWithParts[]>([]);
  const [latest, setLatest] = useState<MessageWithParts[]>([]);
  const [loading, setLoading] = useState({
    target: false,
    before: false,
    after: false,
    latest: false,
  });
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [targetFound, setTargetFound] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = useMemo(() => {
    if (!port || !sessionId) return null;
    return `/api/opencode/${port}/session/${sessionId}/messages`;
  }, [port, sessionId]);

  const cancelTokenRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (!baseUrl) return;
    if (!targetMessageId) return;
    cancelTokenRef.current += 1;
    const myToken = cancelTokenRef.current;
    setTarget([]);
    setBefore([]);
    setAfter([]);
    setLatest([]);
    setTargetIndex(null);
    setTotalCount(null);
    setTargetFound(null);
    setError(null);
    setLoading({
      target: true,
      before: true,
      after: true,
      latest: true,
    });

    const enc = encodeURIComponent(targetMessageId);
    const tasks: Array<() => Promise<void>> = [
      async () => {
        const r = await fetchWindow(`${baseUrl}?id=${enc}`);
        if (myToken !== cancelTokenRef.current) return;
        setTarget(r.messages);
        if (r.targetIndex !== null) setTargetIndex(r.targetIndex);
        if (r.total !== null) setTotalCount(r.total);
        if (r.targetFound !== null) setTargetFound(r.targetFound);
        setLoading((s) => ({ ...s, target: false }));
      },
      async () => {
        const r = await fetchWindow(
          `${baseUrl}?before=${enc}&limit=${windowSize}`,
        );
        if (myToken !== cancelTokenRef.current) return;
        setBefore(r.messages);
        if (r.targetIndex !== null) setTargetIndex(r.targetIndex);
        if (r.total !== null) setTotalCount(r.total);
        setLoading((s) => ({ ...s, before: false }));
      },
      async () => {
        const r = await fetchWindow(
          `${baseUrl}?after=${enc}&limit=${windowSize}`,
        );
        if (myToken !== cancelTokenRef.current) return;
        setAfter(r.messages);
        if (r.targetIndex !== null) setTargetIndex(r.targetIndex);
        if (r.total !== null) setTotalCount(r.total);
        setLoading((s) => ({ ...s, after: false }));
      },
      async () => {
        const r = await fetchWindow(`${baseUrl}?limit=${latestSize}`);
        if (myToken !== cancelTokenRef.current) return;
        setLatest(r.messages);
        setLoading((s) => ({ ...s, latest: false }));
      },
    ];

    void Promise.allSettled(
      tasks.map(async (t) => {
        try {
          await t();
        } catch (err) {
          if (myToken !== cancelTokenRef.current) return;
          setError(err instanceof Error ? err.message : String(err));
        }
      }),
    );

    return () => {
      cancelTokenRef.current += 1;
    };
  }, [enabled, baseUrl, targetMessageId, windowSize, latestSize]);

  const messages = useMemo(
    () => mergeByIdSorted([before, target, after, latest]),
    [before, target, after, latest],
  );

  return {
    messages,
    loading,
    targetFound,
    targetIndex,
    totalCount,
    error,
  };
}
