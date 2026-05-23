import * as React from "react";
import {
  ACTIONS_BY_CAUSE,
  ACTION_LABELS,
  ALL_STUCK_CAUSES,
  CAUSE_LABELS,
  updateStuckDetectorConfig,
  useStuckDetectorConfig,
  type CauseAction,
  type StuckCause,
  type StuckDetectorConfig,
} from "@/stores/stuck-recovery-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Loader } from "@/components/ui/loader";
import { toast } from "@/components/ui/toast";

export function StuckRecoverySettings() {
  const { data, isLoading } = useStuckDetectorConfig();
  const [busyCause, setBusyCause] = React.useState<StuckCause | null>(null);

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-fg">
        <Loader className="size-4" />
        Loading stuck-detector config...
      </div>
    );
  }

  if (!data.ok || !data.config) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning-bg/30 px-3 py-2 text-xs text-warning-subtle-fg">
        <div className="font-medium">Stuck-detector plugin not available.</div>
        <div className="mt-1 text-muted-fg">
          {data.error ??
            "Run the Install action in the banner above, then restart opencode-serve."}
        </div>
      </div>
    );
  }

  const config = data.config;

  const setAction = async (cause: StuckCause, action: CauseAction) => {
    setBusyCause(cause);
    try {
      const current = config.stuck_actions[cause] ?? {
        action: "log",
        min_idle_seconds: 30,
        cooloff_seconds: 60,
      };
      const next: StuckDetectorConfig = {
        ...config,
        stuck_actions: {
          ...config.stuck_actions,
          [cause]: { ...current, action },
        },
      };
      const r = await updateStuckDetectorConfig(next);
      if (!r.ok) {
        toast.error(r.error ?? "Plugin rejected the new config.");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update stuck-detector config",
      );
    } finally {
      setBusyCause(null);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Stuck recovery actions</h3>
        <p className="text-xs text-muted-fg pt-1">
          Per-cause action the plugin runs when it detects a wedged session.
          Settings persist in
          <code className="mx-1 rounded bg-muted px-1 font-mono text-[10px]">
            ~/.config/opencode/nowaker-opencode-plugins/opencode-stuck-detector.json
          </code>
          ; the plugin owns the file and watches it for live reloads.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-xs text-muted-fg">
              <th className="py-2 pr-3 font-normal">Cause</th>
              <th className="py-2 pr-3 font-normal">Action</th>
              <th className="py-2 font-normal">Timings (idle / cooloff)</th>
            </tr>
          </thead>
          <tbody>
            {ALL_STUCK_CAUSES.map((cause) => {
              const rule = config.stuck_actions[cause];
              const action = rule?.action ?? "log";
              const allowed = ACTIONS_BY_CAUSE[cause];
              return (
                <tr key={cause} className="border-t border-border">
                  <td className="py-2 pr-3 align-middle text-sm">
                    <div>{CAUSE_LABELS[cause]}</div>
                    <div className="text-[11px] text-muted-fg font-mono">
                      {cause}
                    </div>
                  </td>
                  <td className="py-2 pr-3 align-middle">
                    <Select
                      aria-label={`Action for ${cause}`}
                      selectedKey={action}
                      onSelectionChange={(key) => {
                        if (!key) return;
                        void setAction(cause, String(key) as CauseAction);
                      }}
                      isDisabled={busyCause === cause}
                    >
                      <SelectTrigger className="max-w-[16rem]" />
                      <SelectContent>
                        {allowed.map((a) => (
                          <SelectItem key={a} id={a} textValue={ACTION_LABELS[a]}>
                            {ACTION_LABELS[a]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-2 align-middle text-xs text-muted-fg">
                    {rule
                      ? `${rule.min_idle_seconds ?? "-"}s idle / ${rule.cooloff_seconds ?? "-"}s cooloff`
                      : "defaults"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-fg">
        Idle and cooloff timings are read-only here for now. Edit them directly
        in the plugin config file if needed; the plugin reloads on save.
      </p>
    </section>
  );
}
