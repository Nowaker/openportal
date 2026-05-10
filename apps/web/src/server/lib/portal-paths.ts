// Centralised path resolution for OpenPortal config + auth.
//
// Layout under ~/.openportal/:
//
//   openportal.json       Main config: directories[], servers[],
//                         activeServerId. Human-editable, safe to share.
//   openportal-auth.json  Per-server credentials. Mode 0600. Never share.
//                         Sibling .gitignore makes sure that even if the
//                         dir becomes a git repo someday, this file is
//                         not tracked.
//   .gitignore            `openportal-auth.json` (just that one line —
//                         everything else is intentionally trackable so
//                         users can dotfile-sync their non-secret config).
//
// Migration: a single ~/.openportal.json that lived in $HOME directly
// gets moved into ~/.openportal/openportal.json the first time we run.
// Idempotent — safe on every startup.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

const PORTAL_DIR = join(homedir(), ".openportal");
const CONFIG_FILE = join(PORTAL_DIR, "openportal.json");
const AUTH_FILE = join(PORTAL_DIR, "openportal-auth.json");
const GITIGNORE_FILE = join(PORTAL_DIR, ".gitignore");

const LEGACY_CONFIG_FILE = join(homedir(), ".openportal.json");

const GITIGNORE_LINE = "openportal-auth.json";

let migrationRun = false;

function ensureDir(): void {
  if (!existsSync(PORTAL_DIR)) {
    mkdirSync(PORTAL_DIR, { recursive: true });
  }
}

function ensureGitignore(): void {
  // Idempotent: write the file only if missing or doesn't already
  // contain the auth-file line. We don't manage other entries — the user
  // can drop their own (e.g. *.bak) without us clobbering.
  let current = "";
  try {
    if (existsSync(GITIGNORE_FILE)) {
      current = readFileSync(GITIGNORE_FILE, "utf-8");
    }
  } catch {
    current = "";
  }
  const lines = current.split(/\r?\n/);
  if (lines.some((l) => l.trim() === GITIGNORE_LINE)) return;
  const next = current.endsWith("\n") || current === ""
    ? current + GITIGNORE_LINE + "\n"
    : current + "\n" + GITIGNORE_LINE + "\n";
  try {
    writeFileSync(GITIGNORE_FILE, next, "utf-8");
  } catch {
    // best-effort; failing here doesn't break anything functional
  }
}

function migrateLegacyConfig(): void {
  // The classic ~/.openportal.json (top-level dotfile) needs to move to
  // ~/.openportal/openportal.json. The fully-tested path is "the new
  // file doesn't exist yet AND the legacy one does"; in any other state
  // we leave both alone and prefer the new file in the readers.
  if (!existsSync(LEGACY_CONFIG_FILE)) return;
  if (existsSync(CONFIG_FILE)) return;
  try {
    renameSync(LEGACY_CONFIG_FILE, CONFIG_FILE);
    console.log(
      `[openportal-config] Migrated ${LEGACY_CONFIG_FILE} -> ${CONFIG_FILE}`,
    );
  } catch (e) {
    console.warn(
      `[openportal-config] Could not migrate legacy config:`,
      e instanceof Error ? e.message : e,
    );
  }
}

// Run by the first reader of any portal path. Cheap and idempotent so
// we don't bother memoising a "have we initialized?" flag per call —
// just gate the FS work behind `migrationRun` so the rename + gitignore
// write only fire once per process.
export function ensurePortalLayout(): void {
  if (migrationRun) return;
  migrationRun = true;
  try {
    ensureDir();
    migrateLegacyConfig();
    ensureGitignore();
  } catch (e) {
    console.warn(
      `[openportal-config] Portal layout init failed:`,
      e instanceof Error ? e.message : e,
    );
  }
}

export function configFilePath(): string {
  ensurePortalLayout();
  return CONFIG_FILE;
}

export function authFilePath(): string {
  ensurePortalLayout();
  return AUTH_FILE;
}

// Set 0600 on a freshly-written auth file. Best-effort — Windows doesn't
// honor POSIX mode, and a chmod failure isn't fatal (the file is in the
// user's home anyway). Callers should call this immediately after
// writeFileSync to keep the window where the file exists with default
// perms as short as possible.
export function tightenAuthFilePerms(): void {
  try {
    chmodSync(AUTH_FILE, 0o600);
  } catch {
    // ignore (e.g. Windows)
  }
}
