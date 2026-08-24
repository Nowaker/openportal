import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import {
  sortFsTemplates,
  type FsTemplate,
} from "../../lib/vibekick-template-contract";
import { expandTemplatePath, templateScope } from "./vibekick-template-paths";

export type FsTemplateInput = {
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly init: boolean;
  readonly defaultOn: boolean;
  readonly slash: boolean;
  readonly order: number;
  readonly prompt: string;
};

export class TemplateFileAccessError extends Error {
  override readonly name = "TemplateFileAccessError";

  constructor(
    readonly location: string,
    cause: unknown,
  ) {
    super(`Unable to read filesystem template path: ${location}`, { cause });
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
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

function parseFrontmatter(
  yaml: string,
): Record<string, string | boolean | number> {
  const parsed: Record<string, string | boolean | number> = {};
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    const key = match?.[1];
    const valueText = match?.[2];
    if (!key || valueText === undefined) continue;
    const rawValue = valueText.trim();
    if (rawValue === "") {
      parsed[key] = "";
    } else if (rawValue === "true" || rawValue === "false") {
      parsed[key] = rawValue === "true";
    } else if (/^-?\d+$/.test(rawValue)) {
      const numberValue = Number(rawValue);
      parsed[key] = Number.isFinite(numberValue)
        ? numberValue
        : unquote(rawValue);
    } else {
      parsed[key] = unquote(rawValue);
    }
  }
  return parsed;
}

function escapeYamlString(value: string): string {
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

function serializeFrontmatter(template: FsTemplateInput): string {
  const lines = [`name: ${escapeYamlString(template.name)}`];
  if (template.description?.trim()) {
    lines.push(`description: ${escapeYamlString(template.description)}`);
  }
  lines.push(`enabled: ${template.enabled ? "true" : "false"}`);
  lines.push(`init: ${template.init ? "true" : "false"}`);
  lines.push(`defaultOn: ${template.defaultOn ? "true" : "false"}`);
  lines.push(`slash: ${template.slash ? "true" : "false"}`);
  lines.push(`order: ${Math.trunc(template.order)}`);
  return `---\n${lines.join("\n")}\n---\n${template.prompt.replace(/^\n+/, "")}\n`;
}

function readTemplateFile(location: string, workspaceRoot: string): FsTemplate {
  let raw: string;
  try {
    raw = readFileSync(location, "utf8");
  } catch (error) {
    throw new TemplateFileAccessError(location, error);
  }
  const frontmatter = raw.match(FRONTMATTER_RE);
  const metadata = frontmatter?.[1] ? parseFrontmatter(frontmatter[1]) : {};
  const body = frontmatter?.[2] ?? raw;
  const filename = location.split(sep).at(-1) ?? location;
  const slug = filename.replace(/\.md$/i, "");
  const name =
    typeof metadata.name === "string" && metadata.name ? metadata.name : slug;
  const description =
    typeof metadata.description === "string" && metadata.description
      ? metadata.description
      : undefined;
  const init = metadata.init === true;
  return {
    id: `fs:${location}`,
    name,
    description,
    enabled: metadata.enabled === undefined || metadata.enabled === true,
    init,
    defaultOn: init && metadata.defaultOn !== false,
    slash: metadata.slash === true,
    order:
      typeof metadata.order === "number" && Number.isFinite(metadata.order)
        ? Math.trunc(metadata.order)
        : 0,
    prompt: body.replace(/^\n+/, "").replace(/\n+$/, ""),
    location,
    workspaceRoot,
    scope: templateScope(location, workspaceRoot),
  };
}

export function readTemplatesAtDirectory(
  directory: string,
  workspaceRoot: string,
): FsTemplate[] {
  const templatesDirectory = join(directory, ".vibekick", "templates");
  let entries;
  try {
    entries = readdirSync(templatesDirectory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw new TemplateFileAccessError(templatesDirectory, error);
  }
  const templates = entries
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
    .map((entry) =>
      readTemplateFile(join(templatesDirectory, entry.name), workspaceRoot),
    );
  return sortFsTemplates(templates);
}

export function writeTemplate(
  location: string,
  workspaceRoot: string,
  input: FsTemplateInput,
): FsTemplate {
  const expanded = resolve(expandTemplatePath(location));
  mkdirSync(dirname(expanded), { recursive: true });
  writeFileSync(expanded, serializeFrontmatter(input), "utf8");
  return readTemplateFile(expanded, resolve(expandTemplatePath(workspaceRoot)));
}

export function deleteTemplate(location: string): string {
  const expanded = resolve(expandTemplatePath(location));
  try {
    unlinkSync(expanded);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return expanded;
    }
    throw error;
  }
  return expanded;
}
