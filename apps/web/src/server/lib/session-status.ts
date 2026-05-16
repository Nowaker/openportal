import { fetchOpencode } from "./opencode-client";

export type SessionStatusType = "busy" | "retry" | "idle";

export interface SessionStatusEntry {
  type: SessionStatusType;
}

export type SessionStatusMap = Record<string, SessionStatusEntry>;

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
    /* fall through to cached (possibly stale) or empty */
  }
  if (projects.length > 0) {
    projectCache.set(port, { fetchedAt: now, projects });
  } else if (cached) {
    return cached.projects;
  }
  return projects;
}

async function fetchStatusForDirectory(
  port: number,
  worktree: string,
): Promise<SessionStatusMap> {
  const path =
    worktree === "/"
      ? "/session/status"
      : `/session/status?directory=${encodeURIComponent(worktree)}`;
  try {
    const res = await fetchOpencode(port, path);
    if (!res.ok) return {};
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== "object") return {};
    const out: SessionStatusMap = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const type = (v as { type?: unknown }).type;
      if (type === "busy" || type === "retry" || type === "idle") {
        out[k] = { type };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function getMergedSessionStatus(
  port: number,
): Promise<SessionStatusMap> {
  const projects = await listProjects(port);
  const worktrees =
    projects.length > 0
      ? projects.map((p) => p.worktree)
      : ["/"];
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const wt of worktrees) {
    if (!seen.has(wt)) {
      seen.add(wt);
      targets.push(wt);
    }
  }
  if (!seen.has("/")) {
    targets.unshift("/");
  }
  const results = await Promise.all(
    targets.map((wt) => fetchStatusForDirectory(port, wt)),
  );
  const merged: SessionStatusMap = {};
  for (const map of results) {
    for (const [k, v] of Object.entries(map)) {
      merged[k] = v;
    }
  }
  return merged;
}

export async function getSessionStatusForSession(
  port: number,
  sessionId: string,
  hintedDirectory?: string,
): Promise<SessionStatusEntry | null> {
  if (hintedDirectory) {
    const map = await fetchStatusForDirectory(port, hintedDirectory);
    if (map[sessionId]) return map[sessionId];
  }
  const merged = await getMergedSessionStatus(port);
  return merged[sessionId] ?? null;
}
