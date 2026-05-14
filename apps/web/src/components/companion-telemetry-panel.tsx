import { useState } from "react";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import useSWR from "swr";
import { useInstanceStore } from "@/stores/instance-store";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { MODAL_OVERLAY_CLASSES } from "@/lib/ui-classes";

interface DetectedOpencode {
  pid: number;
  hostname: string | null;
  port: number | null;
  systemdUnit: string | null;
  scope: "user" | "system" | "unknown";
  cmdline: string;
}

interface DetectedInstancesResponse {
  instances: DetectedOpencode[];
}

interface SudoPromptState {
  unit: string;
  port: number;
}

function SudoPasswordModal({
  state,
  onClose,
  onSuccess,
}: {
  state: SudoPromptState | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!state || !password) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/companion-plugin/restart-with-sudo?port=${state.port}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, unit: state.unit }),
        },
      );
      const j = (await res.json()) as { ok?: boolean; note?: string };
      setPassword("");
      if (j.ok) {
        toast.success(j.note ?? `Restarted ${state.unit}`);
        onSuccess();
        onClose();
      } else {
        toast.error(j.note ?? `Restart of ${state.unit} failed`);
      }
    } catch (err) {
      setPassword("");
      toast.error(
        err instanceof Error ? `Restart failed: ${err.message}` : "Restart failed",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalOverlay
      isOpen={state !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPassword("");
          onClose();
        }
      }}
      isDismissable
      className={MODAL_OVERLAY_CLASSES}
    >
      <Modal className="w-full max-w-md rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col gap-3 p-5 outline-none">
          <h2 className="text-sm font-semibold">
            Sudo password for {state?.unit}
          </h2>
          <p className="text-xs text-muted-fg">
            {state?.unit} is a system-scope service. Enter your sudo password
            to restart it via <code>sudo systemctl restart {state?.unit}</code>.
            Password is piped to sudo over stdin and never logged or stored.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="sudo password"
              autoComplete="off"
              className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button
                intent="secondary"
                size="sm"
                onPress={() => {
                  setPassword("");
                  onClose();
                }}
                isDisabled={submitting}
              >
                Cancel
              </Button>
              <Button
                intent="primary"
                size="sm"
                type="submit"
                isDisabled={submitting || password.length === 0}
              >
                {submitting ? "Restarting…" : "Restart"}
              </Button>
            </div>
          </form>
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

interface CompanionPluginState {
  schemaVersion: number;
  identity: {
    id: string;
    version: string;
    loadedAt: number;
    options: Record<string, unknown>;
    hooks: Record<string, boolean>;
    initError: string | null;
  };
  context: { directory: string; worktree: string; serverUrl: string };
  heartbeat: { lastWriteAt: number; intervalMs: number };
  events: {
    totalSeen: number;
    byType: Record<string, number>;
    recent: Array<{ at: number; type: string }>;
  };
  tools: Record<
    string,
    {
      callCount: number;
      totalMs: number;
      lastFiredAt: number | null;
      p50Ms: number | null;
      p95Ms: number | null;
    }
  >;
  toolDefinitionsSeen: string[];
  sessions: Record<
    string,
    {
      sessionId: string;
      messageCount: number;
      toolCount: number;
      permissionAskCount: number;
      compactionCount: number;
      firstSeenAt: number;
      lastSeenAt: number;
    }
  >;
  permissions: {
    totalAsked: number;
    recent: Array<{
      at: number;
      sessionId: string;
      permission: string;
      patternCount: number;
    }>;
  };
  compactions: { total: number };
}

interface CompanionSummary {
  available: boolean;
  stale: boolean;
  state: CompanionPluginState | null;
  filePath: string;
}

const fetcher = async (url: string): Promise<CompanionSummary> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

function fmtAge(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = Date.now() - ms;
  if (d < 1000) return "just now";
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  return `${Math.floor(d / 3_600_000)}h ago`;
}

