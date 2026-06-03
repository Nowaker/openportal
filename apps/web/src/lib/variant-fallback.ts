// Variants are opencode's "thinking effort" tiers exposed by
// /config/providers as models[id].variants — an object keyed by
// variant name (minimal / low / medium / high / max). Not all
// models have all variants; some models have none. When the user
// (or auto-switch logic) changes models, the currently-selected
// variant may not exist on the new model, and the composer would
// silently send an unsupported variant to opencode. This module
// implements the "first higher available, else highest" fallback
// the user requested.

export const VARIANT_ORDER = [
  "",
  "minimal",
  "low",
  "medium",
  "high",
  "max",
] as const;

export type VariantName = (typeof VARIANT_ORDER)[number] | string;

function rank(variant: string): number {
  const idx = VARIANT_ORDER.indexOf(variant as (typeof VARIANT_ORDER)[number]);
  return idx === -1 ? -1 : idx;
}

export interface ProvidersShape {
  providers?: Array<{
    id: string;
    models?: Record<string, { variants?: Record<string, unknown> | null }>;
  }>;
}

export function variantsForModel(
  providersData: ProvidersShape | undefined,
  providerID: string | undefined,
  modelID: string | undefined,
): string[] {
  if (!providersData?.providers || !providerID || !modelID) return [];
  const p = providersData.providers.find((x) => x.id === providerID);
  if (!p?.models) return [];
  const m = p.models[modelID];
  if (!m?.variants) return [];
  return Object.keys(m.variants);
}

// Pick the variant from `available` that best matches `current`:
//   - prefer first variant in `available` whose rank >= rank(current)
//     (when ordered by VARIANT_ORDER, low to high)
//   - else fall back to the highest-ranked variant in `available`
//   - else "" (no variant)
// Unknown variants (not in VARIANT_ORDER) score below known ones; if
// `current` is unknown, treat its rank as 0 (just below "minimal") so
// the search falls through to the highest available.
export function pickClosestVariant(
  current: string,
  available: string[],
): string {
  if (available.length === 0) return "";
  // If the current variant is still supported, keep it.
  if (current && available.includes(current)) return current;
  // Sort available by VARIANT_ORDER rank, ascending. Unknowns sink.
  const sorted = available
    .map((v) => ({ v, r: rank(v) }))
    .sort((a, b) => a.r - b.r)
    .map(({ v }) => v);
  const currentRank = rank(current);
  for (const v of sorted) {
    if (rank(v) >= currentRank) return v;
  }
  // No variant is at least as high as current — pick the highest.
  return sorted[sorted.length - 1] ?? "";
}
