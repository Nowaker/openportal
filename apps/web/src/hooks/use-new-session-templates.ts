import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  resolveToolsFromState,
  useToolsStore,
  type ResolvedTool,
} from "@/stores/tools-store";
import { useFsTemplatesForDirectory } from "@/hooks/use-vibekick-templates";

// Picker item shape that fits both ResolvedTool (stock + custom from
// the local tools-store) and FsTemplate (filesystem-backed) without
// inheriting all their other fields. The picker only needs id (for
// the checkbox identity + drag drop), name/description (for display),
// and prompt (for the on-submit prepend). Anything else stays on the source.
export interface InitPickerItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly prompt: string;
}

export interface TemplateSlashEntry {
  readonly name: string;
  readonly body: string;
}

export interface SlashExtraItem {
  readonly name: string;
  readonly description?: string;
  readonly source: "builtin" | "template";
}

export interface NewSessionTemplatesController {
  readonly order: readonly InitPickerItem[];
  readonly selected: ReadonlySet<string>;
  readonly dragOverId: string | null;
  readonly expandedId: string | null;
  readonly edits: Readonly<Record<string, string>>;
  readonly dragSourceIdRef: MutableRefObject<string | null>;
  readonly templateSlashEntries: readonly TemplateSlashEntry[];
  readonly slashExtras: readonly SlashExtraItem[];
  readonly toggle: (id: string) => void;
  readonly handleDrop: (targetId: string) => void;
  readonly setDragOverId: (id: string | null) => void;
  readonly setExpandedId: Dispatch<SetStateAction<string | null>>;
  readonly setEdits: Dispatch<SetStateAction<Record<string, string>>>;
}

export function useNewSessionTemplates(
  directory: string | null,
): NewSessionTemplatesController {
  const disabledIds = useToolsStore((s) => s.disabledIds);
  const burgerHiddenIds = useToolsStore((s) => s.burgerHiddenIds);
  const systemOverrides = useToolsStore((s) => s.systemOverrides);
  const customTools = useToolsStore((s) => s.customTools);
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const defaultOnInitIds = useToolsStore((s) => s.defaultOnInitIds);
  const slashCommandIds = useToolsStore((s) => s.slashCommandIds);

  const tools = useMemo(
    () =>
      resolveToolsFromState({
        disabledIds,
        burgerHiddenIds,
        systemOverrides,
        customTools,
        projectInitOrder,
        defaultOnInitIds,
        slashCommandIds,
      }),
    [
      disabledIds,
      burgerHiddenIds,
      systemOverrides,
      customTools,
      projectInitOrder,
      defaultOnInitIds,
      slashCommandIds,
    ],
  );

  // FS templates load early so the `initialOrder` memo below can read
  // them without a TDZ violation. The directory-scoped vibekick hook
  // is dormant until `directory` resolves (URL or store), at which
  // point it fetches the upward-walk effective stack from the API.
  //
  // The empty-array fallback MUST go through useMemo - returning a
  // fresh `[]` on every render would invalidate every downstream
  // useMemo that lists fsTemplates in its deps, which re-runs the
  // useState initializers below, which trips React error #185
  // (max update depth). Same trap the tools-store / resolveTools
  // wrapper has a comment about.
  const { data: fsTemplatesResp } = useFsTemplatesForDirectory(directory);
  const fsTemplates = useMemo(
    () => fsTemplatesResp?.templates ?? [],
    [fsTemplatesResp],
  );

  // Init-only filter (Round 4). Picker shows init-flagged templates
  // ONLY; non-init templates live in the topbar burger menu + slash
  // autocomplete, not here. REVERSES AI_TODO #126/#127 which had
  // walked this back to "show all non-disabled" - do not re-flip.
  // See ai-analysis-requests/TEMPLATES_REDESIGN.md § Round 4.
  const initialOrder = useMemo<InitPickerItem[]>(() => {
    const local = tools.filter((t) => !t.isDisabled);
    const localInit: InitPickerItem[] = projectInitOrder
      .map((id) => local.find((t) => t.id === id))
      .filter((t): t is ResolvedTool => Boolean(t))
      .map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        prompt: t.prompt,
      }));
    const fsInit: InitPickerItem[] = fsTemplates
      .filter((template) => template.init)
      .map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        prompt: template.prompt,
      }));
    return [...localInit, ...fsInit];
  }, [tools, projectInitOrder, fsTemplates]);

  const defaultSelectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of defaultOnInitIds) {
      if (projectInitOrder.includes(id)) ids.add(id);
    }
    for (const t of fsTemplates) {
      if (t.init && t.defaultOn) ids.add(t.id);
    }
    return ids;
  }, [defaultOnInitIds, projectInitOrder, fsTemplates]);

  const [order, setOrder] = useState<InitPickerItem[]>(initialOrder);
  const [selected, setSelected] = useState<Set<string>>(
    () => defaultSelectedIds,
  );
  const selectionTouchedRef = useRef(false);
  const dragSourceIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    setOrder(initialOrder);
    if (!selectionTouchedRef.current) {
      setSelected(defaultSelectedIds);
    }
  }, [initialOrder, defaultSelectedIds]);

  const toggle = useCallback((id: string) => {
    selectionTouchedRef.current = true;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDrop = useCallback((targetId: string) => {
    const sourceId = dragSourceIdRef.current;
    dragSourceIdRef.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    setOrder((prev) => {
      const next = prev.slice();
      const from = next.findIndex((t) => t.id === sourceId);
      const to = next.findIndex((t) => t.id === targetId);
      if (from === -1 || to === -1) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  // Template-slash entries injected alongside opencode commands. Each
  // carries its body so the onSelect handler can expand the matching
  // /template <name> token into the template body with \n\n padding,
  // per the slash-checkbox spec. The entry's `name` field is shaped
  // "template <full-name>" so the popover renders it as
  // "/template Full name here" verbatim from the user's spec.
  // Stock + custom tools come from the local tools-store; filesystem
  // templates come from the directory-scoped vibekick-templates API
  // and carry their slash flag in YAML frontmatter.
  const templateSlashEntries = useMemo<TemplateSlashEntry[]>(() => {
    // Slash filter: !isDisabled (the master kill switch), NOT enabled.
    // A template with Burger unchecked but Slash checked MUST appear in
    // the popover - Burger only controls topbar visibility.
    // For FS templates we don't have a master-disable state (delete the
    // file instead), so they pass through if their YAML slash flag is on.
    const local = tools
      .filter((t) => !t.isDisabled && t.isSlash)
      .map((t) => ({
        name: `template ${t.name}`,
        body: t.prompt,
      }));
    const fs = fsTemplates
      .filter((t) => t.slash)
      .map((t) => ({
        name: `template ${t.name}`,
        body: t.prompt,
      }));
    return [...local, ...fs];
  }, [tools, fsTemplates]);

  // Synthetic /btw + every slash-marked template. Parity with the
  // chat composer ($id.tsx) so /btw and templates work BEFORE the
  // session exists too. Passed to the popover as extraItems.
  const slashExtras = useMemo<SlashExtraItem[]>(() => {
    return [
      {
        name: "btw",
        description:
          "Side question - one short answer, no tools. Claude-Code parity.",
        source: "builtin" as const,
      },
      ...templateSlashEntries.map((t) => ({
        name: t.name,
        source: "template" as const,
      })),
    ];
  }, [templateSlashEntries]);

  return {
    order,
    selected,
    dragOverId,
    expandedId,
    edits,
    dragSourceIdRef,
    templateSlashEntries,
    slashExtras,
    toggle,
    handleDrop,
    setDragOverId,
    setExpandedId,
    setEdits,
  };
}
