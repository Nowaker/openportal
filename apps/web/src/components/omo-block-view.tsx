import { useState } from "react";
import { MinusIcon, PlusIcon } from "@heroicons/react/24/outline";

interface Props {
  header: string;
  summary: string | undefined;
  text: string;
  // When the server stripped the OMO body to save wire bytes, `text`
  // arrives empty and `lazyFetchUrl` is set. First expand triggers a
  // fetch + caches the result inside this component instance.
  lazyFetchUrl?: string;
}

export function OmoBlockView({ header, summary, text, lazyFetchUrl }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [fetched, setFetched] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && lazyFetchUrl && fetched === null && !loading) {
      setLoading(true);
      setFetchError(null);
      try {
        const r = await fetch(lazyFetchUrl);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { text?: string };
        setFetched(typeof j.text === "string" ? j.text : "");
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : "fetch failed");
      } finally {
        setLoading(false);
      }
    }
  };

  const body = lazyFetchUrl ? (fetched ?? "") : text;

  return (
    <div className="my-1 rounded-md border border-border bg-muted/10 text-xs text-muted-fg">
      <button
        type="button"
        onClick={() => void handleToggle()}
        className={`flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-muted/20 hover:text-fg ${
          expanded ? "sticky top-0 z-10 bg-bg/95 backdrop-blur" : ""
        }`}
      >
        {expanded ? (
          <MinusIcon className="size-3 shrink-0" />
        ) : (
          <PlusIcon className="size-3 shrink-0" />
        )}
        <span className="truncate font-mono">{header}</span>
        {summary && (
          <span className="truncate text-muted-fg/70">{summary}</span>
        )}
      </button>
      {expanded && (
        <pre className="border-t border-border/60 whitespace-pre-wrap break-words px-2 py-1 text-[10px] font-mono leading-relaxed">
          {loading && <span className="italic text-muted-fg/70">Loading…</span>}
          {fetchError && (
            <span className="text-warning">
              Could not load OMO body: {fetchError}. Refresh the session to retry.
            </span>
          )}
          {!loading && !fetchError && body}
        </pre>
      )}
    </div>
  );
}
