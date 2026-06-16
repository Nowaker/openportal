// Shared model-visibility helpers. Mirrors opencode's
// packages/app/src/context/models.tsx default-visibility rules:
//   - Explicit user override ("show" | "hide") always wins
//   - Otherwise: visible iff the model is the "latest" in its family
//     (most-recent release_date within its (provider, family) AND that
//     date is within the last 6 months)
//   - Models with no parseable release_date default to visible (fail-open;
//     do not silently hide everything when metadata is missing)

import type { Visibility } from "@/stores/model-visibility-store";

export interface RawModel {
  id: string;
  name: string;
  providerID: string;
  family?: string;
  release_date?: string;
  // Preserved from opencode's provider data so downstream consumers
  // (e.g. variantsForModel) keep their shape after visibility filtering.
  variants?: Record<string, unknown> | null;
}

export interface RawProvider {
  id: string;
  name: string;
  models: Record<string, RawModel>;
}

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

export function modelKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function isWithinLast6Months(iso: string): boolean {
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return false;
  return Math.abs(Date.now() - d) < SIX_MONTHS_MS;
}

// For each provider, group models by `family` and pick the one with the
// most-recent release_date. If that release is within the last 6 months,
// the model is added to the "latest" set and shown by default.
export function computeLatestSet(providers: RawProvider[]): Set<string> {
  const out = new Set<string>();
  for (const provider of providers) {
    const byFamily = new Map<string, RawModel[]>();
    for (const m of Object.values(provider.models ?? {})) {
      // Models without a family are bucketed alone so each "wins" its
      // own family group; matches the opencode behaviour where every
      // un-grouped model gets a chance to be the latest of itself.
      const f = m.family ?? `__nofamily__:${m.id}`;
      const arr = byFamily.get(f) ?? [];
      arr.push(m);
      byFamily.set(f, arr);
    }
    for (const family of byFamily.values()) {
      let best: RawModel | null = null;
      let bestTime = -Infinity;
      for (const m of family) {
        if (!m.release_date) continue;
        const t = Date.parse(m.release_date);
        if (!Number.isFinite(t)) continue;
        if (t > bestTime) {
          bestTime = t;
          best = m;
        }
      }
      if (best?.release_date && isWithinLast6Months(best.release_date)) {
        out.add(modelKey(provider.id, best.id));
      }
    }
  }
  return out;
}

export function isModelVisible(
  providerId: string,
  modelId: string,
  releaseDate: string | undefined,
  latestSet: Set<string>,
  override: Visibility | undefined,
): boolean {
  if (override === "show") return true;
  if (override === "hide") return false;
  if (latestSet.has(modelKey(providerId, modelId))) return true;
  if (!releaseDate || !Number.isFinite(Date.parse(releaseDate))) return true;
  return false;
}

// Returns a filtered providers list (same shape) keeping only models
// that pass isModelVisible() for the given server's overrides. Providers
// that end up with zero visible models are dropped. Pure function -
// safe to call inside useMemo.
export function filterVisibleProviders<P extends RawProvider>(
  providers: P[],
  serverId: string | null,
  overrides: Record<string, Visibility>,
  latestSet: Set<string>,
): P[] {
  if (!serverId) return providers;
  const out: P[] = [];
  for (const provider of providers) {
    const visibleModels: Record<string, RawModel> = {};
    for (const [id, m] of Object.entries(provider.models ?? {})) {
      const key = modelKey(provider.id, id);
      const ov = overrides[key];
      if (isModelVisible(provider.id, id, m.release_date, latestSet, ov)) {
        visibleModels[id] = m;
      }
    }
    if (Object.keys(visibleModels).length > 0) {
      out.push({ ...provider, models: visibleModels });
    }
  }
  return out;
}
