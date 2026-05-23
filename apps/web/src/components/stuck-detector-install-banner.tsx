import * as React from "react";
import useSWR from "swr";
import { ExclamationTriangleIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { CompactBanner } from "@/components/ui/compact-banner";
import { toast } from "@/components/ui/toast";

interface StatusResponse {
  connected: boolean;
  status?: number;
  error?: string;
}

interface InstallResponse {
  ok: boolean;
  alreadyInstalled?: boolean;
  configPath?: string;
  pluginPath?: string;
  restartCommand?: string;
  message?: string;
  error?: string;
}

const STATUS_KEY = "/api/stuck-detector/status";
const REFRESH_INTERVAL_MS = 60_000;

async function statusFetcher(url: string): Promise<StatusResponse> {
  const r = await fetch(url);
  if (!r.ok) return { connected: false, status: r.status };
  return (await r.json()) as StatusResponse;
}

export function StuckDetectorInstallBanner() {
  const { data, mutate } = useSWR<StatusResponse>(STATUS_KEY, statusFetcher, {
    refreshInterval: REFRESH_INTERVAL_MS,
    revalidateOnFocus: true,
    dedupingInterval: 5_000,
  });
  const [installing, setInstalling] = React.useState(false);
  const [installResult, setInstallResult] = React.useState<InstallResponse | null>(
    null,
  );
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if (data?.connected) {
      setInstallResult(null);
      setDismissed(false);
    }
  }, [data?.connected]);

  if (dismissed) return null;
  if (!data) return null;
  if (data.connected && !installResult) return null;

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const r = await fetch("/api/stuck-detector/install", { method: "POST" });
      const body = (await r.json()) as InstallResponse;
      if (!r.ok || !body.ok) {
        toast.error(body.error ?? `Install failed (HTTP ${r.status})`);
        return;
      }
      setInstallResult(body);
      void mutate();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Network error during install",
      );
    } finally {
      setInstalling(false);
    }
  };

  const handleCopy = async () => {
    if (!installResult?.restartCommand) return;
    try {
      await navigator.clipboard.writeText(installResult.restartCommand);
      toast.success("Restart command copied.");
    } catch {
      toast.error("Clipboard unavailable. Copy the command manually.");
    }
  };

  if (installResult) {
    return (
      <CompactBanner
        intent="info"
        icon={<CheckCircleIcon className="size-3.5" aria-hidden />}
        message={
          <>
            {installResult.alreadyInstalled
              ? "Plugin already in opencode.json - restart opencode-serve to load it."
              : "Plugin added to opencode.json - restart opencode-serve to load it."}
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-1.5 py-0.5 text-xs font-medium text-fg hover:bg-muted"
              data-test="portal-stuck-detector-copy-restart"
              title="Copy the restart command to clipboard"
            >
              Copy command
            </button>
            <button
              type="button"
              onClick={() => setInstallResult(null)}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-1.5 py-0.5 text-xs font-medium text-muted-fg hover:bg-muted"
              title="Hide this banner"
            >
              Dismiss
            </button>
          </>
        }
        details={
          <div className="space-y-1">
            <div className="text-xs text-muted-fg">
              OpenPortal does not auto-restart opencode-serve (interrupts every
              in-flight tool call on that server). Run this in a terminal:
            </div>
            <pre className="overflow-x-auto rounded border border-border bg-bg/60 px-2 py-1 text-xs font-mono">
              {installResult.restartCommand}
            </pre>
            <div className="text-xs text-muted-fg">
              Config:{" "}
              <code className="rounded bg-bg/60 px-1 font-mono">
                {installResult.configPath}
              </code>
            </div>
            <div className="text-xs text-muted-fg">
              This banner will dismiss itself once openportal detects the
              plugin on 127.0.0.1:4098.
            </div>
          </div>
        }
        dataTest="portal-stuck-detector-installed-banner"
      />
    );
  }

  return (
    <CompactBanner
      intent="warning"
      icon={<ExclamationTriangleIcon className="size-3.5" aria-hidden />}
      message={
        <>Stuck detector not loaded - falling back to portal heuristic.</>
      }
      actions={
        <>
          <button
            type="button"
            onClick={() => void handleInstall()}
            disabled={installing}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-1.5 py-0.5 text-xs font-medium text-fg hover:bg-muted disabled:opacity-50"
            data-test="portal-stuck-detector-install"
            title="Add the plugin path to opencode.json"
          >
            {installing ? "Installing..." : "Install"}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-1.5 py-0.5 text-xs font-medium text-muted-fg hover:bg-muted"
            title="Hide until openportal restart"
          >
            Dismiss
          </button>
        </>
      }
      details={
        <div className="space-y-0.5">
          <div>
            The stuck-detector plugin (loopback HTTP server at
            127.0.0.1:4098) gives the chat banner more reliable verdicts
            about wedged sessions than the portal-side heuristic. It also
            exposes per-cause recovery actions (Bump retry, Restart runner,
            etc.) used by the in-chat Stuck banner.
          </div>
          <div>
            Last probe:{" "}
            {data.error
              ? data.error === "ECONNREFUSED"
                ? "ECONNREFUSED (opencode-serve has not loaded the plugin)"
                : data.error
              : `HTTP ${data.status ?? "unknown"}`}
          </div>
        </div>
      }
      dataTest="portal-stuck-detector-install-banner"
    />
  );
}