export function CompanionTelemetryPanel() {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const { data, isLoading, mutate } = useSWR<CompanionSummary>(
    port ? `/api/companion-plugin-state?port=${port}` : null,
    fetcher,
    { refreshInterval: 5000 },
  );
  const { data: detected } = useSWR<DetectedInstancesResponse>(
    "/api/companion-plugin/detect-instances",
    fetcher,
    { refreshInterval: 15_000 },
  );
  const [installing, setInstalling] = useState<"install" | "install+restart" | null>(null);
  const [sudoPrompt, setSudoPrompt] = useState<SudoPromptState | null>(null);

  const handleInstall = async (restart: boolean) => {
    setInstalling(restart ? "install+restart" : "install");
    try {
      const url = restart
        ? `/api/companion-plugin/install-and-restart?port=${port}`
        : "/api/companion-plugin/install";
      const r = await fetch(url, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const j = (await r.json()) as {
        changed?: boolean;
        alreadyInstalled?: boolean;
        configPath?: string;
        note?: string;
        restart?: { ok: boolean; output?: string };
        service?: {
          scope?: string;
          unitName?: string | null;
        };
      };
      if (
        restart &&
        port &&
        j.restart?.ok === false &&
        j.service?.scope === "system" &&
        j.service?.unitName
      ) {
        setSudoPrompt({ unit: j.service.unitName, port });
        return;
      }
      const ok = restart ? j.restart?.ok !== false : true;
      const message = j.note ?? (j.changed ? "Installed" : "Already installed");
      (ok ? toast.success : toast.error)(message);
      await mutate();
    } catch (err) {
      toast.error(
        err instanceof Error ? `Install failed: ${err.message}` : "Install failed",
      );
    } finally {
      setInstalling(null);
    }
  };

  if (isLoading && !data) return null;

  const otherInstances = (detected?.instances ?? []).filter(
    (i) => i.port !== port,
  );

  if (!data?.available) {
    return (
      <div className="border-t border-border pt-3 text-xs text-muted-fg space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-fg">
          Companion telemetry
        </h3>
        <p>
          Install the openportal companion plugin to see live runtime telemetry.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            intent="secondary"
            onPress={() => void handleInstall(false)}
            isDisabled={installing !== null}
          >
            {installing === "install" ? "Installing…" : "Install"}
          </Button>
          <Button
            size="sm"
            intent="primary"
            onPress={() => void handleInstall(true)}
            isDisabled={installing !== null || !port}
          >
            {installing === "install+restart"
              ? "Installing & restarting…"
              : "Install & restart"}
          </Button>
        </div>
        <p className="text-[11px]">
          "Install" just writes the file:// entry into{" "}
          <code>~/.opencode/opencode.json</code>. "Install &amp; restart"
          additionally detects which systemd unit serves the active opencode
          and restarts it via <code>systemctl --user</code>. System-scope
          services prompt for your sudo password (piped to{" "}
          <code>sudo -S</code> over stdin, never logged or stored).
        </p>
        {otherInstances.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-fg/70">
              Other opencode instances detected on this host
            </h4>
            <ul className="font-mono text-[11px] space-y-0.5">
              {otherInstances.map((inst) => (
                <li key={inst.pid} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {inst.hostname ?? "?"}:{inst.port ?? "?"}
                  </span>
                  <span className="text-muted-fg shrink-0">
                    pid {inst.pid}
                    {inst.systemdUnit && ` · ${inst.systemdUnit}`}
                    {inst.scope !== "user" && inst.scope !== "system" && " · ?"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-muted-fg/70">
              Bind openportal to any of these from /servers; the plugin entry
              applies to every opencode that loads <code>~/.opencode/opencode.json</code>,
              but each needs its own restart to pick it up.
            </p>
          </div>
        )}
        <SudoPasswordModal
          state={sudoPrompt}
          onClose={() => setSudoPrompt(null)}
          onSuccess={() => void mutate()}
        />
      </div>
    );
  }

  const s = data.state!;
  const topTools = Object.entries(s.tools)
    .sort((a, b) => b[1].callCount - a[1].callCount)
    .slice(0, 8);
  const topEvents = Object.entries(s.events.byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const sessionCount = Object.keys(s.sessions).length;

  return (
    <div className="border-t border-border pt-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-fg">
          Companion telemetry
          {data.stale && (
            <span className="ml-2 normal-case font-normal text-warning">
              (stale: last heartbeat {fmtAge(s.heartbeat.lastWriteAt)})
            </span>
          )}
        </h3>
        <span className="text-[10px] text-muted-fg/70 font-mono">
          v{s.identity.version}
        </span>
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-fg">Loaded</dt>
        <dd>{fmtAge(s.identity.loadedAt)}</dd>
        <dt className="text-muted-fg">Heartbeat</dt>
        <dd>{fmtAge(s.heartbeat.lastWriteAt)}</dd>
        <dt className="text-muted-fg">Events seen</dt>
        <dd className="tabular-nums">{s.events.totalSeen.toLocaleString()}</dd>
        <dt className="text-muted-fg">Sessions tracked</dt>
        <dd className="tabular-nums">{sessionCount}</dd>
        <dt className="text-muted-fg">Permissions asked</dt>
        <dd className="tabular-nums">
          {s.permissions.totalAsked.toLocaleString()}
        </dd>
        <dt className="text-muted-fg">Compactions</dt>
        <dd className="tabular-nums">{s.compactions.total.toLocaleString()}</dd>
        <dt className="text-muted-fg">Tools observed</dt>
        <dd className="tabular-nums">{s.toolDefinitionsSeen.length}</dd>
        {s.identity.initError && (
          <>
            <dt className="text-danger">Init error</dt>
            <dd className="text-danger break-words">{s.identity.initError}</dd>
          </>
        )}
      </dl>

      {topTools.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-muted-fg mb-1">
            Top tools by call count
          </h4>
          <ul className="font-mono text-[11px] space-y-0.5">
            {topTools.map(([name, t]) => (
              <li key={name} className="flex items-center justify-between gap-2">
                <span className="truncate">{name}</span>
                <span className="text-muted-fg tabular-nums shrink-0">
                  {t.callCount}× · p50 {t.p50Ms ?? "—"}ms · p95 {t.p95Ms ?? "—"}ms · last {fmtAge(t.lastFiredAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {topEvents.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-muted-fg mb-1">
            Top event types
          </h4>
          <ul className="font-mono text-[11px] space-y-0.5">
            {topEvents.map(([type, count]) => (
              <li key={type} className="flex items-center justify-between gap-2">
                <span className="truncate">{type}</span>
                <span className="text-muted-fg tabular-nums shrink-0">
                  {count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.toolDefinitionsSeen.length > 0 && (
        <details className="group rounded-md border border-border bg-muted/20">
          <summary className="cursor-pointer select-none px-2 py-1.5 text-[11px] font-semibold text-muted-fg flex items-center justify-between gap-2 hover:text-fg">
            <span>
              Tool definitions observed
              <span className="ml-1 tabular-nums">
                ({s.toolDefinitionsSeen.length})
              </span>
            </span>
            <span className="text-[10px] uppercase tracking-wide opacity-60 group-open:opacity-100">
              {"toggle"}
            </span>
          </summary>
          <ul className="px-2 pb-2 font-mono text-[11px] space-y-0.5 max-h-72 overflow-y-auto">
            {[...s.toolDefinitionsSeen]
              .sort((a, b) => a.localeCompare(b))
              .map((name) => {
                const stats = s.tools[name];
                const calls = stats?.callCount ?? 0;
                const errs = stats?.errorCount ?? 0;
                return (
                  <li
                    key={name}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{name}</span>
                    <span className="text-muted-fg tabular-nums shrink-0">
                      {calls}×
                      {errs > 0 && (
                        <span className="ml-1 text-danger">
                          ({errs} err)
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
          </ul>
        </details>
      )}
    </div>
  );
}
