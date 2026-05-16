import useSWR, { mutate as globalMutate } from "swr";

const KEY = "/api/state/starred-messages";

export interface StarredMessage {
  serverId: string;
  sessionId: string;
  messageId: string;
  role: "user" | "assistant";
  starredAt: number;
  snippet?: string;
  sessionTitle?: string;
  directory?: string;
}

interface StarredMessagesResponse {
  items: StarredMessage[];
}

const fetcher = async (url: string): Promise<StarredMessagesResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as StarredMessagesResponse;
};

export function useStarredMessages() {
  return useSWR<StarredMessagesResponse>(KEY, fetcher, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    keepPreviousData: true,
  });
}

export function isStarredLocally(
  items: StarredMessage[] | undefined,
  serverId: string,
  messageId: string,
): boolean {
  if (!items) return false;
  return items.some(
    (m) => m.serverId === serverId && m.messageId === messageId,
  );
}

export async function starMessage(entry: StarredMessage): Promise<void> {
  await globalMutate(
    KEY,
    async (prev: StarredMessagesResponse | undefined) => {
      const res = await fetch(KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", ...entry }),
      });
      if (!res.ok) throw new Error(`Failed to star message: ${res.status}`);
      return (await res.json()) as StarredMessagesResponse;
    },
    {
      optimisticData: (prev) => ({
        items: [
          ...(prev?.items ?? []).filter(
            (m) =>
              !(m.serverId === entry.serverId && m.messageId === entry.messageId),
          ),
          entry,
        ],
      }),
      rollbackOnError: true,
      revalidate: false,
    },
  );
}

export async function unstarMessage(
  serverId: string,
  messageId: string,
): Promise<void> {
  await globalMutate(
    KEY,
    async () => {
      const res = await fetch(KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", serverId, messageId }),
      });
      if (!res.ok) throw new Error(`Failed to unstar message: ${res.status}`);
      return (await res.json()) as StarredMessagesResponse;
    },
    {
      optimisticData: (prev) => ({
        items: (prev?.items ?? []).filter(
          (m) => !(m.serverId === serverId && m.messageId === messageId),
        ),
      }),
      rollbackOnError: true,
      revalidate: false,
    },
  );
}
