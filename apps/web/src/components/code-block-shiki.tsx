import { useEffect, useMemo, useState } from "react";
import {
  bundledLanguagesInfo,
  codeToHtml,
  type BundledLanguage,
} from "shiki";
import detectLanguage from "flourite";

// shiki tokenizes the entire input up front and the file viewer is the
// only call site that may hand it multi-megabyte content. 200 KB is
// the same cap the prism-based viewer used before this migration; it
// preserves the source-viewer use case while keeping the highlighter
// from grinding on huge files. Truncation is announced inline so the
// user knows to use Raw for the rest.
const HIGHLIGHT_CAP = 200 * 1024;

const SUPPORTED_LANGUAGE_IDS = new Set<string>(
  bundledLanguagesInfo.map((l) => l.id),
);

export const LANGUAGE_OPTIONS = bundledLanguagesInfo
  .map((l) => ({ id: l.id, name: l.name ?? l.id }))
  .sort((a, b) => a.name.localeCompare(b.name));

// flourite gives lowercase-no-spaces results that don't always line up
// with shiki's grammar ids ("c++" vs "cpp", "objective-c" vs "objc"
// etc.). Centralize the few divergences here; everything else falls
// through unchanged. "bash" -> "shell" because the user reports
// "bash" rendering as inexistent in their highlighter dropdown +
// they want "shell" instead (more portable + always supported).
const FLOURITE_TO_SHIKI: Record<string, string> = {
  "c++": "cpp",
  "objective-c": "objc",
  "f#": "fsharp",
  "c#": "csharp",
  bash: "shell",
  unknown: "text",
};

function normalizeForShiki(rawLang: string): string {
  const lower = rawLang.toLowerCase();
  if (FLOURITE_TO_SHIKI[lower]) return FLOURITE_TO_SHIKI[lower];
  if (SUPPORTED_LANGUAGE_IDS.has(lower)) return lower;
  return "text";
}

// Filename-based language overrides. Applied BEFORE flourite content
// detection so canonical filenames map to the right grammar even when
// the content sniffer guesses wrong (e.g. LICENSE → flourite says SQL;
// PKGBUILD → Ruby). Match by exact basename first; an extension table
// can layer on later if needed.
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
  ".dockerignore": "ignore",
  ".npmignore": "ignore",
  ".prettierignore": "ignore",
  ".eslintignore": "ignore",
  ".editorconfig": "ini",
  gitconfig: "ini",
  gitignore: "ignore",
};

// Case-insensitive matches for rc/init files where casing varies between
// distributions (Zshrc vs .zshrc, Xsessionrc vs .Xsessionrc, etc.).
// Values are shiki language ids; "bash" goes through FLOURITE_TO_SHIKI
// to "shell" because shiki's shell grammar is the user-preferred id.
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

// Extension table. Applied BEFORE pattern fallback + flourite content
// detection so common extensions (.sh, .txt, .log) hit their canonical
// language without going through the content sniffer's heuristics. Plain
// .txt was being detected as Lua via flourite false-positive; .sh was
// being detected as "bash" which shiki renders as text. Both fixed by
// explicit extension mappings here.
const EXTENSION_TO_LANG: Record<string, string> = {
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ksh": "shell",
  ".dash": "shell",
  ".ash": "shell",
  ".fish": "fish",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".bat": "bat",
  ".cmd": "bat",
  ".txt": "text",
  ".log": "text",
  ".lst": "text",
  ".tsv": "text",
  ".env": "shell",
  ".sql": "sql",
  ".conf": "ini",
  ".cfg": "ini",
  ".ini": "ini",
  ".toml": "toml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".jsonc": "jsonc",
  ".json5": "json5",
  ".xml": "xml",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".md": "markdown",
  ".mdx": "mdx",
  ".rst": "text",
  ".tex": "latex",
  ".py": "python",
  ".rb": "ruby",
  ".pl": "perl",
  ".php": "php",
  ".lua": "lua",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".mts": "typescript",
  ".cts": "typescript",
  ".go": "go",
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".scala": "scala",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hs": "haskell",
  ".elm": "elm",
  ".dart": "dart",
  ".r": "r",
  ".R": "r",
  ".vim": "vim",
  ".lock": "yaml",
  ".diff": "diff",
  ".patch": "diff",
  ".csv": "csv",
};

