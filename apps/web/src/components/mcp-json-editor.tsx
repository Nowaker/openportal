import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  className?: string;
  ariaLabel?: string;
}

const KEY_SUGGESTIONS = [
  "type",
  "enabled",
  "url",
  "command",
  "environment",
  "headers",
];

const STRING_VALUE_SUGGESTIONS: Record<string, string[]> = {
  type: ["local", "remote"],
};

const RAW_VALUE_SUGGESTIONS: Record<string, string[]> = {
  enabled: ["true", "false"],
};

type JsonCtx =
  | { kind: "none" }
  | {
      kind: "key" | "string-value" | "raw-value";
      field?: string;
      replaceStart: number;
      replaceEnd: number;
      prefix: string;
    };

function findOuterDepthAndStringStart(
  text: string,
  cursor: number,
): { depth: number; inString: boolean; stringStart: number } {
  let depth = 0;
  let inString = false;
  let stringStart = -1;
  for (let i = 0; i < cursor; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      stringStart = i;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
  }
  return { depth, inString, stringStart };
}

function findEndOfString(text: string, start: number): number {
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === '"') return i;
    if (c === "\n") return i;
  }
  return text.length;
}

function findKeyBefore(text: string, colonPos: number): string | undefined {
  let i = colonPos - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  if (i < 0 || text[i] !== '"') return undefined;
  const endQuote = i;
  i--;
  while (i >= 0) {
    if (text[i] === '"') {
      let escapes = 0;
      let j = i - 1;
      while (j >= 0 && text[j] === "\\") {
        escapes++;
        j--;
      }
      if (escapes % 2 === 0) return text.slice(i + 1, endQuote);
    }
    if (text[i] === "\n") return undefined;
    i--;
  }
  return undefined;
}

function parseJsonContext(text: string, cursor: number): JsonCtx {
  const { depth, inString, stringStart } = findOuterDepthAndStringStart(
    text,
    cursor,
  );
  if (depth !== 1) return { kind: "none" };

  if (inString && stringStart >= 0) {
    const replaceStart = stringStart + 1;
    const replaceEnd = findEndOfString(text, cursor);
    const prefix = text.slice(replaceStart, cursor);

    let k = stringStart - 1;
    while (k >= 0 && /\s/.test(text[k])) k--;
    if (k < 0) return { kind: "none" };
    if (text[k] === ":") {
      const field = findKeyBefore(text, k);
      if (!field) return { kind: "none" };
      return {
        kind: "string-value",
        field,
        replaceStart,
        replaceEnd,
        prefix,
      };
    }
    if (text[k] === "{" || text[k] === ",") {
      return { kind: "key", replaceStart, replaceEnd, prefix };
    }
    return { kind: "none" };
  }

  let m = cursor - 1;
  while (m >= 0 && /[A-Za-z0-9_]/.test(text[m])) m--;
  const wordStart = m + 1;
  if (wordStart === cursor) return { kind: "none" };
  let n = wordStart - 1;
  while (n >= 0 && /\s/.test(text[n])) n--;
  if (n < 0 || text[n] !== ":") return { kind: "none" };
  const field = findKeyBefore(text, n);
  if (!field) return { kind: "none" };

  let wordEnd = cursor;
  while (wordEnd < text.length && /[A-Za-z0-9_]/.test(text[wordEnd])) wordEnd++;

  return {
    kind: "raw-value",
    field,
    replaceStart: wordStart,
    replaceEnd: wordEnd,
    prefix: text.slice(wordStart, cursor),
  };
}

function suggestionsForContext(ctx: JsonCtx): string[] {
  if (ctx.kind === "none") return [];
  const lowerPrefix = ctx.prefix.toLowerCase();
  let pool: string[] = [];
  if (ctx.kind === "key") pool = KEY_SUGGESTIONS;
  else if (ctx.kind === "string-value" && ctx.field)
    pool = STRING_VALUE_SUGGESTIONS[ctx.field] ?? [];
  else if (ctx.kind === "raw-value" && ctx.field)
    pool = RAW_VALUE_SUGGESTIONS[ctx.field] ?? [];
  if (pool.length === 0) return [];
  return pool.filter((s) => s.toLowerCase().startsWith(lowerPrefix));
}

const MIRROR_STYLE_PROPS = [
  "direction",
  "box-sizing",
  "width",
  "height",
  "overflow-x",
  "overflow-y",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-size",
  "font-size-adjust",
  "line-height",
  "font-family",
  "text-align",
  "text-transform",
  "text-indent",
  "text-decoration",
  "letter-spacing",
  "word-spacing",
  "tab-size",
];

