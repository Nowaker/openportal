import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { dirname, join, relative, resolve, sep } from "path";

// Filesystem-backed prompt templates that live next to project code at
// `<workspace>/<…subpath…>/.vibekick/templates/<slug>.md`. Each file
// carries a YAML frontmatter header (name, description, enabled, init,
// slash, order) plus the prompt body. The filesystem is the source of
// truth - reading + writing round-trips through this module.
//
// .vibekick/ is the canonical directory because OpenPortal is being
// renamed to vibekick; adopting the name now means there's no
// filesystem migration when the rest of the rebrand lands.

export interface FsTemplate {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  init: boolean;
  slash: boolean;
  order: number;
  prompt: string;
  location: string;
  workspaceRoot: string;
  scope: string;
}

export interface FsTemplateInput {
  name: string;
  description?: string;
  enabled: boolean;
  init: boolean;
  slash: boolean;
  order: number;
  prompt: string;
}

const TEMPLATE_DIR_NAME = ".vibekick";
const TEMPLATE_SUBDIR = "templates";
// Directories we never descend into when scanning recursively. Keeping
// scanWorkspaceTemplates fast even when the workspace contains huge
// node_modules / .git / build-output trees.
const SCAN_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".turbo",
  ".next",
  ".nuxt",
  ".cache",
  ".output",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode",
]);

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return trimmed;
}

// Minimal YAML key:value parser for our fixed schema. Only handles
// scalar lines (no nested maps, no lists, no block scalars). Lines
// outside this shape are ignored - the body of the markdown is the
// prompt and lives outside the frontmatter block.
function parseFrontmatter(yaml: string): Record<string, string | boolean | number> {
  const out: Record<string, string | boolean | number> = {};
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const rawValue = m[2].trim();
    if (rawValue === "") {
      out[key] = "";
      continue;
    }
    if (rawValue === "true" || rawValue === "false") {
      out[key] = rawValue === "true";
      continue;
    }
    if (/^-?\d+$/.test(rawValue)) {
      const n = Number(rawValue);
      if (Number.isFinite(n)) {
        out[key] = n;
        continue;
      }
    }
    out[key] = unquote(rawValue);
  }
  return out;
}

function escapeYamlString(value: string): string {
  // Quote always when the string contains a yaml-sensitive char or
  // could be parsed as another type. Keeps round-trip stable.
  if (
    value === "" ||
    /^(true|false|null|yes|no|on|off)$/i.test(value) ||
    /^-?\d/.test(value) ||
    /[:#"'\\\n\r\t]/.test(value) ||
    value.startsWith(" ") ||
    value.endsWith(" ")
  ) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function serializeFrontmatter(t: FsTemplateInput): string {
  const lines = [`name: ${escapeYamlString(t.name)}`];
  if (t.description && t.description.trim() !== "") {
    lines.push(`description: ${escapeYamlString(t.description)}`);
  }
  lines.push(`enabled: ${t.enabled ? "true" : "false"}`);
  lines.push(`init: ${t.init ? "true" : "false"}`);
  lines.push(`slash: ${t.slash ? "true" : "false"}`);
  lines.push(`order: ${Math.trunc(t.order)}`);
  return `---\n${lines.join("\n")}\n---\n${t.prompt.replace(/^\n+/, "")}\n`;
}

// The id is the absolute path of the source file. Using a stable id
// instead of the slug means two `foo.md` templates under different
// `.vibekick/templates/` parents do not collide.
function idForLocation(location: string): string {
  return `fs:${location}`;
}

function readTemplateFile(
  location: string,
  workspaceRoot: string,
): FsTemplate | null {
  let raw: string;
  try {
    raw = readFileSync(location, "utf8");
  } catch {
    return null;
  }
  const match = raw.match(FRONTMATTER_RE);
  let meta: Record<string, string | boolean | number> = {};
  let body = raw;
  if (match) {
    meta = parseFrontmatter(match[1]);
    body = match[2];
  }
  const slug = location
    .split(sep)
    .pop()!
    .replace(/\.md$/i, "");
  const name = typeof meta.name === "string" && meta.name ? meta.name : slug;
  const description =
    typeof meta.description === "string" && meta.description
      ? meta.description
      : undefined;
  const enabled = meta.enabled === undefined ? true : meta.enabled === true;
  const init = meta.init === true;
  const slash = meta.slash === true;
  const order =
    typeof meta.order === "number" && Number.isFinite(meta.order)
      ? Math.trunc(meta.order)
      : 0;
  const scope = relative(workspaceRoot, location);
  return {
    id: idForLocation(location),
    name,
    description,
    enabled,
    init,
    slash,
    order,
    prompt: body.replace(/^\n+/, "").replace(/\n+$/, ""),
    location,
    workspaceRoot,
    scope: scope.startsWith("..") ? location : scope,
  };
}

// Walk the directory tree rooted at `root`, yielding every
// `<…>/.vibekick/templates/*.md` file. Skips heavy directories so we
// don't traverse node_modules on a JS project.
function* walkTemplates(root: string): Generator<string> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: import("fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SCAN_SKIP_DIRS.has(entry.name)) continue;
        if (entry.name === TEMPLATE_DIR_NAME) {
          // Look one level down for templates/*.md
          const templatesDir = join(dir, entry.name, TEMPLATE_SUBDIR);
          let tpls: import("fs").Dirent[];
          try {
            tpls = readdirSync(templatesDir, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const tpl of tpls) {
            if (tpl.isFile() && /\.md$/i.test(tpl.name)) {
              yield join(templatesDir, tpl.name);
            }
          }
          continue;
        }
        stack.push(join(dir, entry.name));
      }
    }
  }
}

