import { useEffect, useRef } from "react";
import type { Session } from "@opencode-ai/sdk";
import type { SessionStatusMap } from "@/hooks/use-opencode";
import {
  playNotificationSound,
  type NotificationCategory,
} from "@/stores/notification-sound-store";
import {
  useInstanceSettings,
  type NotificationKind,
  type NotifyPolicy,
} from "@/stores/instance-settings-store";

interface Args {
  sessions: Session[];
  statusMap: SessionStatusMap | undefined;
  questionSessionIds: Set<string>;
  onSelect: (sessionId: string) => void;
}

// Per-kind gating + active-tab gate added by Section J. Pre-Section-J:
// always fired when OS permission granted. Post-Section-J: consults
// policy[kind].notify AND policy[kind].notifyEvenIfActiveTab vs.
// document.visibilityState. The default policy still fires on every
// status so existing users see no behavior change unless they opt
// into changes via /settings#notifications.
function shouldFire(kind: NotificationKind, policy: NotifyPolicy): boolean {
  const rule = policy[kind];
  if (!rule.notify) return false;
  if (typeof document === "undefined") return true;
  if (document.visibilityState === "visible" && !rule.notifyEvenIfActiveTab) {
    return false;
  }
  return true;
}

function spawnNotification(
  id: string,
  title: string,
  body: string,
  tagSuffix: string,
  onSelect: (sessionId: string) => void,
  sound: NotificationCategory,
  kind: NotificationKind,
  policy: NotifyPolicy,
) {
  if (!shouldFire(kind, policy)) return;
  playNotificationSound(sound);
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
      onSelect(id);
      notif.close();
    };
  } catch {
    /* permission revoked between check and fire - ignore */
  }
}

// Fires browser notifications on two transitions:
//   1. busy -> idle: "session complete" - notify because the run finished
//   2. question newly appears for a session: "needs attention" - the model
//      asked something and is waiting on the user
// Section J adds a per-kind policy: each kind has notify+notifyEvenIfActiveTab.
// Active tab is detected via document.visibilityState === "visible". When
// the active-tab flag is OFF for a kind, we skip the notification (but
// still play the sound) because the user is already looking at this tab.
//
// Click on either notification focuses the window and invokes
// onSelect(sessionId), which the caller binds to in-app router navigation.
// window.location.href would force a full reload and lose the tab's SWR
// cache, in-flight prompt drafts in localStorage, sidebar scroll position,
// etc.
function shouldFire(
  kind: NotificationKind,
  policy: NotifyPolicy,
): boolean {
  const rule = policy[kind];
  if (!rule || !rule.notify) return false;
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    return rule.notifyEvenIfActiveTab;
  }
  return true;
}

function spawnNotification(
  id: string,
  title: string,
  body: string,
  tagSuffix: string,
  onSelect: (sessionId: string) => void,
  sound: NotificationCategory,
  kind: NotificationKind,
  policy: NotifyPolicy,
) {
  if (!shouldFire(kind, policy)) return;
  playNotificationSound(sound);
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
      onSelect(id);
      notif.close();
    };
  } catch {
    /* permission revoked between check and fire - ignore */
  }
}

export function useStatusNotifications({
  sessions,
  statusMap,
  questionSessionIds,
  onSelect,
}: Args) {
  const { settings } = useInstanceSettings();
  const policyRef = useRef<NotifyPolicy>(settings.notifyPolicy);
  policyRef.current = settings.notifyPolicy;
  const prevStatusRef = useRef<Record<string, string>>({});
  const prevQuestionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (!statusMap) return;

    // opencode's GET /session/status only returns sessions that are
    // currently busy or retrying; an idle session DROPS OUT of the map
    // entirely. So the natural signal for "this session just finished"
    // is: it had an entry last poll, it does NOT have one now.
    // Iterating over Object.entries(statusMap) alone misses that
    // transition entirely - the busy session disappears and we never
    // see it again. We have to walk the union of previous+current keys.
    const next: Record<string, string> = {};
    for (const [id, s] of Object.entries(statusMap)) {
      if (!s) continue;
      next[id] = s.type;
    }

    const allIds = new Set<string>([
      ...Object.keys(prevStatusRef.current),
      ...Object.keys(next),
    ]);
    for (const id of allIds) {
      const prevType = prevStatusRef.current[id];
      const nextType = next[id];
      const wasActive = prevType === "busy" || prevType === "retry";
      const nowIdle = nextType === undefined || nextType === "idle";
      if (!wasActive || !nowIdle) continue;
      const session = sessions.find((x) => x.id === id);
      spawnNotification(
        id,
        session?.title || "Session done",
        session?.directory || "",
        "done",
        onSelect,
        "agent",
        "session-done",
        policyRef.current,
      );
    }
    prevStatusRef.current = next;
  }, [statusMap, sessions, onSelect]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    const prev = prevQuestionsRef.current;
    for (const id of questionSessionIds) {
      if (prev.has(id)) continue;
      const session = sessions.find((x) => x.id === id);
      const title = session?.title
        ? `Question: ${session.title}`
        : "Waiting on your answer";
      spawnNotification(
        id,
        title,
        "AI is asking for input",
        "question",
        onSelect,
        "agent",
        "question",
        policyRef.current,
      );
    }
    prevQuestionsRef.current = new Set(questionSessionIds);
  }, [questionSessionIds, sessions, onSelect]);
}
    prevQuestionsRef.current = new Set(questionSessionIds);
  }, [questionSessionIds, sessions, onSelect]);
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
