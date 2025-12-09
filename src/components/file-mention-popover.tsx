"use client";

import { DocumentIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";

interface FileResult {
  path: string;
  name: string;
}

interface FileMentionPopoverProps {
  isOpen: boolean;
  searchQuery: string;
  onSelect: (filePath: string) => void;
  position: { top: number; left: number };
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onFilesChange?: (files: string[]) => void;
}

export function FileMentionPopover({
  isOpen,
  searchQuery,
  onSelect,
  position,
  selectedIndex,
  onSelectedIndexChange,
  onFilesChange,
}: FileMentionPopoverProps) {
  const [files, setFiles] = useState<FileResult[]>([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !searchQuery) {
      setFiles([]);
      onFilesChange?.([]);
      return;
    }

    const controller = new AbortController();
    const fetchFiles = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/files/search?q=${encodeURIComponent(searchQuery)}`,
          { signal: controller.signal },
        );
        if (response.ok) {
          const data = await response.json();
          const fileList = (data.data || data || []) as string[];
          const mappedFiles = fileList.slice(0, 10).map((path: string) => ({
            path,
            name: path.split("/").pop() || path,
          }));
          setFiles(mappedFiles);
          onFilesChange?.(mappedFiles.map((f) => f.path));
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("Failed to fetch files:", err);
        }
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchFiles, 150);
    return () => {
      clearTimeout(debounceTimer);
      controller.abort();
    };
  }, [isOpen, searchQuery]);

  useEffect(() => {
    if (listRef.current && files.length > 0) {
      const selectedElement = listRef.current.children[
        selectedIndex
      ] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex, files.length]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed z-50 min-w-64 max-w-md rounded-lg border border-border bg-overlay shadow-lg"
      style={{ top: position.top, left: position.left }}
    >
      <div className="p-2 text-xs text-muted-fg border-b border-border">
        {loading ? "Searching..." : `Files matching "${searchQuery}"`}
      </div>
      <div ref={listRef} className="max-h-60 overflow-y-auto p-1">
        {files.length === 0 && !loading && (
          <div className="px-3 py-2 text-sm text-muted-fg">No files found</div>
        )}
        {files.map((file, index) => (
          <button
            type="button"
            key={file.path}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
              index === selectedIndex
                ? "bg-primary text-primary-fg"
                : "hover:bg-muted"
            }`}
            onClick={() => onSelect(file.path)}
            onMouseEnter={() => onSelectedIndexChange(index)}
          >
            <DocumentIcon className="size-4 shrink-0" />
            <div className="flex flex-col overflow-hidden">
              <span className="font-medium truncate">{file.name}</span>
              <span
                className={`text-xs truncate ${
                  index === selectedIndex
                    ? "text-primary-fg/70"
                    : "text-muted-fg"
                }`}
              >
                {file.path}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

interface UseMentionResult {
  isOpen: boolean;
  searchQuery: string;
  position: { top: number; left: number };
  selectedIndex: number;
  mentionStart: number | null;
  handleInputChange: (
    value: string,
    cursorPosition: number,
    textareaElement: HTMLTextAreaElement,
  ) => void;
  handleKeyDown: (e: React.KeyboardEvent, filesCount: number) => boolean;
  handleSelect: (filePath: string, currentValue: string) => string;
  close: () => void;
  setSelectedIndex: (index: number) => void;
}

export function useFileMention(): UseMentionResult {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState<number | null>(null);

  const handleInputChange = (
    value: string,
    cursorPosition: number,
    textareaElement: HTMLTextAreaElement,
  ) => {
    // Find if we're in a mention context
    const textBeforeCursor = value.slice(0, cursorPosition);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    if (atIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1);
      // Check if there's a space before @ (or it's at the start)
      const charBeforeAt = atIndex > 0 ? textBeforeCursor[atIndex - 1] : " ";

      if (
        (charBeforeAt === " " || charBeforeAt === "\n" || atIndex === 0) &&
        !textAfterAt.includes(" ") &&
        !textAfterAt.includes("\n")
      ) {
        // We're in a valid mention context
        setSearchQuery(textAfterAt);
        setMentionStart(atIndex);
        setSelectedIndex(0);

        // Calculate position based on textarea
        const rect = textareaElement.getBoundingClientRect();
        setPosition({
          top: rect.top - 8, // Position above the textarea
          left: rect.left,
        });

        setIsOpen(true);
        return;
      }
    }

    // Not in a mention context
    close();
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    filesCount: number,
  ): boolean => {
    if (!isOpen) return false;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(filesCount, 1));
        return true;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev - 1 < 0 ? Math.max(filesCount - 1, 0) : prev - 1,
        );
        return true;
      case "Escape":
        e.preventDefault();
        close();
        return true;
      case "Tab":
      case "Enter":
        if (filesCount > 0) {
          e.preventDefault();
          return true; // Signal that a selection should be made
        }
        return false;
      default:
        return false;
    }
  };

  const handleSelect = (filePath: string, currentValue: string): string => {
    if (mentionStart === null) return currentValue;

    const beforeMention = currentValue.slice(0, mentionStart);
    const afterMention = currentValue.slice(
      mentionStart + 1 + searchQuery.length,
    );
    const newValue = `${beforeMention}@${filePath}${afterMention}`;

    close();
    return newValue;
  };

  const close = () => {
    setIsOpen(false);
    setSearchQuery("");
    setMentionStart(null);
    setSelectedIndex(0);
  };

  return {
    isOpen,
    searchQuery,
    position,
    selectedIndex,
    mentionStart,
    handleInputChange,
    handleKeyDown,
    handleSelect,
    close,
    setSelectedIndex,
  };
}
