import { useEffect, useRef } from "react";
import type { Session } from "@opencode-ai/sdk";
import type { SessionStatusMap } from "@/hooks/use-opencode";

interface Args {
  sessions: Session[];
  statusMap: SessionStatusMap | undefined;
  currentSessionId: string | undefined;
}

export function useStatusNotifications({
  sessions,
  statusMap,
  currentSessionId,
}: Args) {
  const prevRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (!statusMap) return;

    const next: Record<string, string> = {};
    const granted = Notification.permission === "granted";

    for (const [id, s] of Object.entries(statusMap)) {
      if (!s) continue;
      const type = s.type;
      next[id] = type;
      if (!granted) continue;

      const wasBusy = prevRef.current[id] === "busy";
      const nowIdle = type === "idle";
      if (!wasBusy || !nowIdle) continue;
      if (id === currentSessionId) continue;

      const onSessionPage = window.location.pathname === `/session/${id}`;
      const isVisible = document.visibilityState === "visible";
      if (onSessionPage && isVisible) continue;

      const session = sessions.find((x) => x.id === id);
      const title = session?.title || "Session done";
      const body = session?.directory || "";
      try {
        const notif = new Notification(title, {
          body,
          tag: `opencode-session-${id}`,
        });
        notif.onclick = () => {
          window.focus();
          window.location.href = `/session/${id}`;
          notif.close();
        };
      } catch {
      }
    }
    prevRef.current = next;
  }, [statusMap, sessions, currentSessionId]);
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
