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

export function detectLanguageFromContent(content: string): string {
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
