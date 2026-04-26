import useSWR, { mutate } from "swr";
import type {
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

export type { Message, Part, ToolPart, ToolState, TextPart, PermissionRequest, QuestionAnswer, QuestionInfo, QuestionOption, QuestionRequest };

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
}

export function useSessionMessages(
  sessionId: string | undefined,
  options: UseSessionMessagesOptions = {},
) {
  const port = usePort();
  const key =
    port && sessionId ? getMessagesKey(port, sessionId, options.loadAll) : null;

  const {
    data,
    error,
    isLoading,
    mutate: boundMutate,
  } = useSWR<MessageWithParts[]>(key, fetcher, {
    refreshInterval: 3000,
    keepPreviousData: true,
    revalidateOnFocus: false,
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
) {
  const base = `/api/opencode/${port}/session/${sessionId}/messages`;
  return loadAll ? `${base}?limit=all` : base;
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

export function addOptimisticMessage(
  port: number,
  sessionId: string,
  message: MessageWithParts,
): () => void {
  const previousByKey = new Map<string, MessageWithParts[]>();
  const keys = [
    getMessagesKey(port, sessionId, false),
    getMessagesKey(port, sessionId, true),
  ];

  for (const key of keys) {
    mutate(
      key,
      (current: MessageWithParts[] | undefined) => {
        const prev = current ?? [];
        previousByKey.set(key, prev);
        return [...prev, message];
      },
      { revalidate: false },
    );
  }

  return () => {
    for (const [key, prev] of previousByKey.entries()) {
      mutate(key, prev, { revalidate: false });
    }
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
