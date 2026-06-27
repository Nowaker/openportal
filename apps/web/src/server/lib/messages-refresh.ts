// Shared fetch + strip + cache pipeline for opencode session messages.
//
// Owns the canonical write path into the messages cache. Two producers
// call into this module:
//
//   1. The /api/opencode/<port>/session/<id>/messages handler
//      (apps/web/src/server/opencode/[port]/session/[id]/messages.ts)
//      uses fetchAndCacheMessages() to load fresh data on cache miss /
//      forced-refresh. Foreground producer, blocking the SWR fetch.
//
//   2. The indicator-broadcaster plugin
//      (apps/web/src/server/plugins/indicator-broadcaster.ts) uses
//      scheduleRefreshMessages() to keep the cache continuously warm
//      while opencode is emitting message.part.delta /
//      message.part.updated / message.updated events. Background
//      producer, never blocks a request.
//
// Why one shared pipeline: the cache contents must be byte-identical
// regardless of which producer wrote them - same diagnostics stripping,
// same OMO body stash, same blob-rewrite, same permission audit
// attachment. Without this module those flows had to live behind the
// foreground handler, so the broadcaster fell back to wiping the
// cache on every delta and waiting for the next foreground request
// to repopulate. That blank-window-on-return is exactly what this
// module fixes (AI_TODO #85).
//
// Refresh throttle: leading-edge debounce per session. The first
// event in a burst schedules a 1.5s timer; subsequent events within
// the window coalesce into the pending refresh. inFlight map
// serializes refreshes per session so two timers landing
// simultaneously can't stack two SDK calls.
//
// Errors swallowed in the refresh path: the cache already holds the
// last authoritative snapshot. A failed background refresh is fine -
// the next event re-arms the timer, and worst case the foreground
// handler still re-fetches on cache-TTL expiry. The user's
// caching-proxy invariant is preserved: only authoritative removals
// (message.removed, session.deleted) clear cache entries.

import { fetchOpencode, getOpencodeClient } from "./opencode-client";
import { readFileSync } from "node:fs";
import { stashDataUrl, hasCachedThumb } from "./blob-cache";
import { setCachedMessages } from "./messages-cache";
import { parseOmoBlocks } from "../../lib/omo-injection";
import { putOmoBody } from "./omo-strip-cache";
import { getToolOutputMaxBytes } from "./instance-settings-state";
import {
  getContentSettings,
  type ContentRule,
  type ContentSettings,
} from "./content-settings-state";

// SDK-first with a raw-fetch fallback for defense in depth.
//
// Background: at one point opencode itself returned HTTP 400 for the
// entire /session/{id}/message response when even one message in the
// session failed its effect-schema validation. The fallback path
// kicks in iff the SDK returns an error envelope (the SDK doesn't
// throw on schema mismatch - it sets result.error instead) AND the
// raw endpoint accepts a limit cap that excludes whatever the SDK is
// choking on. Defense in depth.
const FALLBACK_FETCH_LIMIT = 1000;

// Refresh debounce: leading-edge, per session. First event arms the
// timer; subsequent events within the window are coalesced. Cache
// lags opencode reality by at most this much under streaming load.
// Tradeoff between cache freshness and opencode SDK call rate.
const REFRESH_DEBOUNCE_MS = 1500;

const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Single-flight per session. Without this, two refreshes landing
// simultaneously (timer expiry + an explicit foreground call) would
// stack two SDK calls and double the merge churn in the cache.
const inFlight = new Map<string, Promise<unknown[]>>();

// Background refresh kicked off by the indicator-broadcaster on
// message.part.delta / message.part.updated / message.updated.
// Leading-edge throttle: the first event in a burst schedules the
// timer, subsequent events within the window are absorbed. Burst of
// 50 deltas in 200ms => one refresh; steady 5 deltas/sec => one
// refresh per REFRESH_DEBOUNCE_MS.
export function scheduleRefreshMessages(port: number, sessionId: string): void {
  if (refreshTimers.has(sessionId)) return;
  const timer = setTimeout(() => {
    refreshTimers.delete(sessionId);
    void fetchAndCacheMessages(port, sessionId).catch(() => {
      /* Silent: stale cache is still authoritative until the next
         successful refresh or foreground call. */
    });
  }, REFRESH_DEBOUNCE_MS);
  refreshTimers.set(sessionId, timer);
}

