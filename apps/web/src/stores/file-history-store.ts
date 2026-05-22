import { create } from "zustand";
import { persist } from "zustand/middleware";

// Shared storage + filter primitives for the file-browser's three
// dropdowns: recently-opened, recently-mentioned, bookmarked.
//
// Display rule (per user spec): the current project is guaranteed
// max/2 slots even when its newest entries are older than
// non-project entries. The other max/2 slots fill with the most
// recent non-project entries. Total displayed = max.
//
// Storage rule: the eviction policy must keep at least max/2 entries
// per project, so 'distant' history for a project never disappears
// just because other projects are hot. The cap is enforced as
// "evict the oldest entry from projects that exceed max/2"; if every
// project is at exactly max/2, the store temporarily exceeds the
// nominal cap rather than violate the guarantee.

export interface FileHistoryEntry {
  path: string;
  isDir: boolean;
  ts: number;
}

interface FileHistoryState {
  recentlyOpened: FileHistoryEntry[];
  bookmarks: FileHistoryEntry[];
  maxDisplay: number;
  recordOpened: (path: string, isDir: boolean) => void;
  toggleBookmark: (path: string, isDir: boolean) => void;
  isBookmarked: (path: string) => boolean;
  removeBookmark: (path: string) => void;
  setMaxDisplay: (n: number) => void;
}

const STORAGE_HEADROOM_FACTOR = 10;

function dedupAndPrepend(
  list: FileHistoryEntry[],
  entry: FileHistoryEntry,
): FileHistoryEntry[] {
  const filtered = list.filter((e) => e.path !== entry.path);
  return [entry, ...filtered];
}

export const useFileHistoryStore = create<FileHistoryState>()(
  persist(
    (set, get) => ({
      recentlyOpened: [],
      bookmarks: [],
      maxDisplay: 20,
      setMaxDisplay: (n) =>
        set({ maxDisplay: Math.max(1, Math.min(200, Math.floor(n))) }),
      recordOpened: (path, isDir) =>
        set((s) => ({
          recentlyOpened: dedupAndPrepend(s.recentlyOpened, {
            path,
            isDir,
            ts: Date.now(),
          }).slice(0, 20 * STORAGE_HEADROOM_FACTOR),
        })),
      toggleBookmark: (path, isDir) =>
        set((s) => {
          const idx = s.bookmarks.findIndex((e) => e.path === path);
          if (idx >= 0) {
            return {
              bookmarks: s.bookmarks.filter((e) => e.path !== path),
            };
          }
          return {
            bookmarks: dedupAndPrepend(s.bookmarks, {
              path,
              isDir,
              ts: Date.now(),
            }).slice(0, 20 * STORAGE_HEADROOM_FACTOR),
          };
        }),
      isBookmarked: (path) =>
        get().bookmarks.some((e) => e.path === path),
      removeBookmark: (path) =>
        set((s) => ({
          bookmarks: s.bookmarks.filter((e) => e.path !== path),
        })),
    }),
    { name: "openportal-file-history" },
  ),
);

// Pick max entries with the current-project guarantee.
// 'project' is the absolute path of the current project (or null
// when the file browser is opened outside a session context).
export function prioritizeForProject(
  entries: FileHistoryEntry[],
  project: string | null,
  max: number,
): FileHistoryEntry[] {
  if (max <= 0) return [];
  if (!project) return entries.slice(0, max);
  const inProject = entries.filter(
    (e) => e.path === project || e.path.startsWith(project + "/"),
  );
  const outProject = entries.filter(
    (e) => e.path !== project && !e.path.startsWith(project + "/"),
  );
  const reserve = Math.floor(max / 2);
  const fromProject = inProject.slice(0, reserve);
  const remaining = max - fromProject.length;
  const fromOutside = outProject.slice(0, remaining);
  const afterFill = max - fromProject.length - fromOutside.length;
  const overflowProject =
    afterFill > 0
      ? inProject.slice(fromProject.length, fromProject.length + afterFill)
      : [];
  return [...fromProject, ...overflowProject, ...fromOutside];
}

// True when an entry is in the current project (used by the UI
// to draw the in-project / out-of-project visual separator).
export function isInProject(
  entry: FileHistoryEntry,
  project: string | null,
): boolean {
  if (!project) return false;
  return entry.path === project || entry.path.startsWith(project + "/");
}
