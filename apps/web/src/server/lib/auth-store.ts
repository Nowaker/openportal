// Persistent per-server credentials.
//
// Lives at ~/.openportal/openportal-auth.json, mode 0600. Keyed by the
// configured server's id. Schema:
//
//   { "<serverId>": { "username": string, "password": string } }
//
// The sibling .gitignore (managed by portal-paths.ts) keeps this file
// out of any git repo the user might create at ~/.openportal/. We never
// log the password; the only time it appears in process memory is
// inside the in-process map plus when forwarded to opencode as Basic
// auth.
//
// Distinct from the in-memory ephemeral-server auth (resolver pulls
// that from process env each time and never persists it). The auth
// store is for non-ephemeral servers — manually-added remote opencodes
// that need creds the user supplies once.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { authFilePath, tightenAuthFilePerms } from "./portal-paths";

export interface StoredCreds {
  username: string;
  password: string;
}

interface AuthDoc {
  [serverId: string]: StoredCreds;
}

function readDoc(): AuthDoc {
  const path = authFilePath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: AuthDoc = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        v &&
        typeof v === "object" &&
        typeof (v as { username?: unknown }).username === "string" &&
        typeof (v as { password?: unknown }).password === "string"
      ) {
        const creds = v as StoredCreds;
        out[k] = { username: creds.username, password: creds.password };
      }
    }
    return out;
  } catch (e) {
    console.warn(
      `[auth-store] Failed to read auth file (treating as empty):`,
      e instanceof Error ? e.message : e,
    );
    return {};
  }
}

function writeDoc(doc: AuthDoc): void {
  const path = authFilePath();
  // Always go through writeFileSync + tightenAuthFilePerms so the
  // window the file exists with default perms is as short as possible.
  // No pretty-printing — this file is not human-edited.
  writeFileSync(path, JSON.stringify(doc) + "\n", "utf-8");
  tightenAuthFilePerms();
}

export function getAuth(serverId: string): StoredCreds | undefined {
  return readDoc()[serverId];
}

export function setAuth(serverId: string, creds: StoredCreds): void {
  const doc = readDoc();
  doc[serverId] = creds;
  writeDoc(doc);
}

export function clearAuth(serverId: string): void {
  const doc = readDoc();
  if (!(serverId in doc)) return;
  delete doc[serverId];
  writeDoc(doc);
}
