import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { twJoin } from "tailwind-merge";
import { cx } from "@/lib/primitive";

/**
 * ComposerEditable
 * -------------------------------------------------------------
 * A near-drop-in replacement for the chat composer's `<Textarea>`. It
 * wraps a `<div contenteditable>` so a CSS-floated button slot can live
 * INSIDE the field and surrounding text wraps around it (like a floated
 * image), instead of wrapping at a uniform right padding that always
 * reads as crowded on mobile.
 *
 * Why a div: a `<textarea>` is a replaced element. Its text is opaque
 * to CSS, so `float` / `shape-outside` on a child cannot make text wrap
 * around it. Only a non-replaced editable element (contenteditable) can.
 *
 * Compatibility shim: the forwarded ref points at the underlying
 * `<div>` augmented with the textarea-like properties existing consumer
 * code reads (`value`, `selectionStart`, `selectionEnd`, `setSelectionRange`,
 * `setRangeText`). This means STT transcript append, slash-command and
 * file-mention popovers, draft restore, BroadcastChannel cross-tab sync,
 * and post-submit clear keep working with no consumer-side changes.
 *
 * The popovers compute caret coordinates from the ref. The shared
 * `getCaretCoordinates(...)` helper has been updated in lockstep to
 * branch on element type and use the Selection/Range API when the
 * element is a contenteditable div instead of the textarea-clone trick.
 *
 * Implementation notes:
 *  - Uncontrolled by design. React fighting the DOM during IME
 *    composition or browser-inserted `<div><br></div>` line wrappers is
 *    the #1 cause of contenteditable bugs. The div is the source of truth.
 *  - The button slot is rendered as the FIRST child with
 *    `contentEditable={false}` and `float-right`, so user text flows
 *    around its bounding box.
 *  - Top-right placement is intentional: bottom-right would need JS-driven
 *    `shape-outside` polygons recalculated on every input, which is brittle.
 *  - `document.execCommand("insertText", false, text)` for programmatic
 *    insertions - deprecated but the only API that preserves native undo/redo.
 *  - Placeholder is a sibling overlay (driven by React state). `:empty`
 *    pseudo-class doesn't work because the button slot is always a child.
 *  - IME composition is tracked via a ref; onInput swallows updates during
 *    composition and re-fires once on compositionend.
 *  - Paste is forced to plain text so the field never accumulates HTML,
 *    colors, fonts, or tables from the clipboard.
 */

const SLOT_ATTR = "data-composer-slot";

/**
 * Mark on the runtime div node identifying it as a ComposerEditable
 * shim. Helpers like `getCaretCoordinates` use this to decide between
 * textarea-clone caret math and the Selection/Range path.
 */
export const COMPOSER_EDITABLE_MARKER = "data-composer-editable";

export interface ComposerEditableProps {
  /**
   * Floated children rendered INSIDE the contenteditable div. Use this
   * for the mic / stop / submit button cluster.
   */
  buttonSlot?: ReactNode;
  /** Optional className to layer onto the editable div. */
  className?: string;
  /** Placeholder text shown when the field is empty. */
  placeholder?: string;
  /** Disabled equivalent. Sets contenteditable=false. */
  disabled?: boolean;
  /**
   * If provided, the component runs in controlled mode and rewrites
   * the DOM when this prop differs from the current DOM value. The
   * chat composer is uncontrolled; the new-session composer is controlled.
   */
  value?: string;
  /** Initial DOM value on first mount. Used in uncontrolled mode. */
  defaultValue?: string;
  /**
   * Fired on every input event (including IME compositionend). Mirrors
   * the textarea onChange shape: `e.target.value` and
   * `e.target.selectionStart` are exposed.
   */
  onChange?: (e: SyntheticTextEvent) => void;
  /** Fired on selection changes inside the field. */
  onSelect?: (e: SyntheticTextEvent) => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (e: ReactClipboardEvent<HTMLDivElement>) => void;
  onBlur?: (e: SyntheticTextEvent) => void;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
  autoCapitalize?: "none" | "sentences" | "words" | "characters" | "off" | "on";
  autoCorrect?: "on" | "off";
  spellCheck?: boolean;
  "data-test"?: string;
  "aria-label"?: string;
}