function caretCoordinates(
  el: HTMLTextAreaElement,
  position: number,
): { top: number; left: number; height: number } {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const computed = window.getComputedStyle(el);
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.top = "0";
  div.style.left = "-9999px";
  for (const prop of MIRROR_STYLE_PROPS) {
    div.style.setProperty(prop, computed.getPropertyValue(prop));
  }
  div.textContent = el.value.substring(0, position);
  const span = document.createElement("span");
  span.textContent = el.value.substring(position) || ".";
  div.appendChild(span);
  const spanRect = span.getBoundingClientRect();
  const divRect = div.getBoundingClientRect();
  const lineHeight =
    parseFloat(computed.lineHeight) ||
    parseFloat(computed.fontSize) * 1.2 ||
    16;
  const coords = {
    top: spanRect.top - divRect.top - el.scrollTop,
    left: spanRect.left - divRect.left - el.scrollLeft,
    height: lineHeight,
  };
  document.body.removeChild(div);
  return coords;
}

interface PopoverState {
  items: string[];
  selected: number;
  ctx: JsonCtx;
  anchor: { top: number; left: number; height: number };
}

export function McpJsonEditor({
  value,
  onChange,
  rows,
  className,
  ariaLabel,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const computedRows = useMemo(
    () => rows ?? Math.max(8, Math.min(24, value.split("\n").length + 1)),
    [rows, value],
  );

  const close = useCallback(() => setPopover(null), []);

  const compute = useCallback((force: boolean) => {
    const el = taRef.current;
    if (!el) return;
    if (el.selectionStart !== el.selectionEnd) {
      setPopover(null);
      return;
    }
    const cursor = el.selectionStart;
    const ctx = parseJsonContext(el.value, cursor);
    const items = suggestionsForContext(ctx);
    if (items.length === 0) {
      setPopover(null);
      return;
    }
    if (!force) {
      if (ctx.kind === "none") {
        setPopover(null);
        return;
      }
    }
    const anchor = caretCoordinates(el, cursor);
    setPopover((prev) => ({
      items,
      selected:
        prev && prev.items.length === items.length && prev.selected < items.length
          ? prev.selected
          : 0,
      ctx,
      anchor,
    }));
  }, []);

  const apply = useCallback(
    (insertion: string) => {
      const el = taRef.current;
      if (!el || !popover || popover.ctx.kind === "none") return;
      const { replaceStart, replaceEnd } = popover.ctx;
      const next =
        el.value.slice(0, replaceStart) +
        insertion +
        el.value.slice(replaceEnd);
      onChange(next);
      setPopover(null);
      const newCursor = replaceStart + insertion.length;
      requestAnimationFrame(() => {
        if (taRef.current) {
          taRef.current.focus();
          taRef.current.setSelectionRange(newCursor, newCursor);
        }
      });
    },
    [onChange, popover],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
      e.preventDefault();
      compute(true);
      return;
    }
    if (!popover) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPopover((p) =>
        p ? { ...p, selected: (p.selected + 1) % p.items.length } : p,
      );
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setPopover((p) =>
        p
          ? {
              ...p,
              selected: (p.selected - 1 + p.items.length) % p.items.length,
            }
          : p,
      );
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      apply(popover.items[popover.selected]);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    requestAnimationFrame(() => compute(false));
  };

  const handleSelect = () => {
    if (popover) requestAnimationFrame(() => compute(false));
  };

  useEffect(() => {
    return () => {
      setPopover(null);
    };
  }, []);

  return (
    <div className="relative">
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={handleSelect}
        onSelect={handleSelect}
        onBlur={() => setTimeout(close, 120)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={computedRows}
        aria-label={ariaLabel}
        className={className}
        data-test="portal-mcp-json-textarea"
      />
      {popover && popover.anchor && (
        <ul
          role="listbox"
          className="absolute z-10 min-w-[140px] max-w-[260px] rounded-md border border-border bg-bg shadow-lg overflow-hidden text-xs font-mono"
          style={{
            top: popover.anchor.top + popover.anchor.height + 2,
            left: popover.anchor.left,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {popover.items.map((item, idx) => (
            <li
              key={item}
              role="option"
              aria-selected={idx === popover.selected}
              onClick={() => apply(item)}
              onMouseEnter={() =>
                setPopover((p) => (p ? { ...p, selected: idx } : p))
              }
              className={`cursor-pointer px-2 py-1 ${
                idx === popover.selected
                  ? "bg-accent text-accent-fg"
                  : "hover:bg-muted"
              }`}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
