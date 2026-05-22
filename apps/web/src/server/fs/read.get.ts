import { defineHandler, getQuery } from "nitro/h3";
import { readFile, lstat, stat as statFollow } from "node:fs/promises";

import { resolveScopedPath } from "../lib/fs-security";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

// Lookup by extension is "good enough" for the file viewer's syntax-
// highlighting hint. The viewer falls back to plain text if the
// language is unknown. This map is INTENTIONALLY minimal and additive
// only; if a user reports a missing language, add it here.
const EXTENSION_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  xml: "markup",
  html: "markup",
  htm: "markup",
  svg: "markup",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  lua: "lua",
  vim: "vim",
  ini: "ini",
  dockerfile: "docker",
  makefile: "makefile",
  service: "systemd",
  timer: "systemd",
  socket: "systemd",
  mount: "systemd",
  automount: "systemd",
  target: "systemd",
  device: "systemd",
  slice: "systemd",
  swap: "systemd",
  network: "systemd",
  netdev: "systemd",
  link: "systemd",
  nspawn: "systemd",
  busname: "systemd",
  conf: "ini",
  cfg: "ini",
  desktop: "ini",
};

const FILENAME_TO_LANG: Record<string, string> = {
  Dockerfile: "docker",
  Makefile: "makefile",
  ".gitignore": "bash",
  ".gitattributes": "bash",
  ".editorconfig": "ini",
  ".env": "bash",
  ".env.local": "bash",
  ".env.production": "bash",
  ".env.development": "bash",
};

const LOWER_FILENAME_TO_LANG: Record<string, string> = {
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".kshrc": "bash",
  ".tcshrc": "bash",
  ".cshrc": "bash",
  ".profile": "bash",
  ".bash_profile": "bash",
  ".zprofile": "bash",
  ".zlogin": "bash",
  ".zlogout": "bash",
  ".envrc": "bash",
  ".inputrc": "bash",
  ".dircolors": "bash",
  ".aliases": "bash",
  ".functions": "bash",
  ".exports": "bash",
  ".extra": "bash",
  ".curlrc": "bash",
  ".wgetrc": "ini",
  ".vimrc": "vim",
  ".tmux.conf": "ini",
  ".xresources": "ini",
  ".xsession": "bash",
  ".xinitrc": "bash",
  ".xprofile": "bash",
  ".xsessionrc": "bash",
  zshrc: "bash",
  bashrc: "bash",
  xresources: "ini",
  xsession: "bash",
  xinitrc: "bash",
  xprofile: "bash",
  xsessionrc: "bash",
  inputrc: "bash",
  sudoers: "ini",
  fstab: "ini",
  hosts: "ini",
  crontab: "bash",
};

const FILENAME_PATTERNS: Array<[RegExp, string]> = [
  [/^\.[a-z][a-z0-9_-]*rc(\.[a-z0-9._-]+)?$/i, "bash"],
];

function languageFor(filename: string): string {
  const exact = FILENAME_TO_LANG[filename];
  if (exact) return exact;
  const lower = filename.toLowerCase();
  const ciExact = LOWER_FILENAME_TO_LANG[lower];
  if (ciExact) return ciExact;
  for (const [pattern, lang] of FILENAME_PATTERNS) {
    if (pattern.test(filename)) return lang;
  }
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "text";
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXTENSION_TO_LANG[ext] ?? "text";
}

// Null bytes in the first 8KB are the simplest reliable binary heuristic
// that doesn't require a magic-number table. Misclassifies CRLF UTF-16
// files as binary, but UTF-16 in source repos is rare and the worst case
// is "use the raw endpoint to download instead of viewing in-page".
function looksBinary(buf: Buffer): boolean {
  const sniff = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < sniff.length; i++) {
    if (sniff[i] === 0) return true;
  }
  return false;
}

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const rawPath = String(query.path ?? "");
  if (rawPath.length === 0) {
    return { error: "path query required" };
  }
  const scope = resolveScopedPath(rawPath);
  if (!scope.ok) {
    return { error: scope.error, path: scope.path };
  }
  const path = scope.path;

  let stat;
  try {
    stat = await lstat(path);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Path not accessible",
      path,
    };
  }
  if (stat.isDirectory()) {
    return { error: "Is a directory, not a file", path };
  }
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    return { error: "Not a regular file", path };
  }
  if (stat.isSymbolicLink()) {
    try {
      const followed = await statFollow(path);
      if (followed.isDirectory()) {
        return { error: "Is a directory, not a file (symlink)", path };
      }
      if (!followed.isFile()) {
        return { error: "Symlink target is not a regular file", path };
      }
      stat = followed;
    } catch (e) {
      return {
        error: e instanceof Error
          ? `Symlink target not accessible: ${e.message}`
          : "Symlink target not accessible",
        path,
      };
    }
  }

  const filename = path.split("/").pop() ?? "";

  if (stat.size > MAX_TEXT_BYTES) {
    return {
      path,
      filename,
      size: stat.size,
      kind: "too_large" as const,
      maxBytes: MAX_TEXT_BYTES,
      language: languageFor(filename),
    };
  }

  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Cannot read file",
      path,
    };
  }

  if (looksBinary(buf)) {
    return {
      path,
      filename,
      size: stat.size,
      kind: "binary" as const,
      language: languageFor(filename),
    };
  }

  return {
    path,
    filename,
    size: stat.size,
    kind: "text" as const,
    content: buf.toString("utf8"),
    language: languageFor(filename),
  };
});