interface SyntheticTextTarget {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

interface SyntheticTextEvent<T = HTMLDivElement> {
  target: SyntheticTextTarget;
  currentTarget: T;
  preventDefault: () => void;
}

/**
 * The shape of the augmented `<div>` that consumer ref code interacts
 * with. Existing code typed against `HTMLTextAreaElement` continues to
 * compile via a structural cast at the call site (`ref={textareaRef as
 * unknown as ...}`); these properties are why it works at runtime.
 */
export interface ComposerEditableElement extends HTMLDivElement {
  value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  setSelectionRange(start: number, end?: number): void;
  setRangeText(
    text: string,
    start: number,
    end: number,
    selectMode?: "select" | "preserve" | "start" | "end",
  ): void;
}

/* -------------------------------------------------------------------- */
/* DOM helpers                                                          */
/* -------------------------------------------------------------------- */

function isSlotElement(el: Element | null): boolean {
  return !!el && el instanceof Element && el.hasAttribute(SLOT_ATTR);
}

/**
 * Read the plain-text contents of the contenteditable region, EXCLUDING
 * the button slot subtree. Mirrors `HTMLTextAreaElement.value`.
 * Walks element + text nodes, treating `<br>` and block-element starts
 * as newlines (matching the browser's `innerText` semantics for
 * contenteditable divs).
 */
function readEditableText(root: HTMLDivElement | null): string {
  if (!root) return "";
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE && isSlotElement(node as Element)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  const parts: string[] = [];
  let lastWasNewline = true;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? "";
      if (text) {
        parts.push(text);
        lastWasNewline = text.endsWith("\n");
      }
    } else if (node.nodeName === "BR") {
      parts.push("\n");
      lastWasNewline = true;
    } else if (node.nodeName === "DIV" || node.nodeName === "P") {
      if (parts.length > 0 && !lastWasNewline) {
        parts.push("\n");
        lastWasNewline = true;
      }
    }
  }
  let out = parts.join("");
  if (out.endsWith("\n")) out = out.slice(0, -1);
  return out;
}

/** Compute the caret offset (in `readEditableText` space) for an endpoint. */
function readCaretOffset(root: HTMLDivElement | null, endpoint: "start" | "end"): number {
  if (!root) return 0;
  const sel = root.ownerDocument.defaultView?.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const container = endpoint === "start" ? range.startContainer : range.endContainer;
  const offset = endpoint === "start" ? range.startOffset : range.endOffset;
  if (!root.contains(container) && container !== root) return 0;
  return countTextBefore(root, container, offset);
}

function countTextBefore(root: HTMLElement, node: Node, offset: number): number {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(n) {
        if (n.nodeType === Node.ELEMENT_NODE && isSlotElement(n as Element)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  let total = 0;
  let lastWasNewline = true;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) {
        total += offset;
      } else {
        const el = current as Element;
        for (let i = 0; i < offset && i < el.childNodes.length; i++) {
          total += measureSubtreeText(el.childNodes[i]);
        }
      }
      return total;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      const text = current.nodeValue ?? "";
      total += text.length;
      lastWasNewline = text.endsWith("\n");
    } else if (current.nodeName === "BR") {
      total += 1;
      lastWasNewline = true;
    } else if (current.nodeName === "DIV" || current.nodeName === "P") {
      if (total > 0 && !lastWasNewline) {
        total += 1;
        lastWasNewline = true;
      }
    }
  }
  return total;
}

function measureSubtreeText(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? "").length;
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
  const el = node as Element;
  if (isSlotElement(el)) return 0;
  if (el.nodeName === "BR") return 1;
  let total = 0;
  for (const child of Array.from(el.childNodes)) total += measureSubtreeText(child);
  return total;
}

