import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/providers/theme-provider";

let cachedMermaid: typeof import("mermaid").default | null = null;
async function loadMermaid(): Promise<typeof import("mermaid").default> {
  if (cachedMermaid) return cachedMermaid;
  const mod = await import("mermaid");
  cachedMermaid = mod.default;
  return cachedMermaid;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `mermaid-${idCounter}-${Date.now().toString(36)}`;
}

interface MermaidBlockProps {
  source: string;
}

export function MermaidBlock({ source }: MermaidBlockProps) {
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize({
          startOnLoad: false,
          theme: resolvedTheme === "dark" ? "dark" : "default",
          securityLevel: "strict",
        });
        const id = nextId();
        const { svg: rendered } = await mermaid.render(id, source.trim());
        if (!cancelled) setSvg(rendered);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Mermaid render failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, resolvedTheme]);

  if (error) {
    return (
      <div
        className="rounded border border-danger/40 bg-danger-subtle/30 p-3 text-xs text-danger-subtle-fg"
        data-test="portal-mermaid-error"
      >
        <div className="mb-2 font-semibold">Mermaid render error</div>
        <pre className="overflow-x-auto whitespace-pre-wrap text-[10px] text-muted-fg">
          {error}
        </pre>
        <details className="mt-2 text-[10px] text-muted-fg">
          <summary className="cursor-pointer">Source</summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">
            {source}
          </pre>
        </details>
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        className="rounded border border-border bg-bg p-3 text-xs text-muted-fg"
        data-test="portal-mermaid-loading"
      >
        Loading mermaid diagram…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-2 overflow-x-auto rounded border border-border bg-bg p-3"
      data-test="portal-mermaid-rendered"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
