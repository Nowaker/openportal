import { Bars3Icon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import useMediaQuery from "@/hooks/use-media-query";
import { useInstanceStore } from "@/stores/instance-store";

interface OpencodeCommand {
  name: string;
  description?: string;
  source?: "command" | "mcp" | "skill";
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

export function useCommands() {
  const instance = useInstanceStore((s) => s.instance);
  const port = instance?.port;
  return useSWR<OpencodeCommand[]>(
    port ? `/api/opencode/${port}/command` : null,
    fetcher,
  );
}

interface CaretPosition {
  top: number;
  left: number;
}

function getCaretCoordinates(
  element: HTMLTextAreaElement,
  position: number,
): CaretPosition {
  const div = document.createElement("div");
  const style = getComputedStyle(element);

  const properties = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "textTransform",
    "wordSpacing",
    "textIndent",
    "whiteSpace",
    "wordWrap",
    "overflowWrap",
    "lineHeight",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "boxSizing",
  ] as const;

  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.width = `${element.offsetWidth}px`;

  for (const prop of properties) {
    div.style[prop] = style[prop];
  }

  document.body.appendChild(div);

  const text = element.value.substring(0, position);
  div.textContent = text;

  const span = document.createElement("span");
  span.textContent = element.value.substring(position) || ".";
  div.appendChild(span);

  const rect = element.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  const divRect = div.getBoundingClientRect();

  document.body.removeChild(div);

  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  let top = rect.top + (spanRect.top - divRect.top) - element.scrollTop;
  let left = rect.left + (spanRect.left - divRect.left) - element.scrollLeft;

  const isMobileDevice = window.innerWidth < 768;
  if (isMobileDevice) {
    const keyboardHeight = viewportHeight * 0.4;
    const availableSpace = rect.top - keyboardHeight;

    if (availableSpace < 200) {
      top =
        rect.bottom +
        (spanRect.bottom - divRect.bottom) +
        element.scrollTop +
        8;
    }

    left = Math.max(16, Math.min(left, viewportWidth - 320));
  }

  return { top, left };
}

// SlashCommandPopover supports three modes:
// - command: /<query>      - default, fetches from /api/.../command
// - agent:   /agent <q>    - caller passes agents via customItems
// - model:   /model <q>    - caller passes models via customItems
// Mode detection happens in useSlashCommand. Caller renders the popover
// conditional on slashCommand.isOpen and supplies customItems when
// mode != "command" (commands are fetched internally because they're a
// stable concept; agents/models depend on session state and live in
// hooks the caller already has).
export interface SlashItem {
  name: string;
  description?: string;
  source?: "command" | "mcp" | "skill" | "agent" | "model";
}

interface SlashCommandPopoverProps {
  isOpen: boolean;
  searchQuery: string;
  mode: SlashMode;
  customItems?: SlashItem[];
  onSelect: (itemName: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  slashStart: number | null;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onClose: () => void;
}

export type SlashMode = "command" | "agent" | "model";

export function SlashCommandPopover({
  isOpen,
  searchQuery,
  mode,
  customItems,
  onSelect,
  textareaRef,
  slashStart,
  selectedIndex,
  onSelectedIndexChange,
  onClose,
}: SlashCommandPopoverProps) {
  const { data: commands } = useCommands();
  const items: SlashItem[] =
    mode === "command" ? (commands ?? []) : (customItems ?? []);
  const [position, setPosition] = useState<CaretPosition | null>(null);
  const [, forceTick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { isMobile } = useMediaQuery();

  useEffect(() => {
    if (!isOpen) return;
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onChange = () => forceTick((n) => n + 1);
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
    };
  }, [isOpen]);

  const filtered = items.filter((c) =>
    c.name.toLowerCase().startsWith(searchQuery.toLowerCase()),
  );

  useEffect(() => {
    if (isOpen && slashStart !== null && textareaRef.current) {
      const coords = getCaretCoordinates(textareaRef.current, slashStart);
      if (
        coords.top <= 0 ||
        coords.left < 0 ||
        !Number.isFinite(coords.top) ||
        !Number.isFinite(coords.left)
      ) {
        const rect = textareaRef.current.getBoundingClientRect();
        setPosition({
          top: rect.top,
          left: Math.max(16, rect.left),
        });
      } else {
        setPosition(coords);
      }
    } else {
      setPosition(null);
    }
  }, [isOpen, slashStart, textareaRef]);

  useEffect(() => {
    if (listRef.current && filtered.length > 0) {
      const selectedElement = listRef.current.children[
        selectedIndex
      ] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex, filtered.length]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen, onClose, textareaRef]);

  if (!isOpen) return null;
  if (!isMobile && !position) return null;

  const renderItem = (cmd: SlashItem, index: number) => {
    const sourceLabel =
      cmd.source === "skill"
        ? "(skill)"
        : cmd.source === "mcp"
          ? "(mcp)"
          : cmd.source === "agent"
            ? "(agent)"
            : cmd.source === "model"
              ? "(model)"
              : "(builtin)";
    let cleanedDescription = (cmd.description ?? "").trimStart();
    if (
      cleanedDescription.toLowerCase().startsWith(sourceLabel.toLowerCase())
    ) {
      cleanedDescription = cleanedDescription.slice(sourceLabel.length).trimStart();
    }
    const displayPrefix =
      mode === "command" ? `/${cmd.name}` : cmd.name;
    return (
      <button
        type="button"
        key={cmd.name}
        className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
          index === selectedIndex
            ? "bg-primary/10 text-primary-fg"
            : "hover:bg-muted/50 text-foreground"
        }`}
        onClick={() => onSelect(cmd.name)}
        onMouseEnter={() => onSelectedIndexChange(index)}
      >
        <Bars3Icon
          className={`mt-0.5 size-4 shrink-0 ${
            index === selectedIndex ? "text-primary" : "text-muted-fg/70"
          }`}
        />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="font-medium leading-tight">{displayPrefix}</span>
          {cleanedDescription && (
            <span className="mt-0.5 text-xs leading-snug text-muted-fg break-words whitespace-normal">
              <span className="opacity-70">{sourceLabel}</span>{" "}
              {cleanedDescription}
            </span>
          )}
        </div>
      </button>
    );
  };

  const footer = (
    <div className="px-3 py-1.5 text-[10px] text-muted-fg/80 border-t border-border/40 bg-muted/20 rounded-b-xl flex items-center gap-3">
      <span>
        <kbd className="font-mono">↑↓</kbd> navigate
      </span>
      <span>
        <kbd className="font-mono">Tab/Enter</kbd> select
      </span>
      <span>
        <kbd className="font-mono">Esc</kbd> close
      </span>
    </div>
  );

  const headerLabel =
    mode === "agent"
      ? "Select Agent"
      : mode === "model"
        ? "Select Model"
        : "Select Command";
  const header = (
    <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-fg/80 border-b border-border/40 bg-muted/20 rounded-t-xl">
      {headerLabel}
    </div>
  );

  if (typeof document === "undefined") return null;

  let popover: React.ReactNode;
  if (isMobile) {
    const taRect = textareaRef.current?.getBoundingClientRect();
    const vv = window.visualViewport;
    const visibleTopInLayout = vv?.offsetTop ?? 0;
    const taTop = taRect?.top ?? window.innerHeight;
    const popoverBottomLayout = taTop - 12;
    const availableHeight = Math.max(
      160,
      popoverBottomLayout - visibleTopInLayout - 16,
    );
    const mobileStyle: React.CSSProperties = {
      left: 16,
      right: 16,
      bottom: window.innerHeight - popoverBottomLayout,
      maxHeight: `${availableHeight}px`,
      display: "flex",
      flexDirection: "column",
    };
    popover = (
      <div
        ref={popoverRef}
        className="fixed z-[100] rounded-xl border border-border/50 bg-background/95 backdrop-blur-xl shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
        style={mobileStyle}
      >
        <div className="shrink-0">{header}</div>
        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-y-auto p-1.5"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-fg/60">
              No commands match
            </div>
          ) : (
            filtered.map(renderItem)
          )}
        </div>
        <div className="shrink-0">{footer}</div>
      </div>
    );
  } else {
    const desktopStyle: React.CSSProperties = {
      top: (position?.top ?? 0) - 10,
      left: Math.min(position?.left ?? 0, window.innerWidth - 480),
      transform: "translateY(-100%)",
    };
    popover = (
      <div
        ref={popoverRef}
        className="fixed z-[100] w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border/50 bg-background/95 backdrop-blur-xl shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-150 ease-out"
        style={desktopStyle}
      >
        {header}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-fg/60">
              No commands match
            </div>
          ) : (
            filtered.map(renderItem)
          )}
        </div>
        {footer}
      </div>
    );
  }

  return createPortal(popover, document.body);
}

interface UseSlashCommandResult {
  isOpen: boolean;
  searchQuery: string;
  mode: SlashMode;
  selectedIndex: number;
  slashStart: number | null;
  handleInputChange: (value: string, cursorPosition: number) => void;
  handleKeyDown: (e: React.KeyboardEvent, count: number) => boolean;
  handleSelect: (itemName: string, currentValue: string) => string;
  close: () => void;
  setSelectedIndex: (index: number) => void;
}

export function useSlashCommand(): UseSlashCommandResult {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState<SlashMode>("command");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [slashStart, setSlashStart] = useState<number | null>(null);

  const close = () => {
    setIsOpen(false);
    setSearchQuery("");
    setMode("command");
    setSlashStart(null);
    setSelectedIndex(0);
  };

  const handleInputChange = (value: string, _cursorPosition: number) => {
    if (!value.startsWith("/")) {
      close();
      return;
    }
    // Sub-picker detection: /agent <q> and /model <q> stay open after the
    // first space and switch into a different item list. Regex captures
    // the rest-after-space as the query.
    const subMatch = value.match(/^\/(agent|model)\s+(\S*)$/);
    if (subMatch) {
      const sub = subMatch[1] as "agent" | "model";
      const query = subMatch[2] ?? "";
      setMode(sub);
      setSearchQuery(query);
      setSlashStart(0);
      setSelectedIndex(0);
      setIsOpen(true);
      return;
    }
    const afterSlash = value.slice(1);
    const firstSpace = afterSlash.search(/[\s]/);
    const query = firstSpace === -1 ? afterSlash : afterSlash.slice(0, firstSpace);
    if (firstSpace === -1) {
      setMode("command");
      setSearchQuery(query);
      setSlashStart(0);
      setSelectedIndex(0);
      setIsOpen(true);
      return;
    }
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent, count: number): boolean => {
    if (!isOpen) return false;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(count, 1));
        return true;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev - 1 < 0 ? Math.max(count - 1, 0) : prev - 1,
        );
        return true;
      case "Escape":
        e.preventDefault();
        close();
        return true;
      case "Tab":
      case "Enter":
        if (count > 0) {
          e.preventDefault();
          return true;
        }
        return false;
      default:
        return false;
    }
  };

  const handleSelect = (itemName: string, currentValue: string): string => {
    if (slashStart === null) return currentValue;
    const beforeSlash = currentValue.slice(0, slashStart);
    let newValue: string;
    if (mode === "agent") {
      newValue = `${beforeSlash}/agent ${itemName}`;
    } else if (mode === "model") {
      newValue = `${beforeSlash}/model ${itemName}`;
    } else {
      const afterSlash = currentValue.slice(slashStart + 1);
      const firstSpace = afterSlash.search(/[\s]/);
      const tail = firstSpace === -1 ? "" : afterSlash.slice(firstSpace);
      newValue = `${beforeSlash}/${itemName} ${tail.replace(/^\s+/, "")}`;
    }
    close();
    return newValue;
  };

  return {
    isOpen,
    searchQuery,
    mode,
    selectedIndex,
    slashStart,
    handleInputChange,
    handleKeyDown,
    handleSelect,
    close,
    setSelectedIndex,
  };
}
