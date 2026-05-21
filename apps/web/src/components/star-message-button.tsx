import { useMemo } from "react";
import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import {
  isStarredLocally,
  starMessage,
  unstarMessage,
  useStarredMessages,
} from "@/stores/starred-messages-store";
import { useInstanceStore } from "@/stores/instance-store";

interface StarMessageButtonProps {
  sessionId: string;
  messageId: string;
  role: "user" | "assistant";
  snippet?: string;
}

export function StarMessageButton({
  sessionId,
  messageId,
  role,
  snippet,
}: StarMessageButtonProps) {
  const serverId = useInstanceStore((s) => s.instance?.id ?? null);
  const { data } = useStarredMessages();
  const isStarred = useMemo(
    () =>
      serverId !== null && isStarredLocally(data?.items, serverId, messageId),
    [data?.items, serverId, messageId],
  );
  if (!serverId) return null;
  const trimmedSnippet = snippet
    ? snippet.slice(0, 280).replace(/\s+/g, " ").trim()
    : undefined;
  const onClick = () => {
    if (isStarred) {
      void unstarMessage(serverId, messageId);
    } else {
      void starMessage({
        serverId,
        sessionId,
        messageId,
        role,
        starredAt: Date.now(),
        snippet: trimmedSnippet,
      });
    }
  };
  const Icon = isStarred ? StarIconSolid : StarIconOutline;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isStarred}
      data-test="portal-msg-star"
      className={`rounded p-0.5 transition-colors ${
        isStarred
          ? "text-warning hover:bg-warning-subtle/40"
          : "text-muted-fg/70 hover:bg-muted/40 hover:text-fg"
      }`}
      aria-label={isStarred ? "Unstar message" : "Star message"}
      title={isStarred ? "Remove star" : "Star this message"}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
