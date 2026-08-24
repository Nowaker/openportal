import type { DragEvent } from "react";
import type { ResolvedTool } from "@/stores/tools-store";

export type ToolRowProps = {
  readonly tool: ResolvedTool;
  readonly draggable: boolean;
  readonly isDragOver: boolean;
  readonly onDragStart: () => void;
  readonly onDragOver: (event: DragEvent) => void;
  readonly onDragLeave: () => void;
  readonly onDrop: () => void;
  readonly onDragEnd: () => void;
};
