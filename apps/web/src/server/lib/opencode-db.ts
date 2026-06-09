import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Read-only access to opencode's SHARED sqlite DB (the one opencode itself
// owns at ~/.local/share/opencode/opencode.db). This is the authoritative,
// always-current source of session activity: opencode writes message rows
// as turns progress regardless of whether its /event SSE or /session/status
// HTTP surface is delivering (both starve when opencode's event loop is
// pegged under heavy multi-session load). Portal reads it to derive the
// in-progress indicator that the HTTP path can't reliably provide.

function opencodeDbPath(): string {
  const explicit = process.env.OPENPORTAL_OPENCODE_DB_PATH;
  if (explicit && explicit.length > 0) return explicit;
  return join(homedir(), ".local", "share", "opencode", "opencode.db");
}

let handle: Database | null = null;
let openFailed = false;

function getDb(): Database | null {
  if (handle) return handle;
  if (openFailed) return null;
  const path = opencodeDbPath();
  if (!existsSync(path)) {
    openFailed = true;
    return null;
  }
  try {
    handle = new Database(path, { readonly: true });
    return handle;
  } catch {
    openFailed = true;
    return null;
  }
}

interface SessionIdRow {
  session_id: string;
}

// Sessions whose latest assistant turn is unfinished (`time.completed` is
// null) and whose message row was written within `windowMs`. An unfinished
// assistant turn means the session is NOT done, so it must render
// in-progress rather than idle/review-needed.
//
// The freshness window is the boundary between "in-progress" and the
// classic stuck case: a crashed/abandoned turn leaves `time.completed`
// null forever, so without a window it would show in-progress permanently.
// Portal deliberately does NOT decide stuck (that's the stuck-detector's
// job, which overlays the distinct "stuck" verdict when enabled); the
// window simply stops dead turns from masquerading as in-progress.
//
// Cheap on the 3GB DB (~0.04s): the `json_extract` predicates only run on
// the small set of rows passing the `time_updated` cutoff.
export function queryInFlightSessionIds(windowMs: number): Set<string> {
  const db = getDb();
  if (!db) return new Set();
  const cutoff = Date.now() - windowMs;
  try {
    const rows = db
      .query(
        `SELECT DISTINCT session_id FROM message
         WHERE time_updated > ?
           AND json_extract(data, '$.role') = 'assistant'
           AND json_extract(data, '$.time.completed') IS NULL`,
      )
      .all(cutoff) as SessionIdRow[];
    const out = new Set<string>();
    for (const r of rows) if (r.session_id) out.add(r.session_id);
    return out;
  } catch {
    return new Set();
  }
}

export function isOpencodeDbAvailable(): boolean {
  return getDb() !== null;
}

export function closeOpencodeDbForTesting(): void {
  handle?.close();
  handle = null;
  openFailed = false;
}