// Foreground entry point: blocks until opencode answers, applies the
// strip pipeline, writes the cache, returns the raw array. Throws
// when the SDK + raw-fetch fallback both fail; callers map that to
// the stale-cache / 503 fallback.
export async function fetchAndCacheMessages(
  port: number,
  sessionId: string,
): Promise<unknown[]> {
  const existing = inFlight.get(sessionId);
  if (existing) return existing;
  const p = doFetchAndCache(port, sessionId).finally(() => {
    inFlight.delete(sessionId);
  });
  inFlight.set(sessionId, p);
  return p;
}

async function doFetchAndCache(
  port: number,
  sessionId: string,
): Promise<unknown[]> {
  const client = await getOpencodeClient(port);
  const result = await client.session.messages({ path: { id: sessionId } });
  const data = (result as { data?: unknown }).data;
  let raw: unknown[];
  if (Array.isArray(data)) {
    raw = data;
  } else {
    const err = (result as { error?: { name?: string; data?: unknown } }).error;
    const status = (result as { response?: { status?: number } }).response
      ?.status;
    console.warn(
      `[messages-refresh] SDK rejected /session/${sessionId}/message ` +
        `(status=${status ?? "?"} error=${err?.name ?? "unknown"}); ` +
        `falling back to raw fetch with limit=${FALLBACK_FETCH_LIMIT}`,
    );
    const res = await fetchOpencode(
      port,
      `/session/${encodeURIComponent(sessionId)}/message?limit=${FALLBACK_FETCH_LIMIT}`,
    );
    if (!res.ok) {
      throw new Error(
        `opencode /session/${sessionId}/message fallback returned ${res.status} ${res.statusText}`,
      );
    }
    const body = (await res.json().catch(() => null)) as unknown;
    raw = Array.isArray(body) ? body : [];
  }

  const stripped = stripDiagnosticFixes(raw);
  stripUserMessageSummary(stripped);
  stripPartBloat(stripped);
  stripOmoFromUserText(stripped, sessionId);
  rewriteImageDataUrls(stripped, sessionId);
  const arr = Array.isArray(stripped) ? stripped : [];
  setCachedMessages(sessionId, arr);
  return arr;
}

// Replace OMO injection bodies inside user-text parts with compact
// reference markers. The full content gets stashed in an in-memory
// cache keyed by (sessionId, messageId, blockId) so the chat can
// lazily fetch it on expand.
function stripOmoFromUserText(messages: unknown, sessionId: string): void {
  if (!Array.isArray(messages)) return;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as {
      info?: { id?: string; role?: string };
      parts?: unknown;
    };
    if (m.info?.role !== "user") continue;
    const messageId = m.info?.id;
    if (!messageId) continue;
    const parts = m.parts;
    if (!Array.isArray(parts)) continue;
    for (let pIdx = 0; pIdx < parts.length; pIdx++) {
      const part = parts[pIdx] as { type?: string; text?: unknown };
      if (part?.type !== "text" || typeof part.text !== "string") continue;
      const original = part.text;
      const blocks = parseOmoBlocks(original, {
        directoryContextResolver: readDirectoryContextSource,
      });
      if (!blocks.some((b) => b.kind === "omo")) continue;
      let blockIdx = 0;
      const out: string[] = [];
      for (const b of blocks) {
        if (b.kind === "user") {
          out.push(b.text);
          continue;
        }
        const blockId = `${pIdx}.${blockIdx++}`;
        putOmoBody(sessionId, messageId, blockId, b.text);
        const meta = JSON.stringify({
          id: blockId,
          header: b.header ?? "",
          summary: b.summary ?? "",
          bytes: b.text.length,
          segments: b.segments,
        });
        out.push(`<!--OMO-STRIPPED:${encodeURIComponent(meta)}-->`);
      }
      (part as { text: string }).text = out.join("");
    }
  }
}

