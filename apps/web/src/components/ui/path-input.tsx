import { forwardRef, useImperativeHandle, useRef } from "react";
import type { KeyboardEvent } from "react";

import { splitInput } from "@/lib/path-utils";

// Generic path-completion input. Owns Tab=complete and Enter=submit
// keybindings; the parent owns the entry list (so /api/fs/list -
// directories only, vs /api/fs/browse - files and dirs - can both
// drive this same widget).
//
// The component never converts to/from ~user form on its own: the
// parent passes whatever string it wants displayed, and gets the same
// string back via onChange. Encoding choices stay co-located with the
// data-fetch logic that needs to know about them.

export interface PathInputEntry {
  readonly name: string;
  readonly isDir: boolean;
}

export interface PathInputHandle {
  focus(): void;
  selectAll(): void;
  setCaretEnd(): void;
}

interface PathInputProps {
  readonly id?: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onSubmit: () => void;
  readonly entries: readonly PathInputEntry[];
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
  readonly appendSlashOnDir?: boolean;
  readonly pathMode?: "absolute" | "relative";
}

export const PathInput = forwardRef<PathInputHandle, PathInputProps>(
  function PathInput(
    {
      value,
      id,
      onChange,
      onSubmit,
      entries,
      disabled,
      placeholder,
      className,
      appendSlashOnDir = true,
      pathMode = "absolute",
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      focus() {
        inputRef.current?.focus();
      },
      selectAll() {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(0, el.value.length);
      },
      setCaretEnd() {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      },
    }));

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Tab") {
        const { dir, prefix } = splitInput(value);
        const filtered = prefix
          ? entries.filter((x) =>
              x.name.toLowerCase().startsWith(prefix.toLowerCase()),
            )
          : entries;
        if (filtered.length === 0) return;
        e.preventDefault();
        const first = filtered[0];
        const base = dir || (pathMode === "absolute" ? "/" : "");
        const suffix = first.isDir && appendSlashOnDir ? "/" : "";
        const next = base + first.name + suffix;
        onChange(next);
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) {
            el.focus();
            const len = el.value.length;
            el.setSelectionRange(len, len);
          }
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onSubmit();
      }
    };

    return (
      <input
        id={id}
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        className={
          className ??
          "w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
        }
      />
    );
  },
);