// Pattern fallback for .<word>rc[.<suffix>] - covers .zshrc.pre,
// .bashrc.local, .zshrc.d/* etc. Default to shell since these are
// usually shell scripts; an explicit override in LOWER_FILENAME_TO_LANG
// (e.g. .wgetrc -> ini) takes precedence and runs before this regex.
const FILENAME_PATTERNS: Array<[RegExp, string]> = [
  [/^\.[a-z][a-z0-9_-]*rc(\.[a-z0-9._-]+)?$/i, "shell"],
];

export function languageFromFilename(filename: string): string | null {
  if (!filename) return null;
  const base = filename.split("/").pop() ?? filename;
  const hit = FILENAME_TO_LANG[base];
  if (hit) return normalizeForShiki(hit);
  const lower = base.toLowerCase();
  const ciHit = LOWER_FILENAME_TO_LANG[lower];
  if (ciHit) return normalizeForShiki(ciHit);
  // Extension match. Find the rightmost dot AFTER the leading dot (so
  // dotfiles like .bashrc don't get matched on the empty pre-dot
  // segment). For multi-dot files like foo.test.ts we take only the
  // final extension; the FILENAME_PATTERNS regex below handles the
  // *.rc.local cases.
  const dotIdx = lower.lastIndexOf(".");
  if (dotIdx > 0) {
    const ext = lower.slice(dotIdx);
    const extHit = EXTENSION_TO_LANG[ext];
    if (extHit) return normalizeForShiki(extHit);
  }
  for (const [pattern, lang] of FILENAME_PATTERNS) {
    if (pattern.test(base)) return normalizeForShiki(lang);
  }
  return null;
}

export function detectLanguageFromContent(
  content: string,
  filename?: string,
): string {
  if (filename) {
    const byName = languageFromFilename(filename);
    if (byName) return byName;
  }
  const sample = content.slice(0, 16 * 1024);
  const out = detectLanguage(sample);
  return normalizeForShiki(out.language || "text");
}

interface ShikiCodeBlockProps {
  content: string;
  language: string;
}

export function ShikiCodeBlock({ content, language }: ShikiCodeBlockProps) {
  const truncated = content.length > HIGHLIGHT_CAP;
  const display = useMemo(() => {
    if (!truncated) return content;
    const rest = content.length - HIGHLIGHT_CAP;
    return (
      content.slice(0, HIGHLIGHT_CAP) +
      `\n\n[truncated for highlighter; ${formatBytes(rest)} more - use Raw to see the rest]`
    );
  }, [content, truncated]);

  const resolvedLang = useMemo(() => normalizeForShiki(language), [language]);
  const [html, setHtml] = useState<string>("");
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPending(true);
    codeToHtml(display, {
      lang: resolvedLang as BundledLanguage,
      theme: "github-dark",
    })
      .then((h) => {
        if (cancelled) return;
        setHtml(h);
        setPending(false);
      })
      .catch(() => {
        if (cancelled) return;
        return codeToHtml(display, {
          lang: "text",
          theme: "github-dark",
        }).then((h) => {
          if (cancelled) return;
          setHtml(h);
          setPending(false);
        });
      });
    return () => {
      cancelled = true;
    };
  }, [display, resolvedLang]);

  return (
    <div
      className="text-xs leading-relaxed [&>pre]:!m-0 [&>pre]:!overflow-auto [&>pre]:!p-4 [&>pre]:!bg-transparent"
      data-pending={pending ? "true" : "false"}
      dangerouslySetInnerHTML={{ __html: html || `<pre>${escapeHtml(display)}</pre>` }}
    />
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
