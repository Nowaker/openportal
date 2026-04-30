import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { useStreamingStore } from "@/stores/streaming-store";
import { useInstanceStore } from "@/stores/instance-store";

interface OpencodeEvent {
  type: string;
  properties?: { sessionID?: unknown };
  time?: number;
}

// Subscribes to /api/opencode/<port>/event (Portal SSE proxy of opencode's
// /event endpoint) when the user has flipped streaming on. Each parsed
// event maps to ONE or MORE SWR mutate() calls so the affected hook
// (useSessionStatus / useQuestions / usePermissions / useSessions /
// useSessionMessages) re-fetches just-in-time. The native EventSource
// auto-reconnects on connection drop with exponential backoff. Closing
// the EventSource on unmount or when streaming flips off propagates
// cancellation back through the proxy and tears down the upstream
// opencode connection.
//
// Why per-key mutate vs. global mutate(()=>true): a single
// message.part.delta on a long-running session would otherwise cause
// every SWR cache entry in the app to refetch, including the heavy
// /messages?limit=50 for sessions the user isn't even looking at.
export function useEventStream(): void {
  const enabled = useStreamingStore((s) => s.enabled);
  const port = useInstanceStore((s) => s.instance?.port);
  const { mutate } = useSWRConfig();

  useEffect(() => {
    if (!enabled) return;
    if (!port) return;
    const url = `/api/opencode/${port}/event`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      let parsed: OpencodeEvent;
      try {
        parsed = JSON.parse(ev.data) as OpencodeEvent;
      } catch {
        return;
      }
      dispatchEvent(port, parsed, mutate);
    };
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };
    return () => {
      es.close();
    };
  }, [enabled, port, mutate]);
}

type Mutator = ReturnType<typeof useSWRConfig>["mutate"];

function dispatchEvent(port: number, e: OpencodeEvent, mutate: Mutator): void {
  const sid =
    typeof e.properties?.sessionID === "string"
      ? e.properties.sessionID
      : null;
  switch (e.type) {
    case "message.updated":
    case "message.part.updated":
    case "message.part.delta":
    case "message.part.removed":
    case "message.removed":
    case "todo.updated":
      if (sid) {
        const prefix = `/api/opencode/${port}/session/${sid}/messages`;
        void mutate(
          (key) => typeof key === "string" && key.startsWith(prefix),
        );
      }
      return;
    case "session.status":
    case "session.idle":
      void mutate(`/api/opencode/${port}/session/status`);
      return;
    case "question.asked":
    case "question.replied":
    case "question.rejected":
      void mutate(`/api/opencode/${port}/questions`);
      return;
    case "permission.asked":
    case "permission.replied":
      void mutate(`/api/opencode/${port}/permissions`);
      return;
    case "session.created":
    case "session.updated":
    case "session.deleted":
    case "session.compacted":
    case "session.error":
      void mutate(`/api/opencode/${port}/sessions`);
      return;
    default:
      // server.connected, lsp.*, file.*, vcs.*, pty.*, tui.*, workspace.*,
      // mcp.*, command.*, project.updated, installation.*, etc.: not
      // currently consumed by Portal's SWR cache.
      return;
  }
}
