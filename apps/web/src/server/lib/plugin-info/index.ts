import { parsePluginSpec } from "./parse-spec";
import { resolveTarget } from "./resolve-target";
import { readPackageInfo } from "./read-package";
import { scanExports } from "./scan-exports";
import { readReadme } from "./readme";
import type { GetPluginInfoOptions, PluginFs, PluginInfo } from "./types";

export type {
  GetPluginInfoOptions,
  PluginFs,
  PluginInfo,
  PluginSource,
} from "./types";

function deriveDisplayName(parsed: ReturnType<typeof parsePluginSpec>, spec: string, pkgName?: string): string {
  if (pkgName) return pkgName;
  if (parsed.source === "local" && parsed.filePath) {
    return parsed.filePath.split("/").filter(Boolean).pop() ?? parsed.filePath;
  }
  if (parsed.source === "npm" && parsed.packageName) return parsed.packageName;
  return spec;
}

export async function getPluginInfo(
  spec: string,
  fs: PluginFs,
  opts: GetPluginInfoOptions = {},
): Promise<PluginInfo> {
  const parsed = parsePluginSpec(spec);
  const resolved = await resolveTarget(parsed, spec, fs, opts);
  const pkgInfo = await readPackageInfo(fs, resolved.packageRoot);

  const isThemeOnly = pkgInfo.hasOcThemes && !pkgInfo.hasMain;
  const exportInfo = await scanExports(fs, resolved.entryPoint, isThemeOnly);
  const readmeInfo = await readReadme(fs, resolved.packageRoot);

  const diagnostics = [
    ...resolved.diagnostics,
    ...pkgInfo.diagnostics,
    ...exportInfo.diagnostics,
    ...readmeInfo.diagnostics,
  ];

  return {
    spec,
    source: parsed.source,
    resolvedTarget: resolved.resolvedTarget,
    packageRoot: resolved.packageRoot,
    id: exportInfo.id,
    name: deriveDisplayName(parsed, spec, pkgInfo.name),
    requestedVersion: parsed.requestedVersion,
    version: pkgInfo.version,
    description: pkgInfo.description,
    author: pkgInfo.author,
    license: pkgInfo.license,
    repositoryUrl: pkgInfo.repositoryUrl,
    homepage: pkgInfo.homepage,
    entryPoint: resolved.entryPoint,
    pluginKind: exportInfo.pluginKind,
    exportedFunctions: exportInfo.exportedFunctions,
    readme: readmeInfo.readme,
    diagnostics,
  };
}
