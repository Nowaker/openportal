import type { PluginFs } from "./types";

const README_MAX_BYTES = 64 * 1024;
const README_CANDIDATES = [
  "README.md",
  "README.mdx",
  "README.markdown",
  "README.MD",
  "README",
  "readme.md",
];

export async function readReadme(
  fs: PluginFs,
  packageRoot: string | undefined,
): Promise<{ readme?: string; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  if (!packageRoot) return { diagnostics };

  for (const candidate of README_CANDIDATES) {
    const full = fs.resolve(packageRoot, candidate);
    let raw: string | null;
    try {
      raw = await fs.readFile(full);
    } catch (err) {
      diagnostics.push(
        `Failed to read README at ${full}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (raw === null) continue;
    const truncated =
      raw.length > README_MAX_BYTES
        ? raw.slice(0, README_MAX_BYTES) +
          "\n\n_(truncated - README exceeded 64KB cap)_"
        : raw;
    return { readme: truncated, diagnostics };
  }
  return { diagnostics };
}
