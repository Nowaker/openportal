import {
  ArchiveBoxIcon,
  BookOpenIcon,
  CodeBracketIcon,
  CogIcon,
  CommandLineIcon,
  DocumentIcon,
  DocumentTextIcon,
  FilmIcon,
  FolderIcon,
  MusicalNoteIcon,
  PhotoIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, SVGProps } from "react";

// Per-extension and per-filename icon + color map for the file tree.
// Inspired by VSCode's pkief.material-icon-theme but using @heroicons
// only - no new dep. Differentiation comes mostly from Tailwind text-*
// colors layered on a small set of icon shapes, not from a unique glyph
// per language.
//
// Resolution order:
//   1. Directory: match folder name against known meaningful dirs
//      (.git, node_modules, src/app/apps/packages -> tinted folder).
//   2. File: match exact filename (LICENSE, Dockerfile, package.json...).
//   3. File: match extension.
//   4. Fallback: DocumentIcon, default color.

type IconType = ComponentType<SVGProps<SVGSVGElement>>;
export interface FileIconResult {
  Icon: IconType;
  color: string;
}

const DEFAULT_FILE: FileIconResult = {
  Icon: DocumentIcon,
  color: "text-muted-fg",
};
const DEFAULT_DIR: FileIconResult = {
  Icon: FolderIcon,
  color: "text-blue-400",
};

const DIR_BY_NAME: Record<string, FileIconResult> = {
  ".git": { Icon: FolderIcon, color: "text-orange-500" },
  ".github": { Icon: FolderIcon, color: "text-muted-fg" },
  ".vscode": { Icon: FolderIcon, color: "text-blue-500" },
  "node_modules": { Icon: FolderIcon, color: "text-green-600" },
  "src": { Icon: FolderIcon, color: "text-blue-400" },
  "app": { Icon: FolderIcon, color: "text-blue-400" },
  "apps": { Icon: FolderIcon, color: "text-blue-400" },
  "packages": { Icon: FolderIcon, color: "text-blue-400" },
  "lib": { Icon: FolderIcon, color: "text-purple-400" },
  "components": { Icon: FolderIcon, color: "text-purple-400" },
  "public": { Icon: FolderIcon, color: "text-cyan-400" },
  "dist": { Icon: FolderIcon, color: "text-gray-500" },
  "build": { Icon: FolderIcon, color: "text-gray-500" },
  ".output": { Icon: FolderIcon, color: "text-gray-500" },
  ".turbo": { Icon: FolderIcon, color: "text-gray-500" },
  ".next": { Icon: FolderIcon, color: "text-gray-500" },
  "tests": { Icon: FolderIcon, color: "text-amber-500" },
  "__tests__": { Icon: FolderIcon, color: "text-amber-500" },
  "docs": { Icon: FolderIcon, color: "text-emerald-400" },
};

