import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useInstances, useSelfInstance } from "@/hooks/use-opencode";
import IconBox from "@/components/icons/box-icon";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { PageTitle } from "@/components/ui/typography";
import { toast } from "@/components/ui/toast";
import { TrashIcon } from "@heroicons/react/24/outline";
import { ServerIcon } from "@heroicons/react/24/solid";

export const Route = createFileRoute("/instances")(
  /*#__PURE__*/ {
    component: InstancesPage,
  },
);

interface InstanceData {
  id: string;
  name: string;
  directory: string;
  port: number;
  webPort: number | null;
  hostname: string;
  opencodePid: number | null;
  webPid: number | null;
  startedAt: string;
  state: "running";
  status: string;
}

function getDirectoryName(directory: string): string {
  const normalized = directory.replace(/\\+/g, "/").replace(/\/+$/g, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || directory;
}

function buildWebUrl(instance: InstanceData): string | null {
  if (!instance.webPort) return null;
  const host =
    instance.hostname === "0.0.0.0" ? window.location.hostname : instance.hostname;
  return `${window.location.protocol}//${host}:${instance.webPort}/`;
}

function InstancesPage() {
  const { data, error, mutate } = useInstances();
  const { data: selfData } = useSelfInstance();
  const selfId = selfData?.instance?.id ?? null;
  const [cleaning, setCleaning] = useState(false);
  const staleCount =
    (data as { staleCount?: number } | undefined)?.staleCount ?? 0;

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const res = await fetch("/api/instances/cleanup", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { removed: number; remaining: number };
      toast.success(
        j.removed > 0
          ? `Pruned ${j.removed} stale ${j.removed === 1 ? "entry" : "entries"} from ~/.portal.json`
          : "Registry already clean",
      );
      await mutate();
    } catch (err) {
      toast.error(
        err instanceof Error ? `Cleanup failed: ${err.message}` : "Cleanup failed",
      );
    } finally {
      setCleaning(false);
    }
  };

  const instances: InstanceData[] = data?.instances ?? [];

  return (
    <div className="container mx-auto max-w-4xl space-y-8 px-4 py-10">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <PageTitle>Other Portals</PageTitle>
          {staleCount > 0 && (
            <Button
              intent="secondary"
              size="sm"
              isDisabled={cleaning}
              onPress={handleCleanup}
            >
              <TrashIcon className="size-4" />
              {cleaning
                ? "Cleaning…"
                : `Clean up ${staleCount} stale ${staleCount === 1 ? "entry" : "entries"}`}
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-fg">
          Each Portal is bound to its own OpenCode. Click to open another in a
          new tab.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-danger-subtle p-3 text-danger-subtle-fg">
          {error instanceof Error ? error.message : "Failed to fetch instances"}
        </div>
      )}

      {data ? (
        instances.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-fg border border-dashed border-border/50 rounded-xl bg-muted/5">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted/50">
              <ServerIcon className="size-6 text-muted-fg/50" />
            </div>
            <p className="font-medium text-fg">No Portals found</p>
            <p className="text-sm">
              Run{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                openportal run
              </code>{" "}
              in your project directory.
            </p>
          </div>
        ) : (
          <div
            aria-label="OpenPortal instances"
            className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2"
          >
            {instances.map((instance) => {
              const dirName = getDirectoryName(instance.directory);
              const isRunning = instance.state === "running";
              const isSelf = instance.id === selfId;
              const url = buildWebUrl(instance);
              const cardClass =
                "group relative flex items-center gap-4 rounded-xl border border-border/50 bg-bg p-4 shadow-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
              const content = (
                <>
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-600 transition-colors group-hover:bg-orange-500/20">
                    <IconBox className="size-6" />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium tracking-tight truncate text-fg text-base">
                        {dirName}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {isSelf && (
                          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            this Portal
                          </span>
                        )}
                        <span className="rounded-md bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-fg border border-border/50">
                          :{instance.webPort ?? "?"}
                        </span>
                        {isRunning && !isSelf && (
                          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-500">
                            <span className="relative flex size-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full size-2 bg-emerald-500"></span>
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-fg truncate font-mono bg-muted/10 px-1.5 py-0.5 rounded w-fit max-w-full">
                      {instance.directory}
                    </span>
                  </div>
                </>
              );
              return !isRunning || isSelf || !url ? (
                <div
                  key={instance.id}
                  className={`${cardClass} cursor-default opacity-60`}
                >
                  {content}
                </div>
              ) : (
                <a
                  key={instance.id}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${cardClass} cursor-pointer hover:border-border hover:shadow-md hover:bg-muted/5`}
                >
                  {content}
                </a>
              );
            })}
          </div>
        )
      ) : (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-fg">
          <Loader className="size-5" />
          <span>Loading Portals…</span>
        </div>
      )}
    </div>
  );
}
