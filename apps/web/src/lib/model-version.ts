// Parses opencode model IDs into (family, version, betaStatus) per the
// rules the user spelled out: model "family" is "Opus", "Opus Fast",
// "GPT Nano", "Gemini Pro" — i.e. the model identity minus the version
// number. Version is the numeric suffix. Beta status is a side flag
// for "preview" / "beta" / "alpha" / "rc" / etc. on top of the family
// + version, so a beta of v3.1 is still grouped under the same family
// and falls below the non-beta release at v3.0 in "latest" ordering.

export const BETA_MARKERS = new Set([
  "preview",
  "beta",
  "alpha",
  "rc",
  "experimental",
  "ea",
  "dev",
  "snapshot",
  "nightly",
]);

export interface ParsedModel {
  providerID: string;
  modelID: string;
  // Canonical family name in display form: "Opus", "Opus Fast",
  // "GPT Nano", "GPT Mini Fast", "Gemini Pro", "Gemini Flash Lite".
  family: string;
  // Stable grouping key: `${providerID}:${family-slug}`. Same family
  // across "Opus 4.7" and "Opus 4.8" share this key.
  familyKey: string;
  // Numeric version components for comparison: [4, 7] for "4.7".
  // Empty array when the model has no numeric version in the ID.
  versionNumeric: number[];
  // Human-friendly version, e.g. "4.7", "5.0". Empty when no version.
  versionDisplay: string;
  // Beta status if the ID carried one. null otherwise.
  betaStatus: string | null;
}

const NUMERIC_TOKEN = /^\d+(\.\d+)?$/;
const DATE_SUFFIX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_8DIGIT = /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;

function isNumeric(token: string): boolean {
  return NUMERIC_TOKEN.test(token);
}

function toFamilyKey(provider: string, familyTokens: string[]): string {
  return `${provider}:${familyTokens.join("-").toLowerCase()}`;
}

function displayFamily(provider: string, familyTokens: string[]): string {
  const base =
    provider === "anthropic"
      ? ""
      : provider === "google"
        ? "Gemini "
        : provider === "openai" || provider === "opencode"
          ? "GPT "
          : `${provider} `;
  const rest = familyTokens.map(titleCase).join(" ");
  const out = (base + rest).trim();
  return out || titleCase(provider);
}

