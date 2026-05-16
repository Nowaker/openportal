// Mirror of session-status.ts but for /session/:id/todo. opencode's
// todo endpoint is scoped to the opencode-serve CWD, so a session
// whose project.worktree differs from CWD returns nothing without
// ?directory=<wt>. We fan out across known worktrees and return the
// first non-empty result. This matches the discipline in
// session-status.ts.
//
// Background on why this endpoint exists: openportal's previous
// "scan messages array for the latest todowrite tool part" approach
// broke once a session grew past the 50-message tail window (the
// latest todowrite drifts out of range, sidebar/strip goes blank).
// The opencode side persists todos in a separate TodoTable SQLite
// store, which this endpoint reads directly - no window dependency.

import { fetchOpencode } from "./opencode-client";

export type TodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface OpencodeTodoItem {
  content: string;
  status: TodoStatus;
  priority?: string;
}

interface ProjectEntry {
  id: string;
  worktree: string;
}

const PROJECT_CACHE_TTL_MS = 10_000;
const projectCache = new Map<
  number,
  { fetchedAt: number; projects: ProjectEntry[] }
>();

async function listProjects(port: number): Promise<ProjectEntry[]> {
  const cached = projectCache.get(port);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < PROJECT_CACHE_TTL_MS) {
    return cached.projects;
  }
  let projects: ProjectEntry[] = [];
  try {
    const res = await fetchOpencode(port, "/project");
    if (res.ok) {
      const body = (await res.json()) as unknown;
      if (Array.isArray(body)) {
        projects = body
          .filter(
            (p): p is ProjectEntry =>
              !!p &&
              typeof p === "object" &&
              typeof (p as ProjectEntry).id === "string" &&
              typeof (p as ProjectEntry).worktree === "string",
          )
          .map((p) => ({ id: p.id, worktree: p.worktree }));
      }
    }
  } catch {
    /* fall through */
  }
  if (projects.length > 0) {
    projectCache.set(port, { fetchedAt: now, projects });
  } else if (cached) {
    return cached.projects;
  }
  return projects;
}

function normalize(raw: unknown): OpencodeTodoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: OpencodeTodoItem[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const content = typeof r.content === "string" ? r.content : "";
    if (!content) continue;
    const status =
      r.status === "in_progress" ||
      r.status === "completed" ||
      r.status === "cancelled" ||
      r.status === "pending"
        ? (r.status as TodoStatus)
        : "pending";
    const priority = typeof r.priority === "string" ? r.priority : undefined;
    out.push({ content, status, priority });
  }
  return out;
}

async function fetchTodoForDirectory(
  port: number,
  sessionId: string,
  worktree: string,
): Promise<OpencodeTodoItem[]> {
  const path =
    worktree === "/"
      ? `/session/${encodeURIComponent(sessionId)}/todo`
      : `/session/${encodeURIComponent(sessionId)}/todo?directory=${encodeURIComponent(worktree)}`;
  try {
    const res = await fetchOpencode(port, path);
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    return normalize(body);
  } catch {
    return [];
  }
}

export async function getTodosForSession(
  port: number,
  sessionId: string,
  hintedDirectory?: string,
): Promise<OpencodeTodoItem[]> {
  // 1. honor explicit directory hint when provided.
  if (hintedDirectory) {
    const todos = await fetchTodoForDirectory(port, sessionId, hintedDirectory);
    if (todos.length > 0) return todos;
  }

  // 2. otherwise fan out across known worktrees + root, return first
  //    non-empty. opencode's todo store is per-session, so collision
  //    is impossible - we cannot get two different lists for the
  //    same sessionId from different CWDs.
  const projects = await listProjects(port);
  const seen = new Set<string>();
  const targets: string[] = [];
  if (hintedDirectory) {
    seen.add(hintedDirectory);
  }
  for (const p of projects) {
    if (!seen.has(p.worktree)) {
      seen.add(p.worktree);
      targets.push(p.worktree);
    }
  }
  if (!seen.has("/")) targets.push("/");

  for (const wt of targets) {
    const todos = await fetchTodoForDirectory(port, sessionId, wt);
    if (todos.length > 0) return todos;
  }
  return [];
}
