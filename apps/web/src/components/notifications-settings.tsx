import * as React from "react";
import {
  ALL_NOTIFY_KINDS,
  NOTIFY_KIND_LABELS,
  resetNotifyPolicy,
  setNotifyRule,
  useInstanceSettings,
  type NotificationKind,
} from "@/stores/instance-settings-store";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { toast } from "@/components/ui/toast";

export function NotificationsSettings() {
  const { settings, isLoading } = useInstanceSettings();
  const [busyKind, setBusyKind] = React.useState<NotificationKind | null>(null);
  const [resetting, setResetting] = React.useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-fg">
        <Loader className="size-4" />
        Loading notification policy...
      </div>
    );
  }

  const setRule = async (
    kind: NotificationKind,
    field: "notify" | "notifyEvenIfActiveTab",
    value: boolean,
  ) => {
    setBusyKind(kind);
    try {
      const current = settings.notifyPolicy[kind];
      const next = { ...current, [field]: value };
      await setNotifyRule(kind, next);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update notification rule",
      );
    } finally {
      setBusyKind(null);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetNotifyPolicy();
      toast.success("Notification policy reset to defaults.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to reset notifications",
      );
    } finally {
      setResetting(false);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Notification policy</h3>
        <p className="text-xs text-muted-fg pt-1">
          Per-kind browser notification config. The first column controls
          whether the browser fires a notification at all. The second column
          controls whether it fires even when this tab is the visible tab
          (some statuses are noisy when you're already looking at the
          session).
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-xs text-muted-fg">
              <th className="py-2 pr-3 font-normal">Notification kind</th>
              <th className="py-2 pr-3 font-normal">Notify</th>
              <th className="py-2 font-normal">Notify even if this tab is active</th>
            </tr>
          </thead>
          <tbody>
            {ALL_NOTIFY_KINDS.map((kind) => {
              const rule = settings.notifyPolicy[kind];
              return (
                <tr key={kind} className="border-t border-border">
                  <td className="py-2 pr-3 align-middle text-sm">
                    <div>{NOTIFY_KIND_LABELS[kind]}</div>
                    <div className="text-[11px] text-muted-fg font-mono">{kind}</div>
                  </td>
                  <td className="py-2 pr-3 align-middle">
                    <Checkbox
                      isSelected={rule.notify}
                      isDisabled={busyKind === kind}
                      onChange={(v) => {
                        void setRule(kind, "notify", v);
                      }}
                      aria-label={`Notify on ${kind}`}
                    >
                      <span className="sr-only">Notify on {kind}</span>
                    </Checkbox>
                  </td>
                  <td className="py-2 align-middle">
                    <Checkbox
                      isSelected={rule.notifyEvenIfActiveTab}
                      isDisabled={busyKind === kind || !rule.notify}
                      onChange={(v) => {
                        void setRule(kind, "notifyEvenIfActiveTab", v);
                      }}
                      aria-label={`Notify on ${kind} even if active tab`}
                    >
                      <span className="sr-only">
                        Notify on {kind} even if this tab is active
                      </span>
                    </Checkbox>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button
          size="sm"
          intent="outline"
          onPress={() => {
            void handleReset();
          }}
          isDisabled={resetting}
        >
          {resetting ? "Resetting..." : "Reset to defaults"}
        </Button>
        <span className="text-xs text-muted-fg">
          Defaults notify on everything; only Session-done and Stuck verdict skip
          the active-tab case.
        </span>
      </div>
    </section>
  );
}