function titleCase(word: string): string {
  if (!word) return word;
  if (word === word.toUpperCase()) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function parseNumericVersion(tokens: string[]): {
  numeric: number[];
  display: string;
} {
  if (tokens.length === 0) return { numeric: [], display: "" };
  // tokens like "4", "7" become "4.7"; a single "5.5" stays "5.5".
  const joined = tokens.join(".");
  const parts = joined.split(".").map((p) => Number(p));
  const numeric = parts.every((n) => Number.isFinite(n)) ? parts : [];
  const display =
    numeric.length === 1 ? `${numeric[0]}.0` : numeric.join(".");
  return { numeric, display };
}

// Strip trailing date / alias suffixes that aren't part of the family
// or version semantics. Three shapes handled:
//   YYYY-MM-DD (3 dash-separated tokens, e.g. gpt-5-nano-2025-08-07)
//   YYYYMMDD   (single 8-digit token, e.g. claude-opus-4-20250514)
//   "latest"   (alias suffix, e.g. claude-3-5-haiku-latest)
function stripDateSuffix(tokens: string[]): string[] {
  if (tokens.length === 0) return tokens;
  if (tokens[tokens.length - 1].toLowerCase() === "latest") {
    return stripDateSuffix(tokens.slice(0, -1));
  }
  if (
    tokens.length >= 1 &&
    DATE_8DIGIT.test(tokens[tokens.length - 1])
  ) {
    return stripDateSuffix(tokens.slice(0, -1));
  }
  if (tokens.length >= 3) {
    const last3 = tokens.slice(-3).join("-");
    if (DATE_SUFFIX.test(last3)) return stripDateSuffix(tokens.slice(0, -3));
  }
  return tokens;
}

function splitId(modelID: string): string[] {
  return modelID.split("-").filter(Boolean);
}

function parseProviderPrefixed(
  providerID: string,
  modelID: string,
  prefix: string | null,
): ParsedModel {
  let tokens = splitId(modelID);
  if (prefix && tokens[0] === prefix) tokens = tokens.slice(1);
  tokens = stripDateSuffix(tokens);

  // Walk the tokens, classifying each as family / version / beta.
  // Version: contiguous numeric tokens (joined with "."). The version
  // run can be interrupted only by tokens that look like family
  // suffixes (so we don't accidentally pick up a "4" inside a name
  // that happens to start with a number). For the families we care
  // about (Opus / Sonnet / Haiku / GPT / GPT Nano / Gemini Pro) the
  // version always sits between the family-prefix tokens and the
  // family-suffix tokens, contiguous, so this works.
  const familyBefore: string[] = [];
  const familyAfter: string[] = [];
  const versionTokens: string[] = [];
  let beta: string | null = null;
  let sawVersion = false;

  for (const t of tokens) {
    if (BETA_MARKERS.has(t.toLowerCase())) {
      if (!beta) beta = t.toLowerCase();
      continue;
    }
    if (isNumeric(t)) {
      versionTokens.push(t);
      sawVersion = true;
      continue;
    }
    if (sawVersion) {
      familyAfter.push(t);
    } else {
      familyBefore.push(t);
    }
  }

  const familyTokens = [...familyBefore, ...familyAfter];
  const { numeric, display } = parseNumericVersion(versionTokens);

  return {
    providerID,
    modelID,
    family: displayFamily(providerID, familyTokens),
    familyKey: toFamilyKey(providerID, familyTokens),
    versionNumeric: numeric,
    versionDisplay: display,
    betaStatus: beta,
  };
}

function parseGeneric(providerID: string, modelID: string): ParsedModel {
  return {
    providerID,
    modelID,
    family: modelID,
    familyKey: `${providerID}:${modelID.toLowerCase()}`,
    versionNumeric: [],
    versionDisplay: "",
    betaStatus: null,
  };
}

export function parseModelId(
  providerID: string,
  modelID: string,
): ParsedModel {
  if (!modelID) return parseGeneric(providerID, modelID);
  switch (providerID) {
    case "anthropic":
      return parseProviderPrefixed(providerID, modelID, "claude");
    case "openai":
    case "opencode":
      return parseProviderPrefixed(providerID, modelID, "gpt");
    case "google":
      return parseProviderPrefixed(providerID, modelID, "gemini");
    default:
      return parseGeneric(providerID, modelID);
  }
}

// Compare two parsed models for "latest first" sort order:
//  1. higher versionNumeric beats lower (lexicographic on the array,
//     shorter padded with zeros so [5] == [5,0])
//  2. tie-break: non-beta beats beta of the same version (so 4.7-stable
//     ranks above 4.7-preview when both are present in the same family)
//  3. final tie-break: alphabetical model ID for stability
export function compareModelVersion(
  a: ParsedModel,
  b: ParsedModel,
): number {
  const len = Math.max(a.versionNumeric.length, b.versionNumeric.length);
  for (let i = 0; i < len; i++) {
    const av = a.versionNumeric[i] ?? 0;
    const bv = b.versionNumeric[i] ?? 0;
    if (av !== bv) return bv - av;
  }
  // Same version, beta tiebreaker.
  const aBeta = a.betaStatus ? 1 : 0;
  const bBeta = b.betaStatus ? 1 : 0;
  if (aBeta !== bBeta) return aBeta - bBeta;
  return a.modelID.localeCompare(b.modelID);
}

// Group all models from a providers list by familyKey, returning a
// map keyed by familyKey -> sorted-latest-first list.
export function groupByFamily(
  providersData:
    | {
        providers?: Array<{
          id: string;
          models?: Record<string, { id?: string; name?: string }>;
        }>;
      }
    | null
    | undefined,
): Map<string, ParsedModel[]> {
  const out = new Map<string, ParsedModel[]>();
  if (!providersData?.providers) return out;
  for (const p of providersData.providers) {
    if (!p.models) continue;
    for (const m of Object.values(p.models)) {
      const modelID = m.id ?? "";
      if (!modelID) continue;
      const parsed = parseModelId(p.id, modelID);
      const list = out.get(parsed.familyKey);
      if (list) list.push(parsed);
      else out.set(parsed.familyKey, [parsed]);
    }
  }
  for (const list of out.values()) {
    list.sort(compareModelVersion);
  }
  return out;
}

// Resolve a family + version-rule pair to a specific model ID.
//  "latest" -> first entry (groupByFamily sorted latest-first)
//  "specific" + version -> exact match by versionDisplay, fall back to latest
export function resolveModelInFamily(
  groups: Map<string, ParsedModel[]>,
  familyKey: string,
  rule: "latest" | "specific",
  version?: string,
): ParsedModel | null {
  const list = groups.get(familyKey);
  if (!list || list.length === 0) return null;
  if (rule === "specific" && version) {
    const exact = list.find((m) => m.versionDisplay === version);
    if (exact) return exact;
  }
  return list[0] ?? null;
}
