const VERSION_RE = /\d+(?:\.\d+)+/g;

/**
 * Sort comparator for items with a display `name` containing a version (e.g.
 * "Claude Opus 4.7"). Sort order:
 *
 * 1. Case-insensitive alphabetical on the base name (numeric tokens stripped),
 *    so "Claude Haiku 4.5" sorts before "Claude Opus 4.5".
 * 2. Within the same base name, descending version, so "Claude Opus 4.7" sorts
 *    before "Claude Opus 4.5". A multi-segment version is compared part by
 *    part, and a missing part counts as zero (so "Opus 4" sorts after
 *    "Opus 4.1" because the missing minor is treated as 0).
 * 3. Final fallback: case-sensitive `localeCompare` on the original name, so
 *    items differing only by case get a stable order.
 */
export function compareModels<T extends { name: string }>(
  a: T,
  b: T,
): number {
  const aBase = stripVersion(a.name);
  const bBase = stripVersion(b.name);
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
  return a.name.localeCompare(b.name);
}

function stripVersion(name: string): string {
  return name
    .replace(VERSION_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractVersions(name: string): number[][] {
  return (name.match(VERSION_RE) ?? []).map((v) => v.split(".").map(Number));
}