// Scan an entire workspace tree for templates. Used by the Settings UI
// which shows EVERY template anywhere under the workspace.
export function scanWorkspaceTemplates(workspaceRoot: string): FsTemplate[] {
  const expanded = expandTilde(workspaceRoot);
  if (!existsSync(expanded)) return [];
  let st: import("fs").Stats;
  try {
    st = statSync(expanded);
  } catch {
    return [];
  }
  if (!st.isDirectory()) return [];
  const found: FsTemplate[] = [];
  for (const location of walkTemplates(expanded)) {
    const t = readTemplateFile(location, expanded);
    if (t) found.push(t);
  }
  return found.sort(
    (a, b) => a.order - b.order || a.scope.localeCompare(b.scope),
  );
}

// Resolve the workspace root for a given directory by walking up until
// we hit one of the configured workspace roots from openportal.json.
// Falls back to the directory itself if nothing matches (defensive: a
// caller passing a stray path still gets a usable answer).
export function resolveWorkspaceRoot(
  directory: string,
  workspaceRoots: string[],
): string {
  const dir = resolve(expandTilde(directory));
  const expandedRoots = workspaceRoots.map((r) => resolve(expandTilde(r)));
  let best: string | null = null;
  for (const root of expandedRoots) {
    if (dir === root || dir.startsWith(root + sep)) {
      if (!best || root.length > best.length) best = root;
    }
  }
  return best ?? dir;
}

