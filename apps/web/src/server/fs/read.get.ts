import { defineHandler, getQuery } from "nitro/h3";
import { readFile, lstat, stat as statFollow } from "node:fs/promises";

import { resolveScopedPath } from "../lib/fs-security";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

// Backend file-language detection. Returns shiki-compatible language
// ids so the file viewer's picker shows the correct language already
// selected and the highlighter doesn't fall through to plain text.
//
// User report (verbatim, #22 in AI_TODO.md):
//   '.sh' opened with highlighting set to inexistent 'bash'. had to
//   switch to shell. all these files get it wrong: gitconfig bashrc
//   gitignore rvmrc xsessionrc zshrc. ... '.txt' gets interpreted as
//   lua. content detection must be fixed. use extensions. use *rc.
//
// Two fixes:
//   1. 'bash' -> 'shell' everywhere. shiki has 'shell' in its
//      bundled grammar list ('bash' is only a flourite/content-
//      sniffer label, never appears in the picker). The frontend's
//      FLOURITE_TO_SHIKI maps 'bash' -> 'shell' for content-sniffer
//      results, but backend file-extension matches bypass that
//      normalization and need to emit the canonical id directly.
//   2. Mirror the frontend's full dotfile + *rc coverage so common
//      config files (gitconfig, gitignore, rvmrc, xsessionrc, etc.)
//      don't fall through to content sniffing where '.txt' lands on
//      lua etc.
//
// Source-of-truth coverage is at apps/web/src/components/
// code-block-shiki.tsx (frontend); this server-side copy mirrors it.
// Keep the two in sync when adding new entries.
const EXTENSION_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  md: "markdown",
  mdx: "mdx",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ksh: "shell",
  dash: "shell",
  ash: "shell",
  fish: "fish",
  ps1: "powershell",
  psm1: "powershell",
  bat: "bat",
  cmd: "bat",
  txt: "text",
  log: "text",
  lst: "text",
  tsv: "text",
  env: "shell",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  html: "html",
  htm: "html",
  svg: "xml",
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
  lock: "yaml",
  diff: "diff",
  patch: "diff",
  csv: "csv",
  rst: "text",
  tex: "latex",
};

const FILENAME_TO_LANG: Record<string, string> = {
  LICENSE: "text",
  "LICENSE.txt": "text",
  "LICENSE.md": "markdown",
  COPYING: "text",
  NOTICE: "text",
  AUTHORS: "text",
  CONTRIBUTORS: "text",
  README: "text",
  "README.md": "markdown",
  CHANGELOG: "text",
  "CHANGELOG.md": "markdown",
  PKGBUILD: "shell",
  ".SRCINFO": "ini",
  Dockerfile: "docker",
  "Dockerfile.dev": "docker",
  Makefile: "makefile",
  "Makefile.am": "makefile",
  "Makefile.in": "makefile",
  GNUmakefile: "makefile",
  Procfile: "yaml",
  Gemfile: "ruby",
  Rakefile: "ruby",
  Vagrantfile: "ruby",
  ".gitconfig": "ini",
  ".gitignore": "ignore",
  ".gitattributes": "text",
  ".dockerignore": "ignore",
  ".npmignore": "ignore",
  ".prettierignore": "ignore",
  ".eslintignore": "ignore",
  ".editorconfig": "ini",
  ".env": "shell",
  ".env.local": "shell",
  ".env.production": "shell",
  ".env.development": "shell",
  gitconfig: "ini",
  gitignore: "ignore",
};

const LOWER_FILENAME_TO_LANG: Record<string, string> = {
  ".bashrc": "shell",
  ".zshrc": "shell",
  ".kshrc": "shell",
  ".tcshrc": "shell",
  ".cshrc": "shell",
  ".profile": "shell",
  ".bash_profile": "shell",
  ".zprofile": "shell",
  ".zlogin": "shell",
  ".zlogout": "shell",
  ".envrc": "shell",
  ".inputrc": "shell",
  ".dircolors": "shell",
  ".aliases": "shell",
  ".functions": "shell",
  ".exports": "shell",
  ".extra": "shell",
  ".curlrc": "shell",
  ".rvmrc": "shell",
  ".wgetrc": "ini",
  ".vimrc": "vim",
  ".tmux.conf": "ini",
  ".xresources": "ini",
  ".xsession": "shell",
  ".xinitrc": "shell",
  ".xprofile": "shell",
  ".xsessionrc": "shell",
  zshrc: "shell",
  bashrc: "shell",
  rvmrc: "shell",
  xresources: "ini",
  xsession: "shell",
  xinitrc: "shell",
  xprofile: "shell",
  xsessionrc: "shell",
  inputrc: "shell",
  sudoers: "ini",
  fstab: "ini",
  hosts: "ini",
  crontab: "shell",
};

const FILENAME_PATTERNS: Array<[RegExp, string]> = [
  [/^\.[a-z][a-z0-9_-]*rc(\.[a-z0-9._-]+)?$/i, "shell"],
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
