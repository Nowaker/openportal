// Plugin info types.
//
// Designed so the same pipeline can run server-side (against the real
// filesystem via fs-node.ts) and theoretically inside an opencode plugin
// (against a hypothetical PluginInput.fs). Phase 3 (plugin wrapper) is
// blocked by the absence of a public fs API on PluginInput; the abstraction
// remains so when/if that lands the swap is one adapter file.

export type PluginSource = "local" | "npm";

export interface PluginFs {
  // Returns null if the path does not exist; never throws for a missing
  // path. Throws only on permission / IO errors.
  stat(path: string): Promise<{ isDirectory: boolean } | null>;
  exists(path: string): Promise<boolean>;
  // Returns null if the file does not exist. Errors propagate.
  readFile(path: string): Promise<string | null>;
  // Returns null if the file does not exist OR if JSON parsing fails. The
  // caller can then add a diagnostic; we never throw on bad JSON because a
  // malformed package.json shouldn't crash the modal.
  readJson<T>(path: string): Promise<T | null>;
  // Returns [] if the directory does not exist. Names only, no full paths.
  readdir(path: string): Promise<string[]>;
  // Path joiner. Implementations should normalize separators.
  resolve(...parts: string[]): string;
}

export interface PluginInfo {
  spec: string;
  source: PluginSource;
  // The local filesystem path we resolved the spec to. For local specs that's
  // the file or directory the user pointed at; for npm it's the package
  // directory inside whichever node_modules root won the lookup.
  resolvedTarget: string;
  // For npm: the directory that holds package.json. For local file specs
  // that point at a single .ts/.js, undefined (no package metadata).
  packageRoot?: string;
  // The plugin's own `id` constant exported from the entry file (if found).
  // NOT the npm package name.
  id?: string;
  // Display name. Falls back to the npm package name or the local file's
  // basename. Always defined.
  name: string;
  // The version string requested in the spec (after `@` for npm). For local
  // specs, undefined.
  requestedVersion?: string;
  // The version from package.json. For local single-file specs, undefined.
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  // Always a string URL when present (we normalize from the various shapes
  // package.json supports for the `repository` field).
  repositoryUrl?: string;
  homepage?: string;
  // Absolute path to the entry .ts/.js/.mjs file that opencode would load.
  entryPoint?: string;
  pluginKind: "server" | "tui" | "theme-only" | "unknown";
  // Names of `export function`/`export const` exports detected in the entry
  // file. Best-effort regex scan; not authoritative.
  exportedFunctions: string[];
  // Capped at READ_README_MAX_BYTES (64KB). Empty/missing README -> undefined.
  readme?: string;
  // Human-readable warnings/errors about anything we couldn't read or parse.
  // The modal renders these in red so users see WHY data is missing instead
  // of just seeing empty fields.
  diagnostics: string[];
}

export interface GetPluginInfoOptions {
  // Roots to consult, in priority order, for npm-style specs. First match
  // wins. The caller (server endpoint) builds this list from the running
  // opencode's project directory + opencode's own plugin cache + portal's
  // own node_modules.
  nodeModulesRoots?: string[];
  // For npm specs that opencode caches per-spec under
  // `~/.cache/opencode/packages/<spec>/node_modules/<packageName>`. This
  // tells the resolver about that layout: each entry is the absolute path
  // to a `~/.cache/opencode/packages/<spec>` directory; the resolver will
  // append `/node_modules/<packageName>` itself.
  packageCacheRoots?: string[];
}
