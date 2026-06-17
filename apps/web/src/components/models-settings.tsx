import * as React from "react";
import { useMemo, useState } from "react";
import { useProviders } from "@/hooks/use-opencode";
import { useInstanceStore } from "@/stores/instance-store";
import {
  clearVisibility,
  getOverride,
  setVisibility,
  useModelVisibility,
} from "@/stores/model-visibility-store";
import {
  computeLatestSet,
  isModelVisible,
  modelKey as buildModelKey,
  type RawModel,
  type RawProvider,
} from "@/lib/model-visibility";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { toast } from "@/components/ui/toast";

// Mirrors opencode's Settings -> Models screen
// (packages/app/src/components/settings-models.tsx): one section per
// provider, each model row has a switch. Search filter spans provider
// name, model name, and model id. Default visibility follows opencode's
// "latest in family within 6 months" rule; user overrides win.

export function ModelsSettings() {
  const { data, isLoading } = useProviders();
  const { config, isLoading: visLoading } = useModelVisibility();
  const instance = useInstanceStore((s) => s.instance);
  const serverId = instance?.id ?? null;
  const [filter, setFilter] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const providers: RawProvider[] = useMemo(() => {
    const raw = data as { providers?: RawProvider[] } | undefined;
    return raw?.providers ?? [];
  }, [data]);

  const latestSet = useMemo(
    () => computeLatestSet(providers),
    [providers],
  );

  const sections = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return providers
      .map((p) => {
        const models = Object.values(p.models ?? {})
          .filter((m) => {
            if (!needle) return true;
            return (
              p.name.toLowerCase().includes(needle) ||
              (m.name ?? m.id).toLowerCase().includes(needle) ||
              m.id.toLowerCase().includes(needle)
            );
          })
          .sort((a, b) =>
            (a.name ?? a.id).localeCompare(b.name ?? b.id),
          );
        return { id: p.id, name: p.name, models };
      })
      .filter((p) => p.models.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [providers, filter]);

  const overrideCount = useMemo(() => {
    if (!serverId) return 0;
    return Object.keys(config.byServer[serverId] ?? {}).length;
  }, [config, serverId]);

  const handleToggle = async (
    providerId: string,
    modelId: string,
    nextVisible: boolean,
    currentDefault: boolean,
  ) => {
    const key = buildModelKey(providerId, modelId);
    if (!serverId) return;
    try {
      // If toggling back to the default state, drop the override entirely
      // so future default changes (e.g. a new latest in the family) start
      // taking effect again. Same behaviour as opencode's models store.
      if (nextVisible === currentDefault) {
        await clearVisibility(serverId, key);
      } else {
        await setVisibility(
          serverId,
          key,
          nextVisible ? "show" : "hide",
        );
      }
    } catch {
      toast.error("Failed to update model visibility");
    }
  };

  const handleReset = async () => {
    if (!serverId) return;
    setResetBusy(true);
    try {
      const r = await fetch("/api/model-visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId, clearServer: true }),
      });
      if (!r.ok) throw new Error(String(r.status));
      // Trigger SWR revalidate so the cache catches up.
      const { mutate } = await import("swr");
      await mutate("/api/model-visibility");
      toast.success("Cleared all overrides for this server");
    } catch {
      toast.error("Failed to reset overrides");
    } finally {
      setResetBusy(false);
    }
  };

  if (!serverId) {
    return (
      <p className="text-xs italic text-muted-fg">
        Select a server first to configure model visibility.
      </p>
    );
  }

  if ((isLoading || visLoading) && providers.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Loader className="size-5" />
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <p className="text-xs italic text-muted-fg">
        This server has no providers configured.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search models..."
          className="max-w-sm"
          spellCheck={false}
          autoCorrect="off"
          autoComplete="off"
          autoCapitalize="off"
          aria-label="Search models"
        />
        {overrideCount > 0 && (
          <Button
            intent="secondary"
            size="sm"
            isDisabled={resetBusy}
            onPress={() => void handleReset()}
            data-test="portal-settings-models-reset"
          >
            {resetBusy
              ? <Loader className="size-4" />
              : `Reset ${overrideCount} override${overrideCount === 1 ? "" : "s"}`}
          </Button>
        )}
      </div>

      {sections.length === 0 ? (
        <p className="text-xs italic text-muted-fg">
          {filter
            ? `No models match "${filter}".`
            : "No models available."}
        </p>
      ) : (
        <div className="space-y-8">
          {sections.map((section) => (
            <ProviderSection
              key={section.id}
              providerId={section.id}
              providerName={section.name}
              models={section.models}
              config={config}
              serverId={serverId}
              latestSet={latestSet}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ProviderSectionProps {
  providerId: string;
  providerName: string;
  models: RawModel[];
  config: { byServer: Record<string, Record<string, "show" | "hide">> };
  serverId: string;
  latestSet: Set<string>;
  onToggle: (
    providerId: string,
    modelId: string,
    nextVisible: boolean,
    currentDefault: boolean,
  ) => Promise<void>;
}

function ProviderSection({
  providerId,
  providerName,
  models,
  config,
  serverId,
  latestSet,
  onToggle,
}: ProviderSectionProps) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{providerName}</h3>
      <div className="divide-y divide-border rounded-md border border-border">
        {models.map((m) => {
          const key = buildModelKey(providerId, m.id);
          const override = getOverride(config, serverId, key);
          const visible = isModelVisible(
            providerId,
            m.id,
            m.release_date,
            latestSet,
            override,
          );
          // Recompute the "would-be default if we cleared the override"
          // so the toggle handler can revert to a clean default state
          // (and drop the override row) when the user re-enables /
          // re-disables a model whose default flipped.
          const defaultVisible = isModelVisible(
            providerId,
            m.id,
            m.release_date,
            latestSet,
            undefined,
          );
          const isLatest = latestSet.has(key);
          return (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  {m.name ?? m.id}
                  {isLatest && (
                    <span className="ml-2 text-xs text-muted-fg">
                      (latest)
                    </span>
                  )}
                  {override && (
                    <span className="ml-2 text-xs italic text-muted-fg">
                      override
                    </span>
                  )}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-fg">
                  {m.id}
                </div>
              </div>
              <Checkbox
                isSelected={visible}
                onChange={(v) =>
                  void onToggle(providerId, m.id, v, defaultVisible)
                }
                className="shrink-0"
                aria-label={`Toggle visibility of ${m.name ?? m.id}`}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
