import { getSettings, setSetting } from "./portal-state";

const NAMESPACE = "content";

export type Visibility =
  | "show-fully"
  | "show-max-bytes"
  | "show-max-bytes-with-ajax"
  | "ajax-only"
  | "hide";

export const ALL_VISIBILITIES: readonly Visibility[] = [
  "show-fully",
  "show-max-bytes",
  "show-max-bytes-with-ajax",
  "ajax-only",
  "hide",
];

export type ContentType =
  | "reasoning"
  | "tool-call-params"
  | "tool-call-output"
  | "file-read"
  | "file-write"
  | "bash-command"
  | "bash-output"
  | "omo-injection"
  | "compaction-summary"
  | "attached-file"
  | "synthetic-marker";

export const ALL_CONTENT_TYPES: readonly ContentType[] = [
  "reasoning",
  "tool-call-params",
  "tool-call-output",
  "file-read",
  "file-write",
  "bash-command",
  "bash-output",
  "omo-injection",
  "compaction-summary",
  "attached-file",
  "synthetic-marker",
];

export interface ContentRule {
  visibility: Visibility;
  maxBytes: number | null;
}

export interface ContentSettings {
  rules: Record<ContentType, ContentRule>;
}

const DEFAULT_RULE: ContentRule = { visibility: "show-fully", maxBytes: null };

function defaultRules(): Record<ContentType, ContentRule> {
  const out = {} as Record<ContentType, ContentRule>;
  for (const t of ALL_CONTENT_TYPES) {
    out[t] = { ...DEFAULT_RULE };
  }
  // OMO injections were already AJAX-fetched on demand pre-Section-I
  // (via /api/opencode/[port]/session/[id]/message/[msgId]/omo/[blockId])
  // so preserve that default rather than newly forwarding the full text.
  out["omo-injection"] = { visibility: "ajax-only", maxBytes: null };
  return out;
}

const DEFAULTS: ContentSettings = { rules: defaultRules() };

function isVisibility(v: unknown): v is Visibility {
  return typeof v === "string" && (ALL_VISIBILITIES as readonly string[]).includes(v);
}

function validateRule(raw: unknown): ContentRule {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_RULE };
  const r = raw as Partial<ContentRule>;
  const visibility = isVisibility(r.visibility) ? r.visibility : DEFAULT_RULE.visibility;
  let maxBytes: number | null = null;
  if (typeof r.maxBytes === "number" && Number.isFinite(r.maxBytes) && r.maxBytes > 0) {
    maxBytes = Math.floor(r.maxBytes);
  }
  return { visibility, maxBytes };
}

function readConfig(): ContentSettings {
  const raw = getSettings()[NAMESPACE];
  if (!raw || typeof raw !== "object") return { rules: defaultRules() };
  const rawRules = (raw as { rules?: unknown }).rules;
  if (!rawRules || typeof rawRules !== "object") return { rules: defaultRules() };
  const out: Record<ContentType, ContentRule> = defaultRules();
  for (const t of ALL_CONTENT_TYPES) {
    out[t] = validateRule((rawRules as Record<string, unknown>)[t]);
  }
  return { rules: out };
}

function writeConfig(config: ContentSettings): ContentSettings {
  setSetting(NAMESPACE, config);
  return config;
}

export function getContentSettings(): ContentSettings {
  return readConfig();
}

export function setContentRule(
  contentType: ContentType,
  rule: ContentRule,
): ContentSettings {
  const config = readConfig();
  config.rules[contentType] = validateRule(rule);
  return writeConfig(config);
}

export function resetContentSettings(): ContentSettings {
  return writeConfig({ ...DEFAULTS, rules: defaultRules() });
}