function readDirectoryContextSource(filePath: string): string | null {
  if (filePath.includes("\0") || !filePath.endsWith("/AGENTS.md")) {
    return null;
  }
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

// Aggressive per-part field stripping for opencode's persisted-but-
// unused metadata. Each entry is a path INSIDE a part object (under
// either `part` or `part.data` for the newer/older opencode shapes);
// the field is deleted from every matching part.
function stripPartBloat(messages: unknown): void {
  if (!Array.isArray(messages)) return;
  const legacyCap = getToolOutputMaxBytes();
  const content = getContentSettings();
  for (const msg of messages) {
    const parts = (msg as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      stripOnePartBloat(part, legacyCap, content);
    }
  }
}

function stripOnePartBloat(
  part: unknown,
  legacyCap: number | null,
  content: ContentSettings,
): void {
  if (!part || typeof part !== "object") return;
  const p = part as Record<string, unknown> & {
    type?: string;
    text?: string;
    state?: Record<string, unknown> & { metadata?: Record<string, unknown> };
    data?: {
      state?: Record<string, unknown> & { metadata?: Record<string, unknown> };
      text?: string;
      snapshot?: unknown;
    };
    metadata?: { anthropic?: { signature?: unknown } };
    snapshot?: unknown;
    synthetic?: unknown;
    ignored?: unknown;
  };

  if (p.type === "reasoning") {
    if (p.metadata?.anthropic && "signature" in p.metadata.anthropic) {
      delete p.metadata.anthropic.signature;
    }
    const inner = (
      p.data as
        | { metadata?: { anthropic?: { signature?: unknown } } }
        | undefined
    )?.metadata?.anthropic;
    if (inner && "signature" in inner) delete inner.signature;
    applyTextRule(p, content.rules.reasoning, "reasoning");
  }

  if (p.type === "step-start" || p.type === "step-finish") {
    if ("snapshot" in p) delete p.snapshot;
    if (p.data && "snapshot" in p.data) delete p.data.snapshot;
  }

  if (p.type === "text" && p.synthetic === true && p.ignored === true) {
    applyTextRule(p, content.rules["synthetic-marker"], "synthetic-marker");
  }

  for (const state of partStates(p)) {
    if (!state || typeof state !== "object") continue;
    const outputRule = content.rules["tool-call-output"];
    const outputCap = effectiveCap(outputRule, legacyCap);
    applyValueRule(state, "output", outputRule, outputCap, "tool-call-output");
    if ("title" in state) delete state.title;
    stripHeavyInputFields(state, p.type);
    const meta = state.metadata as Record<string, unknown> | undefined;
    if (meta && typeof meta === "object") {
      applyValueRule(meta, "output", outputRule, outputCap, "tool-call-output");
      for (const k of [
        "description",
        "diff",
        "filediff",
        "filepath",
        "preview",
      ]) {
        if (k in meta) delete meta[k];
      }
    }
  }
}

function effectiveCap(
  rule: ContentRule,
  legacyCap: number | null,
): number | null {
  if (rule.visibility === "show-fully") return legacyCap;
  if (rule.visibility === "hide" || rule.visibility === "ajax-only") return 0;
  return rule.maxBytes;
}

function applyTextRule(
  part: Record<string, unknown>,
  rule: ContentRule,
  hint: string,
): void {
  if (rule.visibility === "show-fully") return;
  const text = typeof part.text === "string" ? part.text : null;
  if (text === null) return;
  if (rule.visibility === "hide") {
    part.text = "";
    part._stripped = { hint, reason: "hide" };
    return;
  }
  if (rule.visibility === "ajax-only") {
    part._stripped = { hint, reason: "ajax-only", bytes: text.length };
    part.text = "";
    return;
  }
  if (rule.maxBytes !== null && text.length > rule.maxBytes) {
    part.text =
      text.slice(0, rule.maxBytes) +
      `\n\n[...truncated ${text.length - rule.maxBytes} bytes - configure in Settings -> Content]`;
    if (rule.visibility === "show-max-bytes-with-ajax") {
      part._stripped = {
        hint,
        reason: "truncated-with-ajax",
        bytes: text.length,
      };
    }
  }
}

function applyValueRule(
  obj: Record<string, unknown>,
  key: string,
  rule: ContentRule,
  effective: number | null,
  hint: string,
): void {
  if (!(key in obj)) return;
  if (effective === null) return;
  if (effective === 0) {
    delete obj[key];
    obj[`_${key}_stripped`] = {
      hint,
      reason: rule.visibility === "hide" ? "hide" : "ajax-only",
    };
    return;
  }
  const v = obj[key];
  if (typeof v === "string") {
    if (v.length > effective) {
      obj[key] =
        v.slice(0, effective) +
        `\n\n[...truncated ${v.length - effective} bytes - configure in Settings -> Content]`;
      if (rule.visibility === "show-max-bytes-with-ajax") {
        obj[`_${key}_stripped`] = {
          hint,
          reason: "truncated-with-ajax",
          bytes: v.length,
        };
      }
    }
  }
}

function stripHeavyInputFields(
  state: Record<string, unknown>,
  partType: string | undefined,
): void {
  if (partType !== "tool") return;
  const input = state.input as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object") return;
  const tool = String((state.tool ?? state.name ?? "") || "").toLowerCase();
  if (tool === "edit") {
    if (typeof input.oldString === "string") {
      (input as Record<string, unknown>)._oldLines = (
        input.oldString as string
      ).split("\n").length;
      delete input.oldString;
    }
    if (typeof input.newString === "string") {
      (input as Record<string, unknown>)._newLines = (
        input.newString as string
      ).split("\n").length;
      delete input.newString;
    }
  } else if (tool === "write") {
    if (typeof input.content === "string") {
      (input as Record<string, unknown>)._contentLines = (
        input.content as string
      ).split("\n").length;
      delete input.content;
    }
  } else if (tool === "task") {
    if (typeof input.prompt === "string") {
      delete input.prompt;
    }
  }
}

function partStates(p: {
  state?: Record<string, unknown>;
  data?: { state?: Record<string, unknown> };
}): Array<Record<string, unknown> | undefined> {
  return [p.state, p.data?.state];
}

function stripUserMessageSummary(messages: unknown): void {
  if (!Array.isArray(messages)) return;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as {
      info?: { summary?: unknown };
      data?: { summary?: unknown };
    };
    if (m.info && "summary" in m.info) delete m.info.summary;
    if (m.data && "summary" in m.data) delete m.data.summary;
  }
}

