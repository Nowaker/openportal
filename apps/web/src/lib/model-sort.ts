const VERSION_RE = /\b\d+(?:\.\d+)*\b/g;

const TIER_TOKENS = new Set([
  "fast",
  "thinking",
  "reasoning",
  "instant",
  "turbo",
  "lite",
  "mini",
]);

/**
 * Sort comparator for model display names (e.g. "Claude Opus 4.7", "Claude
 * Opus 4 fast", "Claude Opus 3"). The version-number part of the name is
 * the primary intra-family key.
 *
 * Order:
 *   1. Alphabetical (case-insensitive) on the family name. Family is the
 *      name with version tokens AND tier tokens (fast/thinking/mini/...)
 *      removed. So "Claude Opus 4.7" and "Claude Opus 4 fast" share a
 *      family ("claude opus") and rank as siblings; "Claude Haiku 4.5"
 *      ranks earlier alphabetically.
 *   2. Within a family, version DESC. "4.7" > "4.6" > "4.1" > "4" > "3".
 *      Single-integer versions (no dot) ARE matched, so "Opus 3" / "Opus 4"
 *      participate in the version comparison. Each version segment compared
 *      part-by-part; a missing part counts as zero.
 *   3. Same-version tiebreaker: shorter name wins, so "Opus 4" sorts before
 *      "Opus 4 fast" - the bare tier-less form is the canonical 'default'.
 *   4. Final tiebreaker: localeCompare on the full name for stability.
 */
export function compareModels<T extends { name: string }>(
  a: T,
  b: T,
): number {
  const aBase = stripVersionAndTier(a.name);
  const bBase = stripVersionAndTier(b.name);
  if (aBase !== bBase) return aBase.localeCompare(bBase);

  const aVersions = extractVersions(a.name);
  const bVersions = extractVersions(b.name);
  const len = Math.max(aVersions.length, bVersions.length);
  for (let i = 0; i < len; i++) {
    const av = aVersions[i] ?? [];
    const bv = bVersions[i] ?? [];
    const partLen = Math.max(av.length, bv.length);
    for (let j = 0; j < partLen; j++) {
      const cmp = (bv[j] ?? 0) - (av[j] ?? 0);
      if (cmp !== 0) return cmp;
    }
  }

  if (a.name.length !== b.name.length) {
    return a.name.length - b.name.length;
  }
  return a.name.localeCompare(b.name);
}

function stripVersionAndTier(name: string): string {
  return name
    .replace(VERSION_RE, "")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !TIER_TOKENS.has(t.toLowerCase()))
    .join(" ")
    .toLowerCase();
}

function extractVersions(name: string): number[][] {
  return (name.match(VERSION_RE) ?? []).map((v) => v.split(".").map(Number));
}