/** Place the caret at `[start, end]` in `readEditableText` offset space. */
function applySelection(root: HTMLDivElement | null, start: number, end: number): void {
  if (!root) return;
  const win = root.ownerDocument.defaultView;
  if (!win) return;
  const startLoc = locateOffset(root, Math.max(0, start));
  const endLoc = locateOffset(root, Math.max(0, end));
  const range = root.ownerDocument.createRange();
  try {
    range.setStart(startLoc.node, startLoc.offset);
    range.setEnd(endLoc.node, endLoc.offset);
  } catch {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  const sel = win.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

interface NodeOffset {
  node: Node;
  offset: number;
}

function locateOffset(root: HTMLDivElement, target: number): NodeOffset {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(n) {
        if (n.nodeType === Node.ELEMENT_NODE && isSlotElement(n as Element)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  let consumed = 0;
  let lastWasNewline = true;
  let lastTextNode: Text | null = null;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current.nodeType === Node.TEXT_NODE) {
      const text = (current as Text).nodeValue ?? "";
      const len = text.length;
      if (consumed + len >= target) {
        return { node: current, offset: target - consumed };
      }
      consumed += len;
      lastTextNode = current as Text;
      lastWasNewline = text.endsWith("\n");
    } else if (current.nodeName === "BR") {
      if (consumed + 1 > target) {
        if (lastTextNode) {
          return { node: lastTextNode, offset: (lastTextNode.nodeValue ?? "").length };
        }
        return { node: root, offset: 0 };
      }
      consumed += 1;
      lastWasNewline = true;
    } else if (current.nodeName === "DIV" || current.nodeName === "P") {
      if (consumed > 0 && !lastWasNewline) {
        if (consumed + 1 > target) {
          if (lastTextNode) {
            return { node: lastTextNode, offset: (lastTextNode.nodeValue ?? "").length };
          }
        }
        consumed += 1;
        lastWasNewline = true;
      }
    }
  }
  if (lastTextNode) {
    return { node: lastTextNode, offset: (lastTextNode.nodeValue ?? "").length };
  }
  return { node: root, offset: root.childNodes.length };
}

/** Clear text content (preserves the slot). */
function clearEditableText(root: HTMLDivElement | null): void {
  if (!root) return;
  const slot = root.querySelector(`[${SLOT_ATTR}]`);
  for (const child of Array.from(root.childNodes)) {
    if (child === slot) continue;
    root.removeChild(child);
  }
}

/** Replace text content with `text` (preserves the slot at position 0). */
function setEditableText(root: HTMLDivElement | null, text: string): void {
  if (!root) return;
  clearEditableText(root);
  if (!text) return;
  const fragment = root.ownerDocument.createDocumentFragment();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) fragment.appendChild(root.ownerDocument.createElement("br"));
    if (lines[i]) {
      fragment.appendChild(root.ownerDocument.createTextNode(lines[i]));
    }
  }
  root.appendChild(fragment);
}

/* -------------------------------------------------------------------- */
/* Augment a div with textarea-like API                                 */
/* -------------------------------------------------------------------- */

/**
 * Augment `div` with `value` / `selectionStart` / `selectionEnd` /
 * `setSelectionRange` / `setRangeText` so existing consumer code typed
 * against `HTMLTextAreaElement` continues to work. Idempotent.
 *
 * The `setIsEmpty` callback is invoked whenever value changes
 * programmatically (so the placeholder overlay state stays in sync).
 */
