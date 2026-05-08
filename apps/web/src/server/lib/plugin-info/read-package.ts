import type { PluginFs } from "./types";

export interface PackageJsonInfo {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  repositoryUrl?: string;
  homepage?: string;
  hasMain: boolean;
  hasOcThemes: boolean;
  diagnostics: string[];
}

interface RawPackageJson {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  author?: unknown;
  license?: unknown;
  repository?: unknown;
  homepage?: unknown;
  main?: unknown;
  module?: unknown;
  exports?: unknown;
  "oc-themes"?: unknown;
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickAuthor(value: unknown): string | undefined {
  if (typeof value === "string") return pickString(value);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const name = pickString(obj.name);
    const email = pickString(obj.email);
    if (name && email) return `${name} <${email}>`;
    return name ?? email;
  }
  return undefined;
}

function pickLicense(value: unknown): string | undefined {
  if (typeof value === "string") return pickString(value);
  if (value && typeof value === "object") {
    return pickString((value as Record<string, unknown>).type);
  }
  return undefined;
}

function pickRepositoryUrl(value: unknown): string | undefined {
  if (typeof value === "string") return normalizeRepoUrl(value);
  if (value && typeof value === "object") {
    const url = (value as Record<string, unknown>).url;
    if (typeof url === "string") return normalizeRepoUrl(url);
  }
  return undefined;
}

function normalizeRepoUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Strip the legacy `git+` prefix and trailing `.git` so the URL is
  // browser-clickable. Leave SSH-style URLs as-is (we'd need a real parser
  // to convert `git@github.com:foo/bar.git` to https; not worth it here).
  return trimmed.replace(/^git\+/, "").replace(/\.git$/, "");
}

export async function readPackageInfo(
  fs: PluginFs,
  packageRoot: string | undefined,
): Promise<PackageJsonInfo> {
  const result: PackageJsonInfo = {
    hasMain: false,
    hasOcThemes: false,
    diagnostics: [],
  };
  if (!packageRoot) return result;

  const pkgPath = fs.resolve(packageRoot, "package.json");
  let raw: string | null;
  try {
    raw = await fs.readFile(pkgPath);
  } catch (err) {
    result.diagnostics.push(
      `Could not read ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }
  if (!raw) return result;

  let parsed: RawPackageJson;
  try {
    parsed = JSON.parse(raw) as RawPackageJson;
  } catch (err) {
    result.diagnostics.push(
      `Invalid JSON in ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }

  result.name = pickString(parsed.name);
  result.version = pickString(parsed.version);
  result.description = pickString(parsed.description);
  result.author = pickAuthor(parsed.author);
  result.license = pickLicense(parsed.license);
  result.repositoryUrl = pickRepositoryUrl(parsed.repository);
  result.homepage = pickString(parsed.homepage);
  result.hasMain =
    typeof parsed.main === "string" ||
    typeof parsed.module === "string" ||
    (parsed.exports !== undefined && parsed.exports !== null);
  result.hasOcThemes =
    parsed["oc-themes"] !== undefined && parsed["oc-themes"] !== null;
  return result;
}
