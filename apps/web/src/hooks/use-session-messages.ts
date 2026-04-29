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
}

export function useSessionMessages(
  sessionId: string | undefined,
  options: UseSessionMessagesOptions = {},
) {
  const port = usePort();
  const key =
    port && sessionId
      ? getMessagesKey(port, sessionId, options.loadAll, options.limit)
      : null;

  const {
    data,
    error,
    isLoading,
    mutate: boundMutate,
  } = useSWR<MessageWithParts[]>(key, fetcher, {
    refreshInterval: 3000,
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