function augmentDivAsTextarea(
  div: HTMLDivElement,
  setIsEmpty: (empty: boolean) => void,
): void {
  if ((div as ComposerEditableElement & { _composerAugmented?: boolean })._composerAugmented) {
    return;
  }
  Object.defineProperty(div, "value", {
    configurable: true,
    get(): string {
      return readEditableText(div);
    },
    set(v: string) {
      setEditableText(div, v);
      setIsEmpty(v.length === 0);
    },
  });
  Object.defineProperty(div, "selectionStart", {
    configurable: true,
    get(): number {
      return readCaretOffset(div, "start");
    },
  });
  Object.defineProperty(div, "selectionEnd", {
    configurable: true,
    get(): number {
      return readCaretOffset(div, "end");
    },
  });
  (div as unknown as {
    setSelectionRange: (s: number, e?: number) => void;
  }).setSelectionRange = (start: number, end?: number) => {
    applySelection(div, start, end ?? start);
  };
  (div as unknown as {
    setRangeText: (
      text: string,
      start: number,
      end: number,
      mode?: "select" | "preserve" | "start" | "end",
    ) => void;
  }).setRangeText = (text, start, end, mode = "preserve") => {
    applySelection(div, start, end);
    div.focus();
    const ok = document.execCommand("insertText", false, text);
    if (!ok) {
      const before = readEditableText(div).slice(0, start);
      const after = readEditableText(div).slice(end);
      setEditableText(div, before + text + after);
    }
    const len = readEditableText(div).length;
    const insertedEnd = start + text.length;
    switch (mode) {
      case "select":
        applySelection(div, start, insertedEnd);
        break;
      case "start":
        applySelection(div, start, start);
        break;
      case "end":
      case "preserve":
      default:
        applySelection(div, insertedEnd, insertedEnd);
        break;
    }
    setIsEmpty(len === 0);
  };
  Object.defineProperty(div, "_composerAugmented", {
    configurable: true,
    value: true,
  });
}

/* -------------------------------------------------------------------- */
/* Component                                                            */
/* -------------------------------------------------------------------- */

export const ComposerEditable = forwardRef<
  ComposerEditableElement,
  ComposerEditableProps
