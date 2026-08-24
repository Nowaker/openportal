import { useEffect, useMemo, useRef, useState } from "react";

import { CustomToolRow } from "@/components/custom-tool-row";
import { SystemToolRow } from "@/components/system-tool-row";
import type { ToolRowProps } from "@/components/tool-row-types";
import { useToolsStore, type ResolvedTool } from "@/stores/tools-store";

type StableRowOrder = {
  readonly rows: ResolvedTool[];
  readonly orderIds: string[];
  readonly setOrderIds: (ids: string[]) => void;
};

type UnifiedToolListProps = {
  readonly tools: ResolvedTool[];
};

// Row order MUST NOT derive from projectInitOrder: toggling Init mutates
// it, which made rows jump mid-click (AGENTS.md "List stability under
// inline toggles"). Order is frozen in state, reseeded only on add/remove.
function useStableRowOrder(
  list: ResolvedTool[],
  alpha: boolean,
): StableRowOrder {
  const byId = useMemo(
    () => new Map(list.map((t) => [t.id, t] as const)),
    [list],
  );
  const seedIds = useMemo(() => {
    const arr = alpha
      ? [...list].sort((a, b) => a.name.localeCompare(b.name))
      : list;
    return arr.map((t) => t.id);
  }, [list, alpha]);
  // Changes on add/remove only, not on flag toggle (same id set).
  const idsKey = useMemo(() => [...byId.keys()].sort().join(" "), [byId]);
  const [orderIds, setOrderIds] = useState<string[]>(seedIds);
  useEffect(() => {
    setOrderIds((prev) => {
      const present = new Set(byId.keys());
      const kept = prev.filter((id) => present.has(id));
      const keptSet = new Set(kept);
      const added = seedIds.filter((id) => !keptSet.has(id));
      const next = [...kept, ...added];
      const same =
        next.length === prev.length && next.every((id, i) => id === prev[i]);
      return same ? prev : next;
    });
    // Intentionally keyed on membership only - see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  const rows = useMemo(
    () =>
      orderIds
        .map((id) => byId.get(id))
        .filter((t): t is ResolvedTool => Boolean(t)),
    [orderIds, byId],
  );
  return { rows, orderIds, setOrderIds };
}

export function UnifiedToolList({ tools }: UnifiedToolListProps) {
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const reorderProjectInit = useToolsStore((s) => s.reorderProjectInit);

  const systemTools = useMemo(
    () => tools.filter((t) => t.kind === "system"),
    [tools],
  );
  const customTools = useMemo(
    () => tools.filter((t) => t.kind === "custom"),
    [tools],
  );

  const sortedSystem = useStableRowOrder(systemTools, true);
  const sortedCustom = useStableRowOrder(customTools, true);

  const dragSourceIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Drag is the only allowed reorder gesture: it moves the visual row and
  // rewrites projectInitOrder (the prompt concatenation order) to match.
  const handleDrop = (targetId: string) => {
    const sourceId = dragSourceIdRef.current;
    dragSourceIdRef.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const moveWithin = (ids: string[]): string[] | null => {
      const fromIdx = ids.indexOf(sourceId);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return null;
      const next = ids.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    };
    const nextSystem = moveWithin(sortedSystem.orderIds);
    if (nextSystem) sortedSystem.setOrderIds(nextSystem);
    const nextCustom = moveWithin(sortedCustom.orderIds);
    if (nextCustom) sortedCustom.setOrderIds(nextCustom);
    const initSet = new Set(projectInitOrder);
    const systemIds = nextSystem ?? sortedSystem.orderIds;
    const customIds = nextCustom ?? sortedCustom.orderIds;
    reorderProjectInit([
      ...systemIds.filter((id) => initSet.has(id)),
      ...customIds.filter((id) => initSet.has(id)),
    ]);
  };

  const renderRow = (tool: ResolvedTool) => {
    const isInit = projectInitOrder.includes(tool.id);
    const draggable = isInit && !tool.isDisabled;
    const props: ToolRowProps = {
      tool,
      draggable,
      isDragOver: dragOverId === tool.id,
      onDragStart: () => {
        if (draggable) dragSourceIdRef.current = tool.id;
      },
      onDragOver: (e) => {
        if (!dragSourceIdRef.current) return;
        if (!isInit) return;
        e.preventDefault();
        if (dragOverId !== tool.id) setDragOverId(tool.id);
      },
      onDragLeave: () => {
        if (dragOverId === tool.id) setDragOverId(null);
      },
      onDrop: () => handleDrop(tool.id),
      onDragEnd: () => {
        dragSourceIdRef.current = null;
        setDragOverId(null);
      },
    };
    return tool.kind === "system" ? (
      <SystemToolRow key={tool.id} {...props} />
    ) : (
      <CustomToolRow key={tool.id} {...props} />
    );
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">System templates</h3>
          <p className="text-xs text-muted-fg">
            Shipped by OpenPortal. Edit the prompt to customise - your edit
            survives future updates; hit Reset to restore the shipped version.
            Disable to hide everywhere.
          </p>
        </div>
        <div className="space-y-1.5">{sortedSystem.rows.map(renderRow)}</div>
      </section>
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Your templates - global</h3>
          <p className="text-xs text-muted-fg">
            Templates you create live in this browser&apos;s localStorage. Mark
            Init to drag-reorder; mark Slash to register a{" "}
            <code>/template &lt;name&gt;</code> autocomplete entry in composers.
          </p>
        </div>
        <div className="space-y-1.5">
          {sortedCustom.rows.length === 0 ? (
            <p className="text-xs italic text-muted-fg/70">
              No custom templates yet. Use the &quot;+ Add custom template&quot;
              button at the bottom.
            </p>
          ) : (
            sortedCustom.rows.map(renderRow)
          )}
        </div>
      </section>
    </div>
  );
}
