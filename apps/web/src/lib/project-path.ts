export interface BaseDirEntry {
  path: string;
  level: number;
  level1: string[];
}

export function groupSessionsByParent<T extends { id: string; parentID?: string }>(
  sessions: T[],
): Map<string, T[]> {
  const byParent = new Map<string, T[]>();
  for (const s of sessions) {
    if (!s.parentID) continue;
    const arr = byParent.get(s.parentID) || [];
    arr.push(s);
    byParent.set(s.parentID, arr);
  }
  return byParent;
}

// Given a set of ids that need an attention indicator (questions /
// permissions / errors on subagent sessions), expand it to include every
// ancestor of those ids. Used so a question landing on a subagent
// cascades the red dot all the way up to the main session that's
// rendered in the pinned-tab strip / sidebar Pinned section.
//
// The 32-depth guard caps pathological deep chains; the
// !result.has(cur) short-circuit handles cycles AND skips re-walking
// ancestors already marked from a previous seed.
export function cascadeIdsToAncestors<
  T extends { id: string; parentID?: string },
>(initialIds: Set<string>, sessions: T[]): Set<string> {
  const parentById = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentID) parentById.set(s.id, s.parentID);
  }
  const result = new Set(initialIds);
  for (const seedId of initialIds) {
    let cur = parentById.get(seedId);
    let guard = 0;
    while (cur && !result.has(cur) && guard < 32) {
      result.add(cur);
      cur = parentById.get(cur);
      guard++;
    }
  }
  return result;
}

function resolvePath(p: string): string {
  return p.replace(/\/+$/g, "");
}

export function resolveProjectPath(
  sessionDir: string,
  baseDirs: BaseDirEntry[],
): string {
  const normalised = resolvePath(sessionDir);
  for (const base of baseDirs) {
    if (normalised === base.path) return normalised;
    if (!normalised.startsWith(base.path + "/")) continue;
    const rel = normalised.slice(base.path.length + 1);
    const parts = rel.split("/").filter(Boolean);
    if (parts.length === 0) return base.path;
    const firstSegment = parts[0];
    const effectiveLevel = base.level1.includes(firstSegment) ? 1 : base.level;
    const projectParts = parts.slice(0, effectiveLevel);
    return base.path + "/" + projectParts.join("/");
  }
  return normalised;
}

export function findContainingBase(
  projectPath: string,
  baseDirs: BaseDirEntry[],
): BaseDirEntry | null {
  for (const base of baseDirs) {
    if (projectPath === base.path) return base;
    if (projectPath.startsWith(base.path + "/")) return base;
  }
  return null;
}

export interface ProjectTreeNode<TBin> {
  name: string;
  path: string;
  isProject: boolean;
  bin: TBin | null;
  children: ProjectTreeNode<TBin>[];
}

export function buildProjectTree<TBin>(
  baseDirs: BaseDirEntry[],
  bins: Map<string, TBin>,
  binActivity: (bin: TBin) => number,
  binHasIndicator?: (bin: TBin) => boolean,
): ProjectTreeNode<TBin>[] {
  const trees: ProjectTreeNode<TBin>[] = [];
  for (const base of baseDirs) {
    const root: ProjectTreeNode<TBin> = {
      name: base.path.split("/").pop() || base.path,
      path: base.path,
      isProject: false,
      bin: null,
      children: [],
    };

    for (const [path, bin] of bins) {
      const rel =
        path === base.path
          ? []
          : path.startsWith(base.path + "/")
            ? path.slice(base.path.length + 1).split("/").filter(Boolean)
            : null;
      if (rel === null) continue;
      if (rel.length === 0) {
        root.isProject = true;
        root.bin = bin;
        continue;
      }
      let cursor = root;
      for (let i = 0; i < rel.length; i++) {
        const seg = rel[i];
        const isLeaf = i === rel.length - 1;
        const childPath = cursor.path + "/" + seg;
        let child = cursor.children.find((c) => c.path === childPath);
        if (!child) {
          child = {
            name: seg,
            path: childPath,
            isProject: false,
            bin: null,
            children: [],
          };
          cursor.children.push(child);
        }
        if (isLeaf) {
          child.isProject = true;
          child.bin = bin;
        }
        cursor = child;
      }
    }

    sortTreeRecursive(root, binActivity, binHasIndicator);
    trees.push(root);
  }
  return trees;
}

interface NodeRank {
  activity: number;
  hasIndicator: boolean;
}

// Sort priority at every level: nodes whose subtree contains ANY indicator
// (busy/retry/question/error/draft/new-content) come first; ties broken by
// most-recent activity. Indicator-free nodes follow, also by activity desc.
// Old behaviour preserved when binHasIndicator is omitted: pure activity sort
// with empty-categories alphabetically last.
function sortTreeRecursive<TBin>(
  node: ProjectTreeNode<TBin>,
  binActivity: (bin: TBin) => number,
  binHasIndicator: ((bin: TBin) => boolean) | undefined,
): NodeRank {
  if (node.children.length === 0) {
    const activity = node.bin ? binActivity(node.bin) : 0;
    const hasIndicator =
      binHasIndicator && node.bin ? binHasIndicator(node.bin) : false;
    return { activity, hasIndicator };
  }
  const ranks = node.children.map((c) => ({
    child: c,
    rank: sortTreeRecursive(c, binActivity, binHasIndicator),
  }));
  ranks.sort((a, b) => {
    if (binHasIndicator) {
      if (a.rank.hasIndicator !== b.rank.hasIndicator) {
        return a.rank.hasIndicator ? -1 : 1;
      }
      return b.rank.activity - a.rank.activity;
    }
    const aLeaf = a.child.children.length === 0;
    const bLeaf = b.child.children.length === 0;
    if (aLeaf && bLeaf) return b.rank.activity - a.rank.activity;
    if (!aLeaf && !bLeaf) {
      const aHas = a.rank.activity > 0;
      const bHas = b.rank.activity > 0;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a.child.name.localeCompare(b.child.name);
    }
    return aLeaf ? -1 : 1;
  });
  node.children = ranks.map((r) => r.child);
  const ownActivity = node.bin ? binActivity(node.bin) : 0;
  const ownIndicator =
    binHasIndicator && node.bin ? binHasIndicator(node.bin) : false;
  return {
    activity: Math.max(ownActivity, ...ranks.map((r) => r.rank.activity)),
    hasIndicator:
      ownIndicator || ranks.some((r) => r.rank.hasIndicator),
  };
}