const FILE_BY_NAME: Record<string, FileIconResult> = {
  "LICENSE": { Icon: DocumentTextIcon, color: "text-amber-500" },
  "LICENSE.md": { Icon: DocumentTextIcon, color: "text-amber-500" },
  "LICENSE.txt": { Icon: DocumentTextIcon, color: "text-amber-500" },
  "COPYING": { Icon: DocumentTextIcon, color: "text-amber-500" },
  "NOTICE": { Icon: DocumentTextIcon, color: "text-amber-500" },
  "AUTHORS": { Icon: DocumentTextIcon, color: "text-amber-500" },
  "README": { Icon: BookOpenIcon, color: "text-blue-400" },
  "README.md": { Icon: BookOpenIcon, color: "text-blue-400" },
  "CHANGELOG": { Icon: BookOpenIcon, color: "text-emerald-400" },
  "CHANGELOG.md": { Icon: BookOpenIcon, color: "text-emerald-400" },
  "CONTRIBUTING": { Icon: BookOpenIcon, color: "text-emerald-400" },
  "CONTRIBUTING.md": { Icon: BookOpenIcon, color: "text-emerald-400" },
  "AGENTS.md": { Icon: BookOpenIcon, color: "text-purple-400" },
  "CLAUDE.md": { Icon: BookOpenIcon, color: "text-purple-400" },
  "Dockerfile": { Icon: ArchiveBoxIcon, color: "text-cyan-400" },
  "Dockerfile.dev": { Icon: ArchiveBoxIcon, color: "text-cyan-400" },
  ".dockerignore": { Icon: ArchiveBoxIcon, color: "text-cyan-400" },
  "docker-compose.yml": { Icon: ArchiveBoxIcon, color: "text-cyan-400" },
  "docker-compose.yaml": { Icon: ArchiveBoxIcon, color: "text-cyan-400" },
  "Makefile": { Icon: CogIcon, color: "text-muted-fg" },
  "GNUmakefile": { Icon: CogIcon, color: "text-muted-fg" },
  "CMakeLists.txt": { Icon: CogIcon, color: "text-muted-fg" },
  "Gemfile": { Icon: CodeBracketIcon, color: "text-red-500" },
  "Rakefile": { Icon: CodeBracketIcon, color: "text-red-500" },
  "Vagrantfile": { Icon: CodeBracketIcon, color: "text-cyan-500" },
  "Procfile": { Icon: CogIcon, color: "text-purple-500" },
  "PKGBUILD": { Icon: ArchiveBoxIcon, color: "text-blue-500" },
  ".SRCINFO": { Icon: ArchiveBoxIcon, color: "text-blue-500" },
  ".gitignore": { Icon: CogIcon, color: "text-orange-500" },
  ".gitattributes": { Icon: CogIcon, color: "text-orange-500" },
  ".npmignore": { Icon: CogIcon, color: "text-red-500" },
  ".npmrc": { Icon: CogIcon, color: "text-red-500" },
  ".prettierrc": { Icon: CogIcon, color: "text-pink-400" },
  ".prettierignore": { Icon: CogIcon, color: "text-pink-400" },
  ".eslintrc": { Icon: CogIcon, color: "text-violet-400" },
  ".eslintignore": { Icon: CogIcon, color: "text-violet-400" },
  ".editorconfig": { Icon: CogIcon, color: "text-muted-fg" },
  "package.json": { Icon: CodeBracketIcon, color: "text-amber-500" },
  "package-lock.json": { Icon: CogIcon, color: "text-muted-fg" },
  "bun.lock": { Icon: CogIcon, color: "text-muted-fg" },
  "yarn.lock": { Icon: CogIcon, color: "text-muted-fg" },
  "pnpm-lock.yaml": { Icon: CogIcon, color: "text-muted-fg" },
  "Cargo.toml": { Icon: CodeBracketIcon, color: "text-orange-600" },
  "Cargo.lock": { Icon: CogIcon, color: "text-muted-fg" },
  "go.mod": { Icon: CodeBracketIcon, color: "text-cyan-500" },
  "go.sum": { Icon: CogIcon, color: "text-muted-fg" },
  "tsconfig.json": { Icon: CodeBracketIcon, color: "text-blue-500" },
  "jsconfig.json": { Icon: CodeBracketIcon, color: "text-yellow-500" },
};

