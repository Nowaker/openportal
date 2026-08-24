import { ArrowPathIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { logSystemMessage } from "@/stores/system-messages-store";

interface RestartDetection {
  ok: boolean;
  reason?: string;
  message?: string;
  recommended?: {
    unitName: string;
    scope: "user" | "system";
    activeState?: string;
  } | null;
  candidates?: {
    unitName: string;
    scope: "user" | "system";
    activeState?: string;
  }[];
  source?: string;
}

export function RestartOpencodeButton() {
  const [open, setOpen] = useState(false);
  const [detection, setDetection] = useState<RestartDetection | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const startDetect = async () => {
    setOpen(true);
    setResult(null);
    setDetection(null);
    try {
      const r = await fetch("/api/servers/restart-opencode", {
        method: "GET",
      });
      const data = (await r.json()) as RestartDetection;
      setDetection(data);
    } catch (err) {
      setDetection({
        ok: false,
        reason: "fetch-failed",
        message: err instanceof Error ? err.message : "detection failed",
      });
    }
  };

  const doRestart = async (unitName?: string) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/servers/restart-opencode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(unitName ? { unitName } : {}),
      });
      const data = (await r.json()) as {
        ok: boolean;
        unitName?: string;
        output?: string;
        message?: string;
      };
      if (data.ok) {
        const successMsg = `Restarted ${data.unitName}. Reconnecting...`;
        setResult(successMsg);
        logSystemMessage(
          "restart",
          "success",
          `Restarted ${data.unitName ?? "opencode"}`,
          data.output,
        );
        setTimeout(() => {
          setOpen(false);
          setResult(null);
        }, 2500);
      } else {
        const errMsg =
          data.message ??
          data.output ??
          "Restart failed - see OpenPortal logs for details.";
        setResult(errMsg);
        logSystemMessage(
          "restart",
          "error",
          `Restart failed: ${unitName ?? "opencode"}`,
          errMsg,
        );
      }
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : "Restart request failed.";
      setResult(errMsg);
      logSystemMessage(
        "restart",
        "error",
        `Restart request failed: ${unitName ?? "opencode"}`,
        errMsg,
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void startDetect()}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-fg hover:bg-muted"
        data-test="portal-restart-opencode"
        title="Detect and restart the OpenCode systemd unit"
      >
        <ArrowPathIcon className="size-3.5" />
        Restart
      </button>
    );
  }

  const recommended = detection?.recommended ?? null;
  const candidates = detection?.candidates ?? [];

  return (
    <div className="absolute top-12 right-3 z-50 w-[min(28rem,calc(100vw-1.5rem))] rounded-md border border-border bg-bg shadow-xl p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">Restart OpenCode</span>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="rounded p-0.5 text-muted-fg hover:bg-muted hover:text-fg"
          aria-label="Close"
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
      {detection === null && (
        <div className="flex items-center gap-2 text-muted-fg">
          <ArrowPathIcon className="size-3.5 animate-spin" />
          Detecting systemd unit...
        </div>
      )}
      {detection && !detection.ok && (
        <div className="text-danger-subtle-fg">
          {detection.message ?? "Detection failed."}
        </div>
      )}
      {detection?.ok && recommended && (
        <>
          <div className="text-fg">
            <span className="text-muted-fg">Recommended:</span>{" "}
            <code className="font-mono">{recommended.unitName}</code>{" "}
            <span className="text-muted-fg">
              ({recommended.scope}-scope
              {recommended.activeState ? `, ${recommended.activeState}` : ""})
            </span>
          </div>
          <button
            type="button"
            onClick={() => void doRestart(recommended.unitName)}
            disabled={busy}
            data-test="portal-restart-opencode-confirm"
            className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-fg hover:bg-warning/20 disabled:opacity-50"
          >
            <ArrowPathIcon
              className={`size-3.5 ${busy ? "animate-spin" : ""}`}
            />
            {busy
              ? "Restarting…"
              : `systemctl --user restart ${recommended.unitName}`}
          </button>
        </>
      )}
      {detection?.ok && !recommended && candidates.length > 0 && (
        <>
          <div className="text-muted-fg">
            Multiple opencode units found - pick one:
          </div>
          <ul className="space-y-1">
            {candidates.map((c) => (
              <li key={c.unitName} className="flex items-center gap-2">
                <code className="flex-1 font-mono">{c.unitName}</code>
                <button
                  type="button"
                  onClick={() => void doRestart(c.unitName)}
                  disabled={busy}
                  className="rounded border border-border bg-bg px-2 py-0.5 hover:bg-muted disabled:opacity-50"
                >
                  Restart
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {detection?.ok && candidates.length === 0 && (
        <div className="text-muted-fg">
          No opencode-* systemd units found. OpenCode was likely started by hand
          or under a different scope - restart it the way you started it.
        </div>
      )}
      {result && (
        <div className="rounded border border-border bg-muted/40 px-2 py-1 text-xs whitespace-pre-wrap break-words">
          {result}
        </div>
      )}
    </div>
  );
}
