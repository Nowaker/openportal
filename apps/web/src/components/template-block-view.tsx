import { useState } from "react";
import { MinusIcon, PlusIcon } from "@heroicons/react/24/outline";
import { PROMPT_TEMPLATE_PREAMBLE } from "@/lib/prompt-template-format";

interface Props {
  name: string;
  body: string;
  modified?: boolean;
  isFirst?: boolean;
}

export function TemplateBlockView({
  name,
  body,
  modified = false,
  isFirst = false,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const suffix = modified ? " + modifications" : "";
  return (
    <div className="my-1 rounded-md border border-l-4 border-l-accent/60 border-border bg-muted/10 text-xs text-muted-fg">
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
        <span className="text-muted-fg/70">Template:</span>
        <span className="truncate">
          {name}
          {modified && (
            <span className="ml-1 text-accent/80">{suffix}</span>
          )}
        </span>
      </button>
      {expanded && (
        <pre className="border-t border-border/60 whitespace-pre-wrap break-words px-2 py-1 text-[10px] font-mono leading-relaxed">
          {isFirst ? `---\n\n${PROMPT_TEMPLATE_PREAMBLE}\n\n` : ""}
          {`# /template "${name}"${suffix}:\n\n${body}`}
        </pre>
      )}
    </div>
  );
}
