import type { GetPluginInfoOptions, PluginFs } from "./types";
import type { ParsedSpec } from "./parse-spec";

export interface ResolvedTarget {
  resolvedTarget: string;
  packageRoot?: string;
  entryPoint?: string;
  diagnostics: string[];
}

interface PackageJsonShape {
  main?: unknown;
  module?: unknown;
  exports?: unknown;
  type?: unknown;
}

const ENTRY_CANDIDATES = [
  "index.ts",
  "index.tsx",
  "index.mjs",
  "index.js",
  "index.cjs",
  "src/index.ts",
  "src/index.tsx",
  "src/index.js",
  "dist/index.mjs",
  "dist/index.js",
  "dist/index.cjs",
];

async function resolveEntryFromPackageJson(
  fs: PluginFs,
  packageRoot: string,
  pkg: PackageJsonShape,
): Promise<string | undefined> {
  // exports[".".import] or exports[".".default] take priority over main when
  // both are present, matching how modern bundlers/Node resolve entries.
  const exportsField = pkg.exports;
  if (exportsField && typeof exportsField === "object") {
    const dot = (exportsField as Record<string, unknown>)["."];
    if (typeof dot === "string") {
      return fs.resolve(packageRoot, dot);
    }
    if (dot && typeof dot === "object") {
      const dotObj = dot as Record<string, unknown>;
      const pick =
        (typeof dotObj.import === "string" && dotObj.import) ||
        (typeof dotObj.default === "string" && dotObj.default) ||
        (typeof dotObj.require === "string" && dotObj.require);
      if (pick) return fs.resolve(packageRoot, pick);
    }
  }

  if (typeof pkg.main === "string") {
    return fs.resolve(packageRoot, pkg.main);
  }
  if (typeof pkg.module === "string") {
    return fs.resolve(packageRoot, pkg.module);
  }

  for (const candidate of ENTRY_CANDIDATES) {
    const full = fs.resolve(packageRoot, candidate);
    if (await fs.exists(full)) return full;
  }
  return undefined;
}

async function resolveLocal(
  fs: PluginFs,
  filePath: string,
): Promise<ResolvedTarget> {
  const diagnostics: string[] = [];
  const stat = await fs.stat(filePath);
  if (!stat) {
    diagnostics.push(`Local path does not exist: ${filePath}`);
    return { resolvedTarget: filePath, diagnostics };
  }

  if (!stat.isDirectory) {
    return { resolvedTarget: filePath, entryPoint: filePath, diagnostics };
  }

  const pkgPath = fs.resolve(filePath, "package.json");
  const pkg = await fs.readJson<PackageJsonShape>(pkgPath);
  if (!pkg) {
    // Directory without package.json: try the standard entry candidates
    // directly so plain .ts plugin folders still resolve.
    for (const candidate of ENTRY_CANDIDATES) {
      const full = fs.resolve(filePath, candidate);
      if (await fs.exists(full)) {
        return {
          resolvedTarget: filePath,
          packageRoot: filePath,
          entryPoint: full,
          diagnostics,
        };
      }
    }
    diagnostics.push(
      `No package.json and no index.{ts,js,mjs,cjs} found in ${filePath}`,
    );
    return { resolvedTarget: filePath, packageRoot: filePath, diagnostics };
  }

  const entry = await resolveEntryFromPackageJson(fs, filePath, pkg);
  if (!entry) {
    diagnostics.push(
      `package.json present but no main/exports/index.{ts,js,mjs} resolves to a real file in ${filePath}`,
    );
  }
  return {
    resolvedTarget: filePath,
    packageRoot: filePath,
    entryPoint: entry,
    diagnostics,
  };
}

async function resolveNpm(
  fs: PluginFs,
  packageName: string,
  spec: string,
  opts: GetPluginInfoOptions,
): Promise<ResolvedTarget> {
  const diagnostics: string[] = [];
  const triedPaths: string[] = [];

  const candidateDirs: string[] = [];
  for (const root of opts.nodeModulesRoots ?? []) {
    candidateDirs.push(fs.resolve(root, packageName));
  }
  // opencode caches each plugin spec under its own directory name (e.g.
  // `oh-my-openagent@latest`). The verbatim spec is the directory name.
  for (const cacheRoot of opts.packageCacheRoots ?? []) {
    candidateDirs.push(
      fs.resolve(cacheRoot, spec, "node_modules", packageName),
    );
  }

  for (const dir of candidateDirs) {
    triedPaths.push(dir);
    const stat = await fs.stat(dir);
    if (!stat || !stat.isDirectory) continue;
    const pkgPath = fs.resolve(dir, "package.json");
    const pkg = await fs.readJson<PackageJsonShape>(pkgPath);
    if (!pkg) continue;
    const entry = await resolveEntryFromPackageJson(fs, dir, pkg);
    if (!entry) {
      diagnostics.push(
        `Found package at ${dir} but could not determine an entry point.`,
      );
    }
    return {
      resolvedTarget: dir,
      packageRoot: dir,
      entryPoint: entry,
      diagnostics,
    };
  }

  diagnostics.push(
    `npm package "${packageName}" not found. Tried: ${triedPaths.join(", ") || "(no roots configured)"}`,
  );
  return { resolvedTarget: packageName, diagnostics };
}

export async function resolveTarget(
  parsed: ParsedSpec,
  spec: string,
  fs: PluginFs,
  opts: GetPluginInfoOptions,
): Promise<ResolvedTarget> {
  if (parsed.source === "local") {
    if (!parsed.filePath) {
      return {
        resolvedTarget: spec,
        diagnostics: [`Local spec has no file path: ${spec}`],
      };
    }
    return resolveLocal(fs, parsed.filePath);
  }
  if (!parsed.packageName) {
    return {
      resolvedTarget: spec,
      diagnostics: [`Could not extract package name from npm spec: ${spec}`],
    };
  }
  return resolveNpm(fs, parsed.packageName, spec, opts);
}