>(function ComposerEditable(
  {
    buttonSlot,
    className,
    placeholder,
    disabled,
    value,
    defaultValue,
    onChange,
    onSelect,
    onKeyDown,
    onPaste,
    onBlur,
    inputMode = "text",
    autoCapitalize = "sentences",
    autoCorrect = "on",
    spellCheck = true,
    ...rest
  },
  forwardedRef,
) {
  const divRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const [isEmpty, setIsEmpty] = useState(() => !(value ?? defaultValue ?? ""));

  // Augment the underlying div with textarea-compatible API and forward
  // the ref to the augmented div itself (not a custom handle). This means
  // existing consumer code typed against HTMLTextAreaElement compiles
  // with `as unknown as RefObject<HTMLTextAreaElement>` AND the popovers
  // get a real HTMLElement at runtime for their caret-coordinate math.
  useLayoutEffect(() => {
    const div = divRef.current;
    if (!div) return;
    augmentDivAsTextarea(div, setIsEmpty);
    // Forward ref: support both callback and object refs.
    if (typeof forwardedRef === "function") {
      forwardedRef(div as ComposerEditableElement);
    } else if (forwardedRef) {
      forwardedRef.current = div as ComposerEditableElement;
    }
  }, [forwardedRef]);

  // Initial DOM population on mount (uncontrolled mode uses defaultValue;
  // controlled mode populates from `value` and the next effect keeps it
  // in sync on prop changes).
  useLayoutEffect(() => {
    const div = divRef.current;
    if (!div) return;
    const initial = value ?? defaultValue ?? "";
    if (initial) {
      setEditableText(div, initial);
      setIsEmpty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync controlled value into the DOM when it changes externally.
  // Important: only rewrite when the prop genuinely differs from the
  // current DOM value, or we'd wipe the user's selection on every render.
  useEffect(() => {
    if (value === undefined) return;
    const div = divRef.current;
    if (!div) return;
    const current = readEditableText(div);
    if (current === value) return;
    setEditableText(div, value);
    setIsEmpty(value.length === 0);
  }, [value]);

  const fireChange = useCallback(() => {
    const div = divRef.current;
    if (!div) return;
    const text = readEditableText(div);
    setIsEmpty(text.length === 0);
    if (!onChange) return;
    onChange({
      target: {
        value: text,
        selectionStart: readCaretOffset(div, "start"),
        selectionEnd: readCaretOffset(div, "end"),
      },
      currentTarget: div,
      preventDefault: () => {},
    });
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    fireChange();
  }, [fireChange]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    fireChange();
  }, [fireChange]);

  const handlePaste = useCallback(
    (e: ReactClipboardEvent<HTMLDivElement>) => {
      if (onPaste) {
        onPaste(e);
        if (e.defaultPrevented) return;
      }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      e.preventDefault();
      document.execCommand("insertText", false, text);
    },
    [onPaste],
  );

  // Selection tracking: bind once via the document-level selectionchange
  // event. Lighter than per-element listeners and matches textarea's
  // onSelect semantics closely enough for the popover caret tracking.
  useEffect(() => {
    if (!onSelect) return;
    const doc = divRef.current?.ownerDocument;
    if (!doc) return;
    const listener = () => {
      const div = divRef.current;
      if (!div) return;
      const sel = doc.defaultView?.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const anchor = sel.anchorNode;
      if (!anchor) return;
      if (!div.contains(anchor) && anchor !== div) return;
      onSelect({
        target: {
          value: readEditableText(div),
          selectionStart: readCaretOffset(div, "start"),
          selectionEnd: readCaretOffset(div, "end"),
        },
        currentTarget: div,
        preventDefault: () => {},
      });
    };
    doc.addEventListener("selectionchange", listener);
    return () => doc.removeEventListener("selectionchange", listener);
  }, [onSelect]);

  const handleBlur = useCallback(
    (e: ReactFocusEvent<HTMLDivElement>) => {
      if (!onBlur) return;
      const div = divRef.current;
      onBlur({
        target: {
          value: readEditableText(div),
          selectionStart: readCaretOffset(div, "start"),
          selectionEnd: readCaretOffset(div, "end"),
        },
        currentTarget: e.currentTarget,
        preventDefault: () => e.preventDefault(),
      });
    },
    [onBlur],
  );

  return (
    <span
      data-slot="control"
      className="relative flex flex-col w-full h-full min-h-0"
    >
      <div
        ref={divRef}
        contentEditable={disabled ? false : true}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-disabled={disabled || undefined}
        aria-label={rest["aria-label"]}
        data-test={rest["data-test"]}
        {...{ [COMPOSER_EDITABLE_MARKER]: "" }}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        enterKeyHint="enter"
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={onKeyDown}
        onPaste={handlePaste}
        onBlur={handleBlur}
        className={cx(
          twJoin([
            // Field-style box matching the old textarea visually.
            "relative block min-h-16 max-h-full w-full appearance-none rounded-lg px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)]",
            "text-sm/6 text-fg",
            "border border-input enabled:hover:border-muted-fg/30",
            "outline-hidden focus:border-ring/70 focus:ring-3 focus:ring-ring/20 focus:enabled:hover:border-ring/80",
            "aria-disabled:bg-muted aria-disabled:cursor-not-allowed",
            "dark:scheme-dark",
            // Mobile touch handling - identical reasoning to the old Textarea.
            "touch-pan-y overscroll-contain",
            // Multiline input layout / scroll.
            "overflow-y-auto whitespace-pre-wrap break-words",
            "focus:outline-none",
          ]),
          className,
        )}
      >
        {/* Floated button slot. ALWAYS the first child so subsequent
            text wraps around its bounding box via CSS float. The slot is
            contenteditable=false, keeping the caret out of it, and is
            opaque to ComposerEditable's text-walking helpers via the
            `data-composer-slot` attribute. */}
        <span
          {...{ [SLOT_ATTR]: "" }}
          contentEditable={false}
          className="float-right clear-right ml-2 mb-1 select-none pointer-events-auto"
        >
          {buttonSlot}
        </span>
      </div>
      {/* Placeholder overlay. Driven by React state; the contenteditable's
          own children (the button slot) prevent CSS `:empty` from ever
          matching. The overlay is `pointer-events-none` so clicks fall
          through to the editable surface. */}
      {isEmpty && placeholder ? (
        <span
          aria-hidden="true"
          className="absolute top-[calc(--spacing(2.5))] left-[calc(--spacing(3.5))] sm:top-[calc(--spacing(1.5))] sm:left-[calc(--spacing(3))] pointer-events-none text-sm/6 text-muted-fg select-none"
        >
          {placeholder}
        </span>
      ) : null}
    </span>
  );
});