const EXT_MAP: Record<string, FileIconResult> = {
  ts: { Icon: CodeBracketIcon, color: "text-blue-500" },
  tsx: { Icon: CodeBracketIcon, color: "text-blue-500" },
  mts: { Icon: CodeBracketIcon, color: "text-blue-500" },
  cts: { Icon: CodeBracketIcon, color: "text-blue-500" },
  js: { Icon: CodeBracketIcon, color: "text-yellow-400" },
  jsx: { Icon: CodeBracketIcon, color: "text-yellow-400" },
  mjs: { Icon: CodeBracketIcon, color: "text-yellow-400" },
  cjs: { Icon: CodeBracketIcon, color: "text-yellow-400" },
  json: { Icon: CodeBracketIcon, color: "text-amber-500" },
  jsonc: { Icon: CodeBracketIcon, color: "text-amber-500" },
  md: { Icon: DocumentTextIcon, color: "text-blue-300" },
  markdown: { Icon: DocumentTextIcon, color: "text-blue-300" },
  mdx: { Icon: DocumentTextIcon, color: "text-blue-300" },
  txt: { Icon: DocumentTextIcon, color: "text-muted-fg" },
  log: { Icon: DocumentTextIcon, color: "text-muted-fg" },
  rst: { Icon: DocumentTextIcon, color: "text-blue-300" },
  css: { Icon: CodeBracketIcon, color: "text-pink-400" },
  scss: { Icon: CodeBracketIcon, color: "text-pink-500" },
  sass: { Icon: CodeBracketIcon, color: "text-pink-500" },
  less: { Icon: CodeBracketIcon, color: "text-blue-300" },
  html: { Icon: CodeBracketIcon, color: "text-orange-500" },
  htm: { Icon: CodeBracketIcon, color: "text-orange-500" },
  vue: { Icon: CodeBracketIcon, color: "text-emerald-500" },
  svelte: { Icon: CodeBracketIcon, color: "text-orange-500" },
  py: { Icon: CodeBracketIcon, color: "text-blue-500" },
  pyc: { Icon: CodeBracketIcon, color: "text-muted-fg" },
  go: { Icon: CodeBracketIcon, color: "text-cyan-500" },
  rs: { Icon: CodeBracketIcon, color: "text-orange-600" },
  rb: { Icon: CodeBracketIcon, color: "text-red-500" },
  java: { Icon: CodeBracketIcon, color: "text-orange-500" },
  kt: { Icon: CodeBracketIcon, color: "text-purple-500" },
  swift: { Icon: CodeBracketIcon, color: "text-orange-500" },
  c: { Icon: CodeBracketIcon, color: "text-blue-500" },
  h: { Icon: CodeBracketIcon, color: "text-blue-500" },
  cpp: { Icon: CodeBracketIcon, color: "text-blue-500" },
  cc: { Icon: CodeBracketIcon, color: "text-blue-500" },
  hpp: { Icon: CodeBracketIcon, color: "text-blue-500" },
  cs: { Icon: CodeBracketIcon, color: "text-violet-500" },
  php: { Icon: CodeBracketIcon, color: "text-violet-500" },
  lua: { Icon: CodeBracketIcon, color: "text-blue-500" },
  pl: { Icon: CodeBracketIcon, color: "text-blue-500" },
  r: { Icon: CodeBracketIcon, color: "text-blue-500" },
  scala: { Icon: CodeBracketIcon, color: "text-red-500" },
  clj: { Icon: CodeBracketIcon, color: "text-emerald-500" },
  ex: { Icon: CodeBracketIcon, color: "text-violet-500" },
  exs: { Icon: CodeBracketIcon, color: "text-violet-500" },
  erl: { Icon: CodeBracketIcon, color: "text-red-500" },
  hs: { Icon: CodeBracketIcon, color: "text-violet-500" },
  elm: { Icon: CodeBracketIcon, color: "text-cyan-500" },
  dart: { Icon: CodeBracketIcon, color: "text-cyan-500" },
  sh: { Icon: CommandLineIcon, color: "text-green-500" },
  bash: { Icon: CommandLineIcon, color: "text-green-500" },
  zsh: { Icon: CommandLineIcon, color: "text-green-500" },
  fish: { Icon: CommandLineIcon, color: "text-green-500" },
  ps1: { Icon: CommandLineIcon, color: "text-blue-500" },
  bat: { Icon: CommandLineIcon, color: "text-blue-500" },
  cmd: { Icon: CommandLineIcon, color: "text-blue-500" },
  yaml: { Icon: CodeBracketIcon, color: "text-red-400" },
  yml: { Icon: CodeBracketIcon, color: "text-red-400" },
  toml: { Icon: CodeBracketIcon, color: "text-orange-500" },
  ini: { Icon: CogIcon, color: "text-muted-fg" },
  cfg: { Icon: CogIcon, color: "text-muted-fg" },
  conf: { Icon: CogIcon, color: "text-muted-fg" },
  env: { Icon: CogIcon, color: "text-green-500" },
  xml: { Icon: CodeBracketIcon, color: "text-orange-400" },
  sql: { Icon: TableCellsIcon, color: "text-pink-400" },
  graphql: { Icon: CodeBracketIcon, color: "text-pink-500" },
  gql: { Icon: CodeBracketIcon, color: "text-pink-500" },
  proto: { Icon: CodeBracketIcon, color: "text-cyan-500" },
  png: { Icon: PhotoIcon, color: "text-violet-400" },
  jpg: { Icon: PhotoIcon, color: "text-violet-400" },
  jpeg: { Icon: PhotoIcon, color: "text-violet-400" },
  gif: { Icon: PhotoIcon, color: "text-violet-400" },
  webp: { Icon: PhotoIcon, color: "text-violet-400" },
  avif: { Icon: PhotoIcon, color: "text-violet-400" },
  svg: { Icon: PhotoIcon, color: "text-yellow-500" },
  bmp: { Icon: PhotoIcon, color: "text-violet-400" },
  ico: { Icon: PhotoIcon, color: "text-violet-400" },
  mp4: { Icon: FilmIcon, color: "text-purple-500" },
  webm: { Icon: FilmIcon, color: "text-purple-500" },
  mov: { Icon: FilmIcon, color: "text-purple-500" },
  avi: { Icon: FilmIcon, color: "text-purple-500" },
  mkv: { Icon: FilmIcon, color: "text-purple-500" },
  mp3: { Icon: MusicalNoteIcon, color: "text-pink-500" },
  ogg: { Icon: MusicalNoteIcon, color: "text-pink-500" },
  wav: { Icon: MusicalNoteIcon, color: "text-pink-500" },
  flac: { Icon: MusicalNoteIcon, color: "text-pink-500" },
  m4a: { Icon: MusicalNoteIcon, color: "text-pink-500" },
  pdf: { Icon: DocumentTextIcon, color: "text-red-500" },
  doc: { Icon: DocumentTextIcon, color: "text-blue-500" },
  docx: { Icon: DocumentTextIcon, color: "text-blue-500" },
  odt: { Icon: DocumentTextIcon, color: "text-blue-500" },
  xls: { Icon: TableCellsIcon, color: "text-green-500" },
  xlsx: { Icon: TableCellsIcon, color: "text-green-500" },
  ods: { Icon: TableCellsIcon, color: "text-green-500" },
  csv: { Icon: TableCellsIcon, color: "text-emerald-400" },
  tsv: { Icon: TableCellsIcon, color: "text-emerald-400" },
  zip: { Icon: ArchiveBoxIcon, color: "text-amber-500" },
  tar: { Icon: ArchiveBoxIcon, color: "text-amber-500" },
  gz: { Icon: ArchiveBoxIcon, color: "text-amber-500" },
  tgz: { Icon: ArchiveBoxIcon, color: "text-amber-500" },
  bz2: { Icon: ArchiveBoxIcon, color: "text-amber-500" },
  xz: { Icon: ArchiveBoxIcon, color: "text-amber-500" },
  rar: { Icon: ArchiveBoxIcon, color: "text-amber-500" },
  "7z": { Icon: ArchiveBoxIcon, color: "text-amber-500" },
  iso: { Icon: ArchiveBoxIcon, color: "text-amber-500" },
};

export function getFileIcon(filename: string, isDir: boolean): FileIconResult {
  if (isDir) {
    return DIR_BY_NAME[filename] ?? DEFAULT_DIR;
  }
  const exact = FILE_BY_NAME[filename];
  if (exact) return exact;
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return DEFAULT_FILE;
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_MAP[ext] ?? DEFAULT_FILE;
}
