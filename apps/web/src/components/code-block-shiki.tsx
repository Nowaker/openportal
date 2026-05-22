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
// through unchanged.
const FLOURITE_TO_SHIKI: Record<string, string> = {
  "c++": "cpp",
  "objective-c": "objc",
  "f#": "fsharp",
  "c#": "csharp",
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
  PKGBUILD: "bash",
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
  ".gitignore": "ignore",
  ".dockerignore": "ignore",
  ".npmignore": "ignore",
  ".prettierignore": "ignore",
  ".eslintignore": "ignore",
  ".editorconfig": "ini",
};

// Case-insensitive matches for rc/init files where casing varies between
// distributions (Zshrc vs .zshrc, Xsessionrc vs .Xsessionrc, etc.).
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

// Pattern fallback for .<word>rc[.<suffix>] - covers .zshrc.pre,
// .bashrc.local, .zshrc.d/* etc.
const FILENAME_PATTERNS: Array<[RegExp, string]> = [
  [/^\.[a-z][a-z0-9_-]*rc(\.[a-z0-9._-]+)?$/i, "bash"],
];

export function languageFromFilename(filename: string): string | null {
  if (!filename) return null;
  const base = filename.split("/").pop() ?? filename;
  const hit = FILENAME_TO_LANG[base];
  if (hit) return normalizeForShiki(hit);
  const lower = base.toLowerCase();
  const ciHit = LOWER_FILENAME_TO_LANG[lower];
  if (ciHit) return normalizeForShiki(ciHit);
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
