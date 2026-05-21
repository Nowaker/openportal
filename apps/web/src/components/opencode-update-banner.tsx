import { ArrowUpCircleIcon } from "@heroicons/react/24/outline";
import {
  useOpencodeVersion,
  acknowledgeOpencodeVersion,
} from "@/stores/opencode-version-store";
import { toast } from "@/components/ui/toast";

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
    <div
      className="flex flex-col gap-1 border-b-2 border-info bg-info px-3 py-2.5 text-sm font-medium text-info-fg shadow-sm"
      data-test="portal-opencode-update-banner"
    >
      <div className="flex items-center gap-2">
        <ArrowUpCircleIcon
          className="size-4 shrink-0 text-info-subtle-fg"
          aria-hidden="true"
        />
        <span className="flex-1 text-info-subtle-fg">
          OpenCode has been updated to{" "}
          <code className="rounded bg-bg/60 px-1 font-mono text-xs">
            v{info.installed}
          </code>{" "}
          (running:{" "}
          <code className="rounded bg-bg/60 px-1 font-mono text-xs">
            v{info.lastAcknowledgedVersion}
          </code>
          ). Restart OpenCode to apply.
        </span>
        <button
          type="button"
          onClick={() => void handleAcknowledge()}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-fg hover:bg-muted"
          data-test="portal-opencode-update-dismiss"
          title="Dismiss until next update"
        >
          Dismiss
        </button>
      </div>
      {src && (methodLabel || src.updateCommand) && (
        <div className="pl-6 text-xs text-info-subtle-fg/80">
          {methodLabel && <>Install method: {methodLabel}. </>}
          {src.updateCommand && (
            <>
              Update command:{" "}
              <code className="rounded bg-bg/60 px-1 font-mono">
                {src.updateCommand}
              </code>
            </>
          )}
        </div>
      )}
    </div>
  );
}
