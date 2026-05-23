import { create } from "zustand";

export type SystemMessageCategory =
  | "connection"
  | "restart"
  | "install"
  | "stuck-detector"
  | "notification"
  | "version"
  | "session"
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
  projectDirectory?: string | null;
  sessionId?: string | null;
}

// Three scope modes the user can toggle between in the drawer header:
//   all     - every message regardless of project / session
//   project - messages tagged with this projectDirectory + system-wide
//   session - messages tagged with this sessionId + system-wide
// System-wide messages (no projectDirectory + no sessionId) always
// show in 'project' and 'session' modes so the user never loses
// connection / version / restart events when narrowing the view.
export type DrawerFilterKind = "all" | "project" | "session";

export interface DrawerFilter {
  kind: DrawerFilterKind;
  projectDirectory: string | null;
  sessionId: string | null;
}

const MAX_MESSAGES = 200;
const STORAGE_KEY = "openportal-system-messages-v1";

// Hydrate the persisted ring buffer at module load. We persist ONLY
// the messages array (and derived unreadCount); isOpen + filter are
// ephemeral UI state. Wrapped in try/catch because:
//  - localStorage may be unavailable (SSR, private mode, sandboxed iframe)
//  - the stored JSON may be corrupted by a partial write or a schema
//    drift; treat any parse failure as "no history" so the drawer
//    starts clean rather than crashing the app shell.
// We trim to MAX_MESSAGES on hydrate so a stored buffer from a prior
// session that exceeded the cap (e.g. from a debug-mode build with a
// higher cap) gets clamped to the current limit.
function loadMessages(): SystemMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid: SystemMessage[] = [];
    for (const item of parsed) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as SystemMessage).id === "string" &&
        typeof (item as SystemMessage).timestamp === "number" &&
        typeof (item as SystemMessage).message === "string"
      ) {
        valid.push(item as SystemMessage);
      }
    }
    return valid.slice(0, MAX_MESSAGES);
  } catch {
    return [];
  }
}

// Persist after every mutation. Wrapped in try/catch because localStorage
// can throw on quota exceeded (extremely unlikely at 200 * ~500 bytes =
// ~100KB but possible if the user has many other apps stuffed in there).
// We swallow the error rather than break the in-memory state - the
// drawer keeps working, it just won't survive the next reload.
function saveMessages(messages: SystemMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // ignore
  }
}

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
  openProjectFiltered: (projectDirectory: string | null, sessionId?: string | null) => void;
  openSessionFiltered: (projectDirectory: string | null, sessionId: string | null) => void;
  openUnfiltered: (projectDirectory?: string | null, sessionId?: string | null) => void;
  setFilter: (filter: DrawerFilter) => void;
  closeDrawer: () => void;
}

const initialMessages = loadMessages();

export const useSystemMessagesStore = create<SystemMessagesState>((set) => ({
  messages: initialMessages,
  unreadCount: initialMessages.filter((x) => !x.acknowledged).length,
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
      saveMessages(messages);
      return { messages, unreadCount };
    }),
  acknowledge: (id) =>
    set((s) => {
      const messages = s.messages.map((m) =>
        m.id === id ? { ...m, acknowledged: true } : m,
      );
      const unreadCount = messages.filter((x) => !x.acknowledged).length;
      saveMessages(messages);
      return { messages, unreadCount };
    }),
  acknowledgeAll: () =>
    set((s) => {
      const messages = s.messages.map((m) => ({ ...m, acknowledged: true }));
      saveMessages(messages);
      return { messages, unreadCount: 0 };
    }),
  clear: () => {
    saveMessages([]);
    return set({ messages: [], unreadCount: 0 });
  },
  openDrawer: () => set({ isOpen: true }),
  openProjectFiltered: (projectDirectory, sessionId = null) =>
    set({
      isOpen: true,
      filter: { kind: "project", projectDirectory, sessionId },
    }),
  openSessionFiltered: (projectDirectory, sessionId) =>
    set({
      isOpen: true,
      filter: { kind: "session", projectDirectory, sessionId },
    }),
  openUnfiltered: (projectDirectory = null, sessionId = null) =>
    set({
      isOpen: true,
      filter: { kind: "all", projectDirectory, sessionId },
    }),
  setFilter: (filter) => set({ filter }),
  closeDrawer: () => set({ isOpen: false }),
}));

// Cross-tab sync: a second openportal tab that writes a new message
// fires a `storage` event in this tab. We re-hydrate the ring buffer
// in-place so both tabs show the same audit log. e.newValue null
// means another tab called clear() - sync to empty.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    const messages = loadMessages();
    useSystemMessagesStore.setState({
      messages,
      unreadCount: messages.filter((x) => !x.acknowledged).length,
    });
  });
}

export function logSystemMessage(
  category: SystemMessageCategory,
  level: SystemMessageLevel,
  message: string,
  details?: string,
  projectDirectory?: string | null,
  sessionId?: string | null,
): void {
  useSystemMessagesStore.getState().add({
    category,
    level,
    message,
    details,
    projectDirectory,
    sessionId,
  });
}
