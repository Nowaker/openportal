export interface BaseDirEntry {
  path: string;
  level: number;
  level1: string[];
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

    sortTreeRecursive(root, binActivity);
    trees.push(root);
  }
  return trees;
}

function sortTreeRecursive<TBin>(
  node: ProjectTreeNode<TBin>,
  binActivity: (bin: TBin) => number,
): number {
  if (node.children.length === 0) {
    return node.bin ? binActivity(node.bin) : 0;
  }
  const childActivities = node.children.map((c) => ({
    child: c,
    activity: sortTreeRecursive(c, binActivity),
  }));
  childActivities.sort((a, b) => {
    const aLeaf = a.child.children.length === 0;
    const bLeaf = b.child.children.length === 0;
    if (aLeaf && bLeaf) {
      return b.activity - a.activity;
    }
    if (!aLeaf && !bLeaf) {
      return a.child.name.localeCompare(b.child.name);
    }
    return aLeaf ? -1 : 1;
  });
  node.children = childActivities.map((c) => c.child);
  return Math.max(
    node.bin ? binActivity(node.bin) : 0,
    ...childActivities.map((c) => c.activity),
  );
}
