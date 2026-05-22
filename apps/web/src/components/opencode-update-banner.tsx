import { ArrowUpCircleIcon } from "@heroicons/react/24/outline";
import {
  useOpencodeVersion,
  acknowledgeOpencodeVersion,
} from "@/stores/opencode-version-store";
import { toast } from "@/components/ui/toast";
import { CompactBanner } from "@/components/ui/compact-banner";

export function OpencodeUpdateBanner() {
  const { info } = useOpencodeVersion();
  if (!info.updated) return null;
  if (!info.installed || !info.lastAcknowledgedVersion) return null;

  const handleAcknowledge = async () => {
    try {
      await acknowledgeOpencodeVersion();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Acknowledge failed.");
    }
  };

  const src = info.installSource;
  const methodLabel = src
    ? src.method === "pacman"
      ? `Arch (pacman) ${src.package ? `package "${src.package}"` : ""}`
      : src.method === "aur"
        ? `AUR ${src.package ? `package "${src.package}"` : ""}`
        : src.method === "homebrew"
          ? "Homebrew"
          : src.method === "npm-global"
            ? "npm global"
            : src.method === "bun-global"
              ? "bun global"
              : src.method === "direct"
                ? "Direct binary (~/.local/bin)"
                : "Unknown"
    : null;

  return (
    <CompactBanner
      intent="info"
      icon={<ArrowUpCircleIcon className="size-3.5" aria-hidden />}
      message={
        <>
          OpenCode v{info.installed} ready - restart to apply
        </>
      }
      actions={
        <button
          type="button"
          onClick={() => void handleAcknowledge()}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-1.5 py-0.5 text-xs font-medium text-fg hover:bg-muted"
          data-test="portal-opencode-update-dismiss"
          title="Dismiss until next update"
        >
          Dismiss
        </button>
      }
      details={
        <div className="space-y-0.5">
          <div>
            Running v{info.lastAcknowledgedVersion} -&gt; installed
            v{info.installed}
          </div>
          {methodLabel && <div>Install method: {methodLabel}</div>}
          {src?.updateCommand && (
            <div>
              Update command:{" "}
              <code className="rounded bg-bg/60 px-1 font-mono">
                {src.updateCommand}
              </code>
            </div>
          )}
        </div>
      }
      dataTest="portal-opencode-update-banner"
    />
  );
}
