import { useEffect, useRef } from "react";
import type { Session } from "@opencode-ai/sdk";
import type { SessionStatusMap } from "@/hooks/use-opencode";

interface Args {
  sessions: Session[];
  statusMap: SessionStatusMap | undefined;
  currentSessionId: string | undefined;
  questionSessionIds: Set<string>;
}

// Fires browser notifications on two transitions:
//   1. busy -> idle: "session complete" - notify because the run finished
//   2. question newly appears for a session: "needs attention" - the model
//      asked something and is waiting on the user
// Both suppress when the user is currently viewing the affected session
// AND the tab is visible. Click on either notification focuses the window
// and navigates to that session.
function spawnNotification(
  id: string,
  title: string,
  body: string,
  tagSuffix: string,
) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const notif = new Notification(title, {
      body,
      tag: `opencode-session-${id}-${tagSuffix}`,
    });
    notif.onclick = () => {
      window.focus();
      window.location.href = `/session/${id}`;
      notif.close();
    };
  } catch {
    /* permission revoked between check and fire - ignore */
  }
}

function shouldSuppress(id: string, currentSessionId: string | undefined) {
  if (id === currentSessionId) return true;
  if (typeof window === "undefined") return true;
  const onSessionPage = window.location.pathname === `/session/${id}`;
  const isVisible = document.visibilityState === "visible";
  return onSessionPage && isVisible;
}

export function useStatusNotifications({
  sessions,
  statusMap,
  currentSessionId,
  questionSessionIds,
}: Args) {
  const prevStatusRef = useRef<Record<string, string>>({});
  const prevQuestionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (!statusMap) return;

    const next: Record<string, string> = {};
    for (const [id, s] of Object.entries(statusMap)) {
      if (!s) continue;
      next[id] = s.type;
      const wasBusy = prevStatusRef.current[id] === "busy";
      const nowIdle = s.type === "idle";
      if (!wasBusy || !nowIdle) continue;
      if (shouldSuppress(id, currentSessionId)) continue;
      const session = sessions.find((x) => x.id === id);
      spawnNotification(
        id,
        session?.title || "Session done",
        session?.directory || "",
        "done",
      );
    }
    prevStatusRef.current = next;
  }, [statusMap, sessions, currentSessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    const prev = prevQuestionsRef.current;
    for (const id of questionSessionIds) {
      if (prev.has(id)) continue;
      if (shouldSuppress(id, currentSessionId)) continue;
      const session = sessions.find((x) => x.id === id);
      const title = session?.title
        ? `Question: ${session.title}`
        : "Waiting on your answer";
      spawnNotification(id, title, "AI is asking for input", "question");
    }
    prevQuestionsRef.current = new Set(questionSessionIds);
  }, [questionSessionIds, sessions, currentSessionId]);
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined") return "denied";
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}