// For the new-session picker. Walks UPWARD from `directory` to
// `workspaceRoot`, collecting every `<each>/.vibekick/templates/*.md`
// along the way. Closest-to-leaf appears first; ordering inside one
// directory level uses the YAML `order` field.
export function templatesForDirectory(
  directory: string,
  workspaceRoot: string,
): FsTemplate[] {
  const dir = resolve(expandTilde(directory));
  const root = resolve(expandTilde(workspaceRoot));
  if (!existsSync(dir)) return [];
  if (!dir.startsWith(root) && dir !== root) return [];
  const found: FsTemplate[] = [];
  let cursor = dir;
  while (true) {
    const templatesDir = join(cursor, TEMPLATE_DIR_NAME, TEMPLATE_SUBDIR);
    if (existsSync(templatesDir)) {
      let entries: import("fs").Dirent[];
      try {
        entries = readdirSync(templatesDir, { withFileTypes: true });
      } catch {
        entries = [];
      }
      const here: FsTemplate[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
        const t = readTemplateFile(join(templatesDir, entry.name), root);
        if (t) here.push(t);
      }
      here.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      found.push(...here);
    }
    if (cursor === root) break;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return found;
}

// Write (create or overwrite) a template file. Caller is responsible
// for validating that `location` lives under a configured workspace
// root - the API layer does that check before calling here. mkdir -p
// creates the `.vibekick/templates/` parent if missing.
export function writeTemplate(
  location: string,
  input: FsTemplateInput,
): FsTemplate {
  const expanded = resolve(expandTilde(location));
  mkdirSync(dirname(expanded), { recursive: true });
  writeFileSync(expanded, serializeFrontmatter(input), "utf8");
  // Re-read so the returned record reflects what we just persisted (catches
  // any trailing-newline / order-normalization mismatches up front).
  const parent = dirname(dirname(dirname(expanded)));
  const reread = readTemplateFile(expanded, parent);
  if (!reread) {
    throw new Error(`writeTemplate: re-read failed for ${expanded}`);
  }
  return reread;
}

export function deleteTemplate(location: string): void {
  const expanded = resolve(expandTilde(location));
  try {
    unlinkSync(expanded);
  } catch {
    // already gone - idempotent
  }
}

// Path validation: a template location must be of the form
// `<workspaceRoot>/<…>/.vibekick/templates/<filename>.md` where
// `<workspaceRoot>` matches one of the configured workspace roots.
// Prevents arbitrary file writes via the API layer.
export function validateTemplateLocation(
  location: string,
  workspaceRoots: string[],
): { ok: true; workspaceRoot: string } | { ok: false; reason: string } {
  const expanded = resolve(expandTilde(location));
  if (!/\.md$/i.test(expanded)) {
    return { ok: false, reason: "Template path must end in .md" };
  }
  const parent = dirname(expanded);
  if (!parent.endsWith(sep + TEMPLATE_DIR_NAME + sep + TEMPLATE_SUBDIR)) {
    return {
      ok: false,
      reason: `Template path must live under ${TEMPLATE_DIR_NAME}/${TEMPLATE_SUBDIR}/`,
    };
  }
  const expandedRoots = workspaceRoots.map((r) => resolve(expandTilde(r)));
  for (const root of expandedRoots) {
    if (expanded === root || expanded.startsWith(root + sep)) {
      return { ok: true, workspaceRoot: root };
    }
  }
  return {
    ok: false,
    reason: "Template path is not inside any configured workspace root",
  };
}


interface CachedSnapshot {
  workspaces: string[];
  templatesByLocation: Map<string, FsTemplate>;
  builtAt: number;
}

let cache: CachedSnapshot | null = null;
let rebuilding: Promise<CachedSnapshot> | null = null;

const PERIODIC_REFRESH_MS = 5 * 60 * 1000;

function buildSnapshot(workspaces: string[]): CachedSnapshot {
  const map = new Map<string, FsTemplate>();
  for (const root of workspaces) {
    for (const t of scanWorkspaceTemplates(root)) {
      map.set(t.location, t);
    }
  }
  return { workspaces, templatesByLocation: map, builtAt: Date.now() };
}

function workspacesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function getCachedSnapshot(
  workspaces: string[],
): Promise<CachedSnapshot> {
  if (cache && workspacesEqual(cache.workspaces, workspaces)) return cache;
  if (!rebuilding) {
    rebuilding = Promise.resolve().then(() => buildSnapshot(workspaces));
    rebuilding.finally(() => {
      rebuilding = null;
    });
  }
  cache = await rebuilding;
  return cache;
}

export async function forceRebuildSnapshot(
  workspaces: string[],
): Promise<CachedSnapshot> {
  cache = buildSnapshot(workspaces);
  return cache;
}

export function applyTemplateUpdate(template: FsTemplate): void {
  if (!cache) return;
  cache.templatesByLocation.set(template.location, template);
}

export function applyTemplateDelete(location: string): void {
  if (!cache) return;
  cache.templatesByLocation.delete(location);
}

if (typeof setInterval === "function") {
  setInterval(() => {
    if (!cache) return;
    try {
      cache = buildSnapshot(cache.workspaces);
    } catch {
      /* swallow - next read rebuilds */
    }
  }, PERIODIC_REFRESH_MS);
}
