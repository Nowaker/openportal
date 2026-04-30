import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const THUMB_MAX_DIM = 512;
const THUMB_QUALITY = 80;

// Portal-side blob cache for user-uploaded image attachments. opencode's
// SQLite stores `file` parts with `url: "data:image/...;base64,..."` -
// great for shipping bytes to Claude verbatim, awful for `messages?limit=N`
// fetches because the entire base64 payload rides every API response.
// Strategy: on first read, decode the data URL, write the raw bytes to
// ~/.cache/openportal/blobs/<sessionId>/<hash>.<ext>, then rewrite
// part.url to /api/blob/<sessionId>/<hash>.<ext>. Subsequent reads find
// the file on disk and just rewrite the URL. opencode's DB is untouched -
// it still has the inline base64 for model retries / forks / compaction.
//
// Session-id is part of the path purely for cleanup convenience: deleting
// a session can `rm -rf <cache>/<sessionId>/`. Cross-session dedup is
// foregone in exchange (same image in 5 sessions = stored 5 times). At
// the observed scale (~6 MB of duplication across 105 images on this
// host), the disk cost is irrelevant compared to the cleanup ergonomics.
const BLOB_DIR = join(homedir(), ".cache", "openportal", "blobs");

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/s;

export interface StashedBlob {
  hash: string;
  ext: string;
  contentType: string;
  bytes: number;
  hasThumb: boolean;
}

export function stashDataUrl(
  sessionId: string,
  dataUrl: string,
  partMime?: string,
): StashedBlob | null {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return null;
  const contentType = (partMime ?? m[1]).toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  if (buf.length === 0) return null;
  const hash = createHash("sha256")
    .update(buf)
    .digest("hex")
    .slice(0, 16);
  const ext = extFromContentType(contentType);
  const dir = join(BLOB_DIR, sanitizeSegment(sessionId));
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // mkdir EEXIST or perms - the writeFile below will surface a real error
  }
  const path = join(dir, `${hash}.${ext}`);
  if (!existsSync(path)) {
    try {
      writeFileSync(path, buf);
    } catch (e) {
      console.warn(
        `[blob-cache] write failed at ${path}:`,
        e instanceof Error ? e.message : e,
      );
      return null;
    }
  }
  const hasThumb = ensureThumb(dir, hash, contentType, path);
  return { hash, ext, contentType, bytes: buf.length, hasThumb };
}

// Best-effort thumbnail generation via ImageMagick (`magick` first,
// `convert` as IMv6 fallback). Output is a webp at THUMB_MAX_DIM
// longest-edge, quality THUMB_QUALITY. Idempotent: if the thumb file
// already exists, returns true immediately. Returns false on any failure
// (missing magick binary, unsupported format, decode error) so the caller
// knows not to advertise a thumb url. SVG is skipped (already small +
// scalable). The `>` qualifier on -resize prevents upscaling small images.
function ensureThumb(
  dir: string,
  hash: string,
  contentType: string,
  sourcePath: string,
): boolean {
  if (contentType === "image/svg+xml") return false;
  const thumbPath = join(dir, `${hash}.thumb.webp`);
  if (existsSync(thumbPath)) return true;
  const cmds: string[][] = [
    [
      "magick",
      sourcePath,
      "-auto-orient",
      "-resize",
      `${THUMB_MAX_DIM}x${THUMB_MAX_DIM}>`,
      "-quality",
      String(THUMB_QUALITY),
      thumbPath,
    ],
    [
      "convert",
      sourcePath,
      "-auto-orient",
      "-resize",
      `${THUMB_MAX_DIM}x${THUMB_MAX_DIM}>`,
      "-quality",
      String(THUMB_QUALITY),
      thumbPath,
    ],
  ];
  for (const cmd of cmds) {
    try {
      const proc = Bun.spawnSync({
        cmd,
        stdio: ["ignore", "ignore", "ignore"],
      });
      if (proc.exitCode === 0 && existsSync(thumbPath)) return true;
    } catch {
      // binary missing - try next, or fall through
    }
  }
  return false;
}

export function readBlob(
  sessionId: string,
  filename: string,
): { buf: Buffer; contentType: string } | null {
  if (!isSafeSegment(sessionId) || !isSafeSegment(filename)) return null;
  const path = join(BLOB_DIR, sessionId, filename);
  if (!existsSync(path)) return null;
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return { buf, contentType: contentTypeFromExt(ext) };
}

export function hasCachedThumb(sessionId: string, hash: string): boolean {
  if (!isSafeSegment(sessionId) || !isSafeSegment(hash)) return false;
  return existsSync(join(BLOB_DIR, sessionId, `${hash}.thumb.webp`));
}

function extFromContentType(ct: string): string {
  const m = /^image\/([\w.+-]+)/.exec(ct);
  if (!m) return "bin";
  const sub = m[1].toLowerCase();
  if (sub === "jpeg") return "jpg";
  if (sub === "svg+xml") return "svg";
  return sub;
}

function contentTypeFromExt(ext: string): string {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "avif") return "image/avif";
  return "application/octet-stream";
}

// Defensive: route params are user-controlled. Reject anything that could
// escape the per-session blob dir (path traversal, hidden, nul, slashes).
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function isSafeSegment(s: string): boolean {
  return SAFE_SEGMENT_RE.test(s);
}

function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, "_");
}
