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

const NESTED_KEY_SUGGESTIONS: Record<string, string[]> = {
  environment: [
    "PATH",
    "HOME",
    "USER",
    "NODE_ENV",
    "PYTHONPATH",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GROQ_API_KEY",
    "MISTRAL_API_KEY",
    "GITHUB_TOKEN",
    "GITLAB_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
    "AWS_PROFILE",
    "DATABASE_URL",
    "REDIS_URL",
    "OPENCODE_BASE_URL",
  ],
  headers: [
    "Authorization",
    "Content-Type",
    "Accept",
    "Accept-Language",
    "User-Agent",
    "X-API-Key",
    "X-Request-Id",
    "X-Forwarded-For",
    "Cookie",
  ],
};

type JsonCtx =
  | { kind: "none" }
  | {
      kind: "key" | "string-value" | "raw-value";
      field?: string;
      replaceStart: number;
      replaceEnd: number;
      prefix: string;
    }
  | {
      kind: "nested-key";
      parent: string;
      replaceStart: number;
      replaceEnd: number;
      prefix: string;
    };

function walkBufferToCursor(
  text: string,
  cursor: number,
): {
  depth: number;
  inString: boolean;
  stringStart: number;
  parentStack: (string | undefined)[];
} {
  let depth = 0;
  let inString = false;
  let stringStart = -1;
  let pendingKey: string | undefined = undefined;
  const parentStack: (string | undefined)[] = [];
  for (let i = 0; i < cursor; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') {
        inString = false;
        pendingKey = text.slice(stringStart + 1, i);
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      stringStart = i;
      pendingKey = undefined;
      continue;
    }
    if (c === "{") {
      depth++;
      parentStack.push(pendingKey);
      pendingKey = undefined;
    } else if (c === "[") {
      depth++;
      parentStack.push(undefined);
      pendingKey = undefined;
    } else if (c === "}" || c === "]") {
      depth--;
      parentStack.pop();
      pendingKey = undefined;
    } else if (c === ",") {
      pendingKey = undefined;
    }
  }
  return { depth, inString, stringStart, parentStack };
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
  const { depth, inString, stringStart, parentStack } = walkBufferToCursor(
    text,
    cursor,
  );
  if (depth !== 1 && depth !== 2) return { kind: "none" };

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
      if (depth === 1) {
        return { kind: "key", replaceStart, replaceEnd, prefix };
      }
      const parent = parentStack[1];
      if (parent && NESTED_KEY_SUGGESTIONS[parent]) {
        return {
          kind: "nested-key",
          parent,
          replaceStart,
          replaceEnd,
          prefix,
        };
      }
      return { kind: "none" };
    }
    return { kind: "none" };
  }

  if (depth !== 1) return { kind: "none" };

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
  else if (ctx.kind === "nested-key")
    pool = NESTED_KEY_SUGGESTIONS[ctx.parent] ?? [];
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

type SyntaxToken = {
  kind: "string-key" | "string-value" | "number" | "keyword" | "punct" | "plain";
  text: string;
};

function tokenizeJson(text: string): SyntaxToken[] {
  const out: SyntaxToken[] = [];
  let plain = "";
  const flushPlain = () => {
    if (plain) {
      out.push({ kind: "plain", text: plain });
      plain = "";
    }
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      flushPlain();
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === '"') break;
        if (text[j] === "\n") break;
        j++;
      }
      const endIdx = j < text.length && text[j] === '"' ? j + 1 : j;
      let k = endIdx;
      while (k < text.length && /\s/.test(text[k])) k++;
      const isKey = text[k] === ":";
      out.push({
        kind: isKey ? "string-key" : "string-value",
        text: text.substring(i, endIdx),
      });
      i = endIdx;
      continue;
    }
    if (
      (c === "-" || (c >= "0" && c <= "9")) &&
      (i === 0 || !/[a-zA-Z0-9_]/.test(text[i - 1]))
    ) {
      flushPlain();
      let j = i;
      if (text[j] === "-") j++;
      while (j < text.length && /[0-9]/.test(text[j])) j++;
      if (text[j] === ".") {
        j++;
        while (j < text.length && /[0-9]/.test(text[j])) j++;
      }
      if (text[j] === "e" || text[j] === "E") {
        j++;
        if (text[j] === "+" || text[j] === "-") j++;
        while (j < text.length && /[0-9]/.test(text[j])) j++;
      }
      if (j > i) {
        out.push({ kind: "number", text: text.substring(i, j) });
        i = j;
        continue;
      }
    }
    if (
      text.startsWith("true", i) &&
      (i === 0 || !/[a-zA-Z0-9_]/.test(text[i - 1])) &&
      !/[a-zA-Z0-9_]/.test(text[i + 4] ?? "")
    ) {
      flushPlain();
      out.push({ kind: "keyword", text: "true" });
      i += 4;
      continue;
    }
    if (
      text.startsWith("false", i) &&
      (i === 0 || !/[a-zA-Z0-9_]/.test(text[i - 1])) &&
      !/[a-zA-Z0-9_]/.test(text[i + 5] ?? "")
    ) {
      flushPlain();
      out.push({ kind: "keyword", text: "false" });
      i += 5;
      continue;
    }
    if (
      text.startsWith("null", i) &&
      (i === 0 || !/[a-zA-Z0-9_]/.test(text[i - 1])) &&
      !/[a-zA-Z0-9_]/.test(text[i + 4] ?? "")
    ) {
      flushPlain();
      out.push({ kind: "keyword", text: "null" });
      i += 4;
      continue;
    }
    if (c === "{" || c === "}" || c === "[" || c === "]" || c === "," || c === ":") {
      flushPlain();
      out.push({ kind: "punct", text: c });
      i++;
      continue;
    }
    plain += c;
    i++;
  }
  flushPlain();
  return out;
}

const TOKEN_COLOR_CLASSES: Record<SyntaxToken["kind"], string> = {
  "string-key": "text-sky-400",
  "string-value": "text-emerald-400",
  number: "text-amber-400",
  keyword: "text-violet-400",
  punct: "text-fg/70",
  plain: "text-fg/90",
};

function HighlightedJsonOverlay({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeJson(text), [text]);
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={TOKEN_COLOR_CLASSES[t.kind]}>
          {t.text}
        </span>
      ))}
      {/* Trailing newline marker so the overlay matches textarea
          line-height even when text ends in \n */}
      {"\n"}
    </>
  );
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

  const overlayRef = useRef<HTMLPreElement | null>(null);
  const handleScroll = () => {
    const ta = taRef.current;
    const ov = overlayRef.current;
    if (!ta || !ov) return;
    ov.scrollTop = ta.scrollTop;
    ov.scrollLeft = ta.scrollLeft;
  };

  return (
    <div className="relative w-full rounded-md border border-border bg-bg overflow-hidden focus-within:border-primary">
      <pre
        ref={overlayRef}
        aria-hidden="true"
        className="absolute inset-0 m-0 p-3 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
      >
        <HighlightedJsonOverlay text={value} />
      </pre>
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={handleSelect}
        onSelect={handleSelect}
        onScroll={handleScroll}
        onBlur={() => setTimeout(close, 120)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={computedRows}
        aria-label={ariaLabel}
        style={{
          WebkitTextFillColor: "transparent",
          caretColor: "currentColor",
          background: "transparent",
        }}
        className="relative block w-full m-0 p-3 font-mono text-[12px] leading-[1.5] outline-none border-0 resize-none text-fg"
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
