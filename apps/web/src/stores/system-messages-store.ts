import { create } from "zustand";

// In-memory ring buffer for OpenPortal-side system events (connection
// lost/restored, service restart attempted/failed, plugin install
// events, notification permission flips, anything else that today
// fires a toast-and-forgets). Surfaced via the drawer mounted in the
// app shell so important messages survive the 4s toast dwell.
//
// Per the AI_TODO.md #29 spec: in-memory only (per browser tab),
// last N events. localStorage persistence is a v2 follow-up.

export type SystemMessageCategory =
  | "connection"
  | "restart"
  | "install"
  | "stuck-detector"
  | "notification"
  | "version"
  | "other";

export type SystemMessageLevel = "info" | "warning" | "error" | "success";

export interface SystemMessage {
  id: string;
  timestamp: number;
  category: SystemMessageCategory;
  level: SystemMessageLevel;
  message: string;
  details?: string;
  acknowledged: boolean;
  // Absent / null = system-wide event (connection, version, etc.).
  // Set to a session.directory path for events scoped to one project,
  // so the top-right hamburger drawer can filter to "current project
  // + system-wide" while the left-sidebar dropdown shows everything.
  projectDirectory?: string | null;
}

export interface DrawerFilter {
  // null projectDirectory = show only system-wide messages (rare;
  // mostly internal). When set to a directory path, the drawer shows
  // messages with that projectDirectory plus all system-wide ones.
  projectDirectory: string | null;
}

const MAX_MESSAGES = 200;

interface SystemMessagesState {
  messages: SystemMessage[];
  unreadCount: number;
  isOpen: boolean;
  filter: DrawerFilter | null;
  add: (m: Omit<SystemMessage, "id" | "timestamp" | "acknowledged">) => void;
  acknowledge: (id: string) => void;
  acknowledgeAll: () => void;
  clear: () => void;
  openDrawer: () => void;
  openProjectFiltered: (projectDirectory: string | null) => void;
  openUnfiltered: () => void;
  closeDrawer: () => void;
}

export const useSystemMessagesStore = create<SystemMessagesState>((set) => ({
  messages: [],
  unreadCount: 0,
  isOpen: false,
  filter: null,
  add: (m) =>
    set((s) => {
      const next: SystemMessage = {
        id: `sm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        acknowledged: false,
        ...m,
      };
      const messages = [next, ...s.messages].slice(0, MAX_MESSAGES);
      const unreadCount = messages.filter((x) => !x.acknowledged).length;
      return { messages, unreadCount };
    }),
  acknowledge: (id) =>
    set((s) => {
      const messages = s.messages.map((m) =>
        m.id === id ? { ...m, acknowledged: true } : m,
      );
      return { messages, unreadCount: messages.filter((x) => !x.acknowledged).length };
    }),
  acknowledgeAll: () =>
    set((s) => ({
      messages: s.messages.map((m) => ({ ...m, acknowledged: true })),
      unreadCount: 0,
    })),
  clear: () => set({ messages: [], unreadCount: 0 }),
  openDrawer: () => set({ isOpen: true }),
  openProjectFiltered: (projectDirectory) =>
    set({ isOpen: true, filter: { projectDirectory } }),
  openUnfiltered: () => set({ isOpen: true, filter: null }),
  closeDrawer: () => set({ isOpen: false }),
}));

// Convenience helper to add a system message from any call site.
// Use this alongside (NOT instead of) toast.* calls — the drawer is
// the durable log; toast is the ephemeral notification.
//
// projectDirectory is optional: pass session.directory (or
// useInstanceStore.getState().currentSession?.directory) for
// project-scoped events; omit for system-wide ones (connection
// status, version mismatch, etc.) so they always show regardless of
// the active project filter.
export function logSystemMessage(
  category: SystemMessageCategory,
  level: SystemMessageLevel,
  message: string,
  details?: string,
  projectDirectory?: string | null,
): void {
  useSystemMessagesStore.getState().add({
    category,
    level,
    message,
    details,
    projectDirectory,
  });
}