interface MetadataLike {
  metadata?: { diagnostics?: unknown };
}

function stripDiagnosticFixes(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  for (const msg of messages) {
    const parts = (msg as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      stripPartDiagnostics(part);
    }
  }
  return messages;
}

function stripPartDiagnostics(part: unknown): void {
  if (!part || typeof part !== "object") return;
  const candidates: Array<MetadataLike | undefined> = [
    (part as { state?: MetadataLike }).state,
    ((part as { data?: { state?: MetadataLike } }).data ?? {}).state,
  ];
  for (const c of candidates) {
    if (c?.metadata && "diagnostics" in c.metadata) {
      delete c.metadata.diagnostics;
    }
  }
}

// Rewrite `file` parts whose `url` is an inline `data:image/...;base64,...`
// string: stash the bytes under ~/.cache/openportal/blobs/<sessionId>/
// and replace the url with /api/blob/<sessionId>/<hash>.<ext>.
// Idempotent on already-rewritten parts.
function rewriteImageDataUrls(messages: unknown, sessionId: string): void {
  if (!Array.isArray(messages)) return;
  for (const msg of messages) {
    const parts = (msg as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const p = part as {
        type?: string;
        url?: string;
        mime?: string;
        thumb?: string;
      };
      if (p.type !== "file") continue;
      if (typeof p.url !== "string") continue;
      if (p.url.startsWith("data:")) {
        const stashed = stashDataUrl(sessionId, p.url, p.mime);
        if (!stashed) continue;
        p.url = `/api/blob/${sessionId}/${stashed.hash}.${stashed.ext}`;
        if (stashed.hasThumb) {
          p.thumb = `/api/blob/${sessionId}/${stashed.hash}.thumb.webp`;
        }
        continue;
      }
      const m = /^\/api\/blob\/[^/]+\/([0-9a-f]{16})\.[a-z0-9]+$/i.exec(p.url);
      if (m && hasCachedThumb(sessionId, m[1])) {
        p.thumb = `/api/blob/${sessionId}/${m[1]}.thumb.webp`;
      }
    }
  }
}
