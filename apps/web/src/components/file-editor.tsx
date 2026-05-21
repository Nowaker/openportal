import { useEffect, useMemo, useRef, useState } from "react";

interface FileEditorProps {
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  wordWrap: boolean;
}

export function FileEditor({
  value,
  onChange,
  onSave,
  wordWrap,
}: FileEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lineCount = useMemo(
    () => Math.max(1, (value.match(/\n/g)?.length ?? 0) + 1),
    [value],
  );

  const syncScroll = () => {
    const ta = textareaRef.current;
    const g = gutterRef.current;
    if (!ta || !g) return;
    g.scrollTop = ta.scrollTop;
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = ta.value.slice(start, end);
      if (selected.includes("\n") && !e.shiftKey) {
        const before = ta.value.slice(0, start);
        const after = ta.value.slice(end);
        const indented = selected.replace(/^/gm, "  ");
        const next = before + indented + after;
        onChange(next);
        requestAnimationFrame(() => {
          ta.selectionStart = start;
          ta.selectionEnd = end + (indented.length - selected.length);
        });
        return;
      }
      if (e.shiftKey) {
        const before = ta.value.slice(0, start);
        const after = ta.value.slice(end);
        const target = selected || before.split("\n").pop() || "";
        const dedented = target.replace(/^( {1,2}|\t)/gm, "");
        if (dedented === target) return;
        const removed = target.length - dedented.length;
        const next = before.slice(0, before.length - target.length) + dedented + (selected ? after : after);
        onChange(next);
        requestAnimationFrame(() => {
          ta.selectionStart = Math.max(0, start - removed);
          ta.selectionEnd = Math.max(0, end - removed);
        });
        return;
      }
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const next = `${before}  ${after}`;
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = start + 2;
        ta.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div
        ref={gutterRef}
        className="h-full w-12 shrink-0 select-none overflow-hidden border-r border-border bg-muted/20 py-3 pr-2 text-right font-mono text-xs leading-relaxed text-muted-fg/60 tabular-nums"
        data-test="portal-files-editor-gutter"
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={handleKey}
        data-test="portal-files-editor"
        className={`h-full w-full resize-none border-0 bg-bg p-3 font-mono text-xs leading-relaxed outline-none focus:ring-0 ${
          wordWrap ? "" : "whitespace-pre overflow-auto"
        }`}
        wrap={wordWrap ? "soft" : "off"}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
      />
    </div>
  );
}

export function useEditorCursor(textareaRef: React.RefObject<HTMLTextAreaElement | null>) {
  const [pos, setPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const update = () => {
      const idx = ta.selectionStart;
      const before = ta.value.slice(0, idx);
      const lines = before.split("\n");
      const line = lines.length;
      const col = (lines[lines.length - 1]?.length ?? 0) + 1;
      setPos({ line, col });
    };
    update();
    ta.addEventListener("keyup", update);
    ta.addEventListener("click", update);
    ta.addEventListener("input", update);
    return () => {
      ta.removeEventListener("keyup", update);
      ta.removeEventListener("click", update);
      ta.removeEventListener("input", update);
    };
  }, [textareaRef]);
  return pos;
}
