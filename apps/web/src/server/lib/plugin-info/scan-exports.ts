import type { PluginFs } from "./types";

export interface ExportScan {
  id?: string;
  pluginKind: "server" | "tui" | "theme-only" | "unknown";
  exportedFunctions: string[];
  diagnostics: string[];
}

const ID_RE = /export\s+const\s+id\s*=\s*['"`]([^'"`]+)['"`]/;
const DEFAULT_OBJECT_ID_RE = /\bid\s*:\s*['"`]([^'"`]+)['"`]/;
const NAMED_FUNCTION_RE = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
const NAMED_CONST_FN_RE =
  /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g;

const SERVER_HOOK_RE = /\bserver\s*\(/;
const TUI_HOOK_RE = /\btui\s*\(/;
const PLUGIN_TYPE_RE =
  /(?::\s*Plugin\b|@opencode-ai\/plugin['"]|<\s*Plugin\s*>)/;
const TUI_PLUGIN_TYPE_RE =
  /(?::\s*TuiPlugin\b|@opencode-ai\/plugin\/tui['"]|<\s*TuiPlugin\s*>)/;

// $NAME / $$$ etc. show up in code-search example strings embedded inside
// bundled dists (e.g. ast-grep meta-variables). They aren't real exports;
// drop them so the modal isn't full of noise.
function isMetaVariableName(name: string): boolean {
  return name.startsWith("$");
}

export async function scanExports(
  fs: PluginFs,
  entryPoint: string | undefined,
  isThemeOnly: boolean,
): Promise<ExportScan> {
  const result: ExportScan = {
    pluginKind: isThemeOnly ? "theme-only" : "unknown",
    exportedFunctions: [],
    diagnostics: [],
  };
  if (!entryPoint) {
    if (!isThemeOnly) {
      result.diagnostics.push(
        "No entry point resolved; cannot scan for exports.",
      );
    }
    return result;
  }

  let source: string | null;
  try {
    source = await fs.readFile(entryPoint);
  } catch (err) {
    result.diagnostics.push(
      `Failed to read entry point ${entryPoint}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }
  if (!source) {
    result.diagnostics.push(`Entry point not readable: ${entryPoint}`);
    return result;
  }

  const idMatch = source.match(ID_RE);
  if (idMatch) {
    result.id = idMatch[1];
  } else {
    // `export default { id: "...", server() {...} }` is the canonical opencode
    // plugin shape. The `id` key sits anywhere inside that object literal so
    // we scan the whole file for the first `id: "..."` after `export default`.
    const defaultIdx = source.indexOf("export default");
    if (defaultIdx !== -1) {
      const tail = source.slice(defaultIdx);
      const m = tail.match(DEFAULT_OBJECT_ID_RE);
      if (m) result.id = m[1];
    }
  }

  const fnNames = new Set<string>();
  for (const m of source.matchAll(NAMED_FUNCTION_RE)) {
    if (!isMetaVariableName(m[1])) fnNames.add(m[1]);
  }
  for (const m of source.matchAll(NAMED_CONST_FN_RE)) {
    if (!isMetaVariableName(m[1])) fnNames.add(m[1]);
  }
  result.exportedFunctions = Array.from(fnNames).sort();

  // Plugin kind detection, in priority order: explicit theme-only beats
  // detected server/tui hooks (a theme-only package shouldn't be misclassified
  // because the bundler emitted helper code that looks like server()).
  // The Plugin / TuiPlugin type annotations from `@opencode-ai/plugin` are
  // the canonical signal for opencode plugins; the older `server(`/`tui(`
  // hook regex catches the legacy nested-object plugin shape that some
  // plugins still use.
  if (isThemeOnly) {
    result.pluginKind = "theme-only";
  } else if (TUI_PLUGIN_TYPE_RE.test(source) || TUI_HOOK_RE.test(source)) {
    result.pluginKind = "tui";
  } else if (PLUGIN_TYPE_RE.test(source) || SERVER_HOOK_RE.test(source)) {
    result.pluginKind = "server";
  }
  return result;
}
