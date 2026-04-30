#!/usr/bin/env bun
//
// Walk every session on the opencode instance Portal is bound to and force
// each through the Portal /messages?limit=all endpoint once. The proxy's
// blob-rewrite side effect (apps/web/src/server/lib/blob-cache.ts +
// messages.ts) extracts every inline data:image base64 URL to
// ~/.cache/openportal/blobs/<sessionId>/<hash>.<ext> as a side effect of
// the fetch, so this script is a one-shot prewarmer: after it runs, every
// future messages?limit=N fetch from any browser tab returns rewritten
// /api/blob URLs immediately without paying the first-time decode cost.
//
// Usage:
//   bun run apps/web/scripts/warm-blob-cache.ts
//   bun run apps/web/scripts/warm-blob-cache.ts --portal http://100.105.229.19:5000
//   PORTAL_URL=http://localhost:5000 bun run apps/web/scripts/warm-blob-cache.ts
//
// Exits 0 on success, 1 on connection failure to Portal, 2 on any
// per-session fetch failure (continues running through the rest of
// sessions; a non-zero exit just signals "something was skipped").
//
// Read-only with respect to opencode; only writes to ~/.cache/openportal.

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface PortalSelf {
  instance: { port: number } | null;
}

interface SessionSummary {
  id: string;
  title?: string;
  directory?: string;
}

const args = process.argv.slice(2);
const portalArgIdx = args.indexOf("--portal");
const portalBase =
  (portalArgIdx >= 0 ? args[portalArgIdx + 1] : undefined) ??
  process.env.PORTAL_URL ??
  "http://localhost:5000";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} -> HTTP ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function dirSizeBytes(path: string): number {
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      total += dirSizeBytes(full);
    } else if (entry.isFile()) {
      try {
        total += statSync(full).size;
      } catch {
        // file vanished mid-walk - ignore
      }
    }
  }
  return total;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function main() {
  console.log(`[warm] Portal: ${portalBase}`);
  let self: PortalSelf;
  try {
    self = await fetchJson<PortalSelf>(`${portalBase}/api/instance/self`);
  } catch (e) {
    console.error(
      `[warm] FAIL: cannot reach ${portalBase}/api/instance/self: ${e instanceof Error ? e.message : e}`,
    );
    process.exit(1);
  }
  if (!self.instance) {
    console.error(`[warm] FAIL: Portal returned no instance metadata`);
    process.exit(1);
  }
  const port = self.instance.port;
  console.log(`[warm] opencode port: ${port}`);

  const cacheRoot = join(homedir(), ".cache", "openportal", "blobs");
  const beforeBytes = dirSizeBytes(cacheRoot);
  const beforeSessions = existsSync(cacheRoot)
    ? readdirSync(cacheRoot).length
    : 0;
  console.log(
    `[warm] cache before: ${beforeSessions} session dirs, ${fmtBytes(beforeBytes)}`,
  );

  let sessions: SessionSummary[];
  try {
    sessions = await fetchJson<SessionSummary[]>(
      `${portalBase}/api/opencode/${port}/sessions`,
    );
  } catch (e) {
    console.error(
      `[warm] FAIL: cannot list sessions: ${e instanceof Error ? e.message : e}`,
    );
    process.exit(1);
  }
  console.log(`[warm] sessions to scan: ${sessions.length}`);

  let scanned = 0;
  let failed = 0;
  let totalImages = 0;
  for (const s of sessions) {
    scanned += 1;
    const url = `${portalBase}/api/opencode/${port}/session/${encodeURIComponent(
      s.id,
    )}/messages?limit=all`;
    let body: string;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.text();
    } catch (e) {
      failed += 1;
      console.warn(
        `[warm] [${scanned}/${sessions.length}] ${s.id}: SKIP (${e instanceof Error ? e.message : e})`,
      );
      continue;
    }
    const imageHits = (body.match(/"\/api\/blob\/[^"]+"/g) ?? []).length;
    totalImages += imageHits;
    if (imageHits > 0 || scanned % 25 === 0) {
      const label = (s.title ?? "").slice(0, 40);
      console.log(
        `[warm] [${scanned}/${sessions.length}] ${s.id}  images=${imageHits}  ${label}`,
      );
    }
  }

  const afterBytes = dirSizeBytes(cacheRoot);
  const afterSessions = existsSync(cacheRoot)
    ? readdirSync(cacheRoot).length
    : 0;

  console.log("");
  console.log(`[warm] DONE`);
  console.log(`  sessions scanned:    ${scanned}`);
  console.log(`  sessions failed:     ${failed}`);
  console.log(`  blob URLs in payloads (sum): ${totalImages}`);
  console.log(
    `  cache after: ${afterSessions} session dirs, ${fmtBytes(afterBytes)}`,
  );
  console.log(
    `  delta:       +${afterSessions - beforeSessions} session dirs, +${fmtBytes(
      afterBytes - beforeBytes,
    )}`,
  );
  if (failed > 0) process.exit(2);
}

await main();
