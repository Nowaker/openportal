import { useState } from "react";
import { MinusIcon, PlusIcon } from "@heroicons/react/24/outline";

interface Props {
  header: string;
  summary: string | undefined;
  text: string;
}

export function OmoBlockView({ header, summary, text }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="my-1 rounded-md border border-border bg-muted/10 text-xs text-muted-fg">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
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
          {text}
        </pre>
      )}
    </div>
  );
}
