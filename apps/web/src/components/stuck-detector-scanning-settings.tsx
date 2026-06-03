import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader } from "@/components/ui/loader";
import { toast } from "@/components/ui/toast";
import {
  setStuckDetectorScanning,
  useStuckDetectorScanning,
} from "@/stores/stuck-detector-scanning-store";

// Settings sub-section that lets the operator pause / resume the
// stuck-detector plugin's scanning (DB poll + SSE subscriber + LLM
// fetch monitor) without unloading the plugin. The plugin's HTTP
// listener stays up either way so portal can still flip the toggle
// back.
//
// When the plugin is unreachable (ECONNREFUSED, HTTP 4xx/5xx, missing
// /scanning endpoint on older builds), the whole section is rendered
// as a deactivated card with the underlying error - matches the
// StuckRecoverySettings "plugin not available" shape.

export function StuckDetectorScanningSettings() {
  const { data, isLoading } = useStuckDetectorScanning();
  const [busy, setBusy] = React.useState(false);

  const description = (
    <p className="text-xs text-muted-fg pt-1">
      Controls whether the stuck-detector plugin actively scans for
      wedged sessions. When off, the plugin stays loaded and answers
      HTTP requests but does not poll the DB, subscribe to opencode's
      event stream, or watch direct LLM fetches; OpenPortal falls
      back to its native indicators (busy / question / permission /
      compacting / opencode retry) sourced from opencode's own SSE
      stream. The setting is persisted by the plugin and survives
      opencode restarts.
    </p>
  );

  if (isLoading || !data) {
    return (
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Stuck detection scanning</h3>
          {description}
        </div>
        <div className="flex items-center gap-2 py-2 text-xs text-muted-fg">
          <Loader className="size-4" />
          Probing the stuck-detector plugin...
        </div>
      </section>
    );
  }

  if (!data.ok) {
    return (
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Stuck detection scanning</h3>
          {description}
        </div>
        <div className="rounded-md border border-warning/30 bg-warning-bg/30 px-3 py-2 text-xs text-warning-subtle-fg">
          <div className="font-medium">Stuck-detector plugin not reachable.</div>
          <div className="mt-1 text-muted-fg">
            {data.error ??
              "Run the Install action in the banner above, then restart opencode-serve."}
          </div>
        </div>
      </section>
    );
  }

  const enabled = data.enabled === true;

  const onToggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await setStuckDetectorScanning(next);
      if (!r.ok) {
        toast.error(r.error ?? "Plugin rejected the new scanning state.");
      } else {
        toast.success(
          next
            ? "Stuck detection scanning enabled."
            : "Stuck detection scanning disabled. Indicators sourced from opencode SSE only.",
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to toggle stuck-detector scanning",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">Stuck detection scanning</h3>
        {description}
      </div>
      <div
        className="flex items-center gap-2"
        data-test="portal-stuck-detector-scanning-row"
      >
        <Checkbox
          isSelected={enabled}
          isDisabled={busy}
          onChange={(next) => void onToggle(next)}
          data-test="portal-stuck-detector-scanning-toggle"
        >
          {enabled
            ? "Scanning enabled (plugin actively probes for wedged sessions)"
            : "Scanning disabled (portal-native indicators only)"}
        </Checkbox>
        {busy ? <Loader className="size-3.5" /> : null}
      </div>
    </section>
  );
}
