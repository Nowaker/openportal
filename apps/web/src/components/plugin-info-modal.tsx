import { useState } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import {
  ArrowPathIcon,
  ChevronRightIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  refreshPluginInfoServerSide,
  usePluginInfo,
  type PluginInfo,
} from "@/hooks/use-plugin-info";
import { useInstanceStore } from "@/stores/instance-store";
import { MODAL_OVERLAY_CLASSES } from "@/lib/ui-classes";

interface Props {
  isOpen: boolean;
  spec: string | null;
  onOpenChange: (open: boolean) => void;
}

export function PluginInfoModal({ isOpen, spec, onOpenChange }: Props) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className={MODAL_OVERLAY_CLASSES}
    >
      <Modal className="w-full max-w-xl sm:w-[50vw] sm:min-w-[36rem] sm:max-w-[80rem] max-h-[85dvh] flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col flex-1 min-h-0 outline-none">
          {({ close }) =>
            spec ? <Body spec={spec} onClose={close} /> : null
          }
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

function pluginKindStyle(kind: PluginInfo["pluginKind"]): {
  label: string;
  className: string;
} {
  switch (kind) {
    case "server":
      return {
        label: "server",
        className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
      };
    case "tui":
      return {
        label: "tui",
        className: "bg-sky-500/15 text-sky-300 border-sky-500/30",
      };
    case "theme-only":
      return {
        label: "theme",
        className: "bg-violet-500/15 text-violet-300 border-violet-500/30",
      };
    default:
      return {
        label: "unknown",
        className: "bg-muted-fg/15 text-muted-fg border-muted-fg/30",
      };
  }
}

function sourceStyle(source: PluginInfo["source"]): string {
  return source === "npm"
    ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
    : "bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
}

function Body({ spec, onClose }: { spec: string; onClose: () => void }) {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const { data, error, mutate } = usePluginInfo(spec);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [readmeOpen, setReadmeOpen] = useState(true);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const info = data?.info;
  const refreshing = data?.refreshing ?? false;
  const isLoading = !data || (data.info === null && refreshing);

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    try {
      await refreshPluginInfoServerSide(port, spec);
      await mutate();
    } finally {
      setManualRefreshing(false);
    }
  };

  const headingName = info?.name ?? spec;
  const versionDisplay = info?.version ?? info?.requestedVersion;
  const kind = pluginKindStyle(info?.pluginKind ?? "unknown");

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="shrink-0 flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="flex-1 min-w-0 truncate text-sm font-semibold flex items-center gap-2">
          <span className="truncate">{headingName}</span>
          {versionDisplay && (
            <span className="shrink-0 text-xs font-normal text-muted-fg">
              v{versionDisplay}
            </span>
          )}
          {info && (
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${sourceStyle(
                info.source,
              )}`}
            >
              {info.source}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => void handleManualRefresh()}
          disabled={manualRefreshing}
          aria-label="Refresh plugin info"
          title="Re-read plugin metadata from disk"
          className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg disabled:opacity-40"
        >
          <ArrowPathIcon
            className={`size-4 ${manualRefreshing ? "animate-spin" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
        >
          <XMarkIcon className="size-4" />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
        <div className="text-[11px] font-mono text-muted-fg break-all">
          {spec}
        </div>

        {isLoading && <Skeleton />}

        {!isLoading && error && (
          <p className="text-sm text-danger">
            Failed to fetch:{" "}
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}

        {!isLoading && info && (
          <>
            {info.description && (
              <p className="text-sm text-fg/90 whitespace-pre-wrap">
                {info.description}
              </p>
            )}

            <PillRow info={info} kind={kind} />


            <div className="border-t border-border pt-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-fg mb-2">
                Exported functions
                {info.exportedFunctions.length > 0 && (
                  <span className="ml-1.5 normal-case font-normal text-muted-fg/70">
                    ({info.exportedFunctions.length})
                  </span>
                )}
              </h3>
              {info.exportedFunctions.length === 0 ? (
                <p className="text-xs text-muted-fg">
                  No named exports detected.
                </p>
              ) : (
                <ul className="font-mono text-xs space-y-0.5">
                  {info.exportedFunctions.map((fn) => (
                    <li key={fn}>{fn}</li>
                  ))}
                </ul>
              )}
            </div>

            {info.readme && (
              <div className="border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setReadmeOpen((v) => !v)}
                  className="flex w-full items-center gap-1 text-xs font-bold uppercase tracking-widest text-muted-fg hover:text-fg"
                >
                  <ChevronRightIcon
                    className={`size-3 transition-transform ${readmeOpen ? "rotate-90" : ""}`}
                  />
                  README
                </button>
                {readmeOpen && (
                  <div className="mt-2 max-h-[50vh] overflow-y-auto rounded border border-border/50 bg-muted/10 p-3 prose prose-sm dark:prose-invert max-w-none [&_pre]:overflow-x-auto [&_pre]:bg-bg/60 [&_code]:text-[12px]">
                    <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                      {info.readme}
                    </Markdown>
                  </div>
                )}
              </div>
            )}

            {info.diagnostics.length > 0 && (
              <div className="border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setDiagnosticsOpen((v) => !v)}
                  className="flex w-full items-center gap-1 text-xs font-bold uppercase tracking-widest text-danger hover:opacity-80"
                >
                  <ChevronRightIcon
                    className={`size-3 transition-transform ${diagnosticsOpen ? "rotate-90" : ""}`}
                  />
                  Diagnostics ({info.diagnostics.length})
                </button>
                {diagnosticsOpen && (
                  <ul className="mt-2 space-y-1 text-xs text-danger">
                    {info.diagnostics.map((d, i) => (
                      <li key={i} className="break-words">
                        {d}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PillRow({
  info,
  kind,
}: {
  info: PluginInfo;
  kind: { label: string; className: string };
}) {
  const items: Array<{ label: string; value: React.ReactNode }> = [];
  items.push({
    label: "Kind",
    value: (
      <span
        className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${kind.className}`}
      >
        {kind.label}
      </span>
    ),
  });
  if (info.author) items.push({ label: "Author", value: info.author });
  if (info.license) items.push({ label: "License", value: info.license });
  if (info.homepage) {
    items.push({
      label: "Homepage",
      value: (
        <a
          href={info.homepage}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-fg break-all"
        >
          {info.homepage}
        </a>
      ),
    });
  }
  if (info.repositoryUrl) {
    items.push({
      label: "Repository",
      value: (
        <a
          href={info.repositoryUrl}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-fg break-all"
        >
          {info.repositoryUrl}
        </a>
      ),
    });
  }
  if (info.id) {
    items.push({
      label: "Plugin id",
      value: <span className="font-mono">{info.id}</span>,
    });
  }
  if (info.entryPoint) {
    items.push({
      label: "Entry",
      value: <span className="font-mono break-all">{info.entryPoint}</span>,
    });
  }
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="text-muted-fg">{it.label}</dt>
          <dd className="min-w-0">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 rounded bg-muted/40 w-2/3" />
      <div className="h-3 rounded bg-muted/40 w-full" />
      <div className="h-3 rounded bg-muted/40 w-5/6" />
      <div className="h-3 rounded bg-muted/40 w-1/2 mt-4" />
      <div className="h-3 rounded bg-muted/40 w-2/3" />
    </div>
  );
}
