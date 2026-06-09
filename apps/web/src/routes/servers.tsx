import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { usePollMs } from "@/hooks/use-opencode";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  FolderOpenIcon,
  KeyIcon,
  PencilSquareIcon,
  PlusIcon,
  ServerStackIcon,
  SignalIcon,
  TrashIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { PageTitle } from "@/components/ui/typography";
import { formatFullDateTime } from "@/lib/format-time";
import { useDateFormatStore } from "@/stores/date-format-store";
import { useInstanceStore } from "@/stores/instance-store";

// /servers — Server List screen.
//
// Three concepts visible here:
//   - Configured servers (persisted in ~/.openportal/openportal.json).
//     Each shows a live status pill and an "Open" action that binds
//     the Portal UI to it and navigates to /.
//   - Discovered servers (running locally / on LAN that we haven't
//     adopted). Click "Add" to promote into a configured entry, or
//     "Add & open" to promote and immediately bind the UI to it.
//   - Active server: highlighted, the one the Portal UI is currently
//     bound to.
//
// Verb convention: "Open" is the single verb for "make this Portal
// talk to that server right now and show its UI". It's used on
// Configured cards directly and as the secondary action ("Add & open")
// on Discovered cards and inspect-host findings. "Reconnect" is kept
// distinct because it carries the retry-on-failure signal (paired
// with the refresh icon).
//
// Auth modal flow:
//   - When a server requires auth, the page shows a "Set credentials"
//     modal with a step-by-step status box that mirrors the server's
//     in-progress credential lookup (HTTP probe -> SSH probe ->
//     validation).
//   - Background lookups happen automatically when /api/servers lists
//     a non-loopback server with no known auth, so by the time the
//     user clicks Add the credentials may already be ready (modal
//     skipped entirely).
//
// This screen is intentionally outside the `_app` layout so it works
// when no server is bound (configless first-run, or after the user
// removed the active server).

type CredLookupState =
  | "idle"
  | "probing-http"
  | "needs-auth"
  | "probing-ssh"
  | "succeeded"
  | "failed";

interface CredLookupSummary {
  state: CredLookupState;
  step?: string;
  message?: string;
  authMode?: "none" | "discovered" | "manual" | "stored";
}

type ServerProtocol = "http" | "https";

interface ServerListEntry {
  id: string;
  label: string | null;
  displayLabel: string;
  protocol: ServerProtocol;
  host: string;
  port: number;
  webEndpoint?: string;
  liveHost?: string;
  livePort?: number;
  // Server-side DNS lookup result for `host` when it's a hostname.
  // Surfaced so a user looking at `opencode.local:34883` can also see
  // the underlying IP (e.g. 192.168.1.45) and tell which machine on
  // their network is being targeted.
  resolvedAddress?: string;
  ephemeral: boolean;
  configured: boolean;
  source: string;
  status: "active" | "online" | "offline" | "ephemeral-online" | "discovered";
  isActive: boolean;
  credLookup?: CredLookupSummary;
  pid?: number;
  cmdline?: string;
}

interface ServerListResponse {
  activeId: string | null;
  servers: ServerListEntry[];
}

interface ServerUpdatePayload {
  label: string | null;
  protocol: ServerProtocol;
  host: string;
  port: number;
  webEndpoint: string | null;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

function serverOrigin(protocol: ServerProtocol, host: string, port: number): string {
  try {
    const url = new URL(`${protocol}://openportal.invalid`);
    url.hostname = host.replace(/^\[|\]$/g, "");
    url.port = String(port);
    return url.origin;
  } catch {
    return `${protocol}://${host}:${port}`;
  }
}

function labelFor(entry: Pick<ServerListEntry, "displayLabel" | "label">): string {
  return entry.displayLabel || entry.label || "Unnamed server";
}

export const Route = createFileRoute("/servers")({
  component: ServersPage,
});

function StatusPill({ status }: { status: ServerListEntry["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircleIcon className="size-3.5" />
        active
      </span>
    );
  }
  if (status === "online") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <SignalIcon className="size-3.5" />
        online
      </span>
    );
  }
  if (status === "ephemeral-online") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <SignalIcon className="size-3.5" />
        online (relocated)
      </span>
    );
  }
  if (status === "discovered") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-400">
        <SignalIcon className="size-3.5" />
        discovered
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-fg">
      <XCircleIcon className="size-3.5" />
      offline
    </span>
  );
}

interface AuthModalTarget {
  // The host:port we're authenticating to; cred-lookup polls keyed by
  // this. For "promote then auth", we don't have a serverId yet — the
  // modal handles that by promoting first when the user submits.
  host: string;
  port: number;
  protocol: ServerProtocol;
  // Display label only.
  label: string;
  // The discoveredId, if this is a discovered server we'll need to
  // promote on submit. Mutually exclusive with serverId.
  discoveredId?: string;
  // The configured server's id, if it's already in the registry.
  serverId?: string;
  // Whether to also activate the server after successful auth (Add &
  // use vs Add).
  activateAfter: boolean;
}

function ServersPage() {
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authModal, setAuthModal] = useState<AuthModalTarget | null>(null);
  const [directoriesTarget, setDirectoriesTarget] = useState<
    { serverId: string; label: string } | null
  >(null);
  // Tracks an in-flight Rescan so the button can spin + disable.
  // Without this the button does nothing visible during the few hundred
  // ms it takes to re-probe everything and the user has no feedback.
  const [rescanning, setRescanning] = useState(false);
  // ID of the configured server pending removal-confirmation. null
  // closes the confirm dialog. The dialog itself renders at the
  // bottom of the page.
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const setInstance = useInstanceStore((s) => s.setInstance);
  const { mutate: globalMutate } = useSWRConfig();
  const serversPollMs = usePollMs(5000);
  const { data, error: loadError, isLoading, mutate } = useSWR<
    ServerListResponse
  >("/api/servers", fetcher, {
    refreshInterval: serversPollMs,
    revalidateOnFocus: true,
  });

  const adoptServer = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch("/api/servers/active", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error(`activate failed: ${res.status}`);
        const fresh = await mutate();
        const picked = fresh?.servers.find((s) => s.id === id);
        if (picked) {
          setInstance({
            id: picked.id,
            name: labelFor(picked),
            protocol: picked.protocol,
            port: picked.port,
            hostname: picked.host,
            webEndpoint: picked.webEndpoint,
          });
        }
        // _app.tsx's redirect-to-/servers effect fires when
        // /api/instance/self resolves to a null instance. SWR may
        // serve the cached null from the configless state for a
        // microtask after this navigate, so the home route bounces
        // straight back here and Open looks like a no-op. Force-
        // refresh /api/instance/self AND wait for it to land before
        // navigating so the home route sees the fresh active server
        // on first render.
        await globalMutate("/api/instance/self");
        void navigate({ to: "/", search: (prev) => prev });
      } catch (e) {
        setError(e instanceof Error ? e.message : "activate failed");
      } finally {
        setBusyId(null);
      }
    },
    [globalMutate, mutate, navigate, setInstance],
  );

  // Common path used by Configured.Use, Configured.Reconnect, and
  // Discovered.Add(&use). Decides whether to open the auth modal or
  // proceed directly.
  const tryActivate = useCallback(
    async (entry: ServerListEntry) => {
      // Reconnect path: server is already the active one but is
      // offline. Force-probe (clears the resolver cache, re-runs
      // ephemeral re-discovery), then re-adopt so the instance store
      // picks up any new port and the user gets navigated back to /.
      if (entry.isActive && entry.status === "offline") {
        setBusyId(entry.id);
        setError(null);
        try {
          await fetch(
            `/api/servers/${encodeURIComponent(entry.id)}/probe`,
            { method: "POST" },
          );
          await mutate();
        } catch (e) {
          setError(e instanceof Error ? e.message : "probe failed");
        } finally {
          setBusyId(null);
        }
        // After the probe, adoptServer re-reads the (possibly
        // re-resolved) port from /api/servers and writes the
        // instance store, which navigates to /.
        await adoptServer(entry.id);
        return;
      }
      // Loopback: never need auth modal — local discovery owns auth.
      const isLoopback =
        entry.host === "127.0.0.1" ||
        entry.host === "localhost" ||
        entry.host === "::1";
      if (entry.ephemeral || isLoopback) {
        await adoptServer(entry.id);
        return;
      }
      // Already-online configured server: just adopt.
      if (entry.status === "online" || entry.status === "ephemeral-online") {
        await adoptServer(entry.id);
        return;
      }
      // Otherwise: open the modal. The modal handles probing + manual
      // entry. On success it calls back into adoptServer.
      setAuthModal({
        host: entry.liveHost ?? entry.host,
        port: entry.livePort ?? entry.port,
        protocol: entry.protocol,
        label: labelFor(entry),
        serverId: entry.id,
        activateAfter: true,
      });
    },
    [adoptServer, mutate],
  );

  const promoteDiscovered = useCallback(
    async (
      entry: ServerListEntry,
      options?: { activateAfter?: boolean },
    ) => {
      const isLoopback =
        entry.host === "127.0.0.1" ||
        entry.host === "localhost" ||
        entry.host === "::1";
      // Local + ephemeral: no auth dance. Just promote, then adopt if
      // requested.
      if (entry.ephemeral || isLoopback) {
        setBusyId(entry.id);
        setError(null);
        try {
          const res = await fetch("/api/servers/promote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ discoveredId: entry.id }),
          });
          if (!res.ok) throw new Error(`promote failed: ${res.status}`);
          const { server } = (await res.json()) as { server: { id: string } };
          await mutate();
          if (options?.activateAfter) {
            await adoptServer(server.id);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "promote failed");
        } finally {
          setBusyId(null);
        }
        return;
      }
      // Remote: we may already have creds (background probe), in which
      // case promotion + adoption is silent. If creds aren't ready,
      // the modal handles them.
      if (entry.credLookup?.state === "succeeded") {
        // Background probe found creds and the promote endpoint will
        // attach them automatically.
        setBusyId(entry.id);
        try {
          const res = await fetch("/api/servers/promote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ discoveredId: entry.id }),
          });
          if (!res.ok) throw new Error(`promote failed: ${res.status}`);
          const { server } = (await res.json()) as { server: { id: string } };
          await mutate();
          if (options?.activateAfter) {
            await adoptServer(server.id);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "promote failed");
        } finally {
          setBusyId(null);
        }
        return;
      }
      // No creds yet — open modal. Promotion happens on modal submit.
      setAuthModal({
        host: entry.host,
        port: entry.port,
        protocol: entry.protocol,
        label: labelFor(entry),
        discoveredId: entry.id,
        activateAfter: Boolean(options?.activateAfter),
      });
    },
    [adoptServer, mutate],
  );

  // Removal goes through a two-step in-app confirm rather than
  // window.confirm. The dialog renders below; this opener just sets
  // the target so the dialog appears.
  const requestRemoveServer = (id: string) => {
    setRemoveTarget(id);
    setError(null);
  };

  // Body of the actual delete, invoked from the confirm dialog.
  const performRemoveServer = async () => {
    const id = removeTarget;
    if (!id) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/servers/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`remove failed: ${res.status}`);
      await mutate();
      setRemoveTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "remove failed");
    } finally {
      setBusyId(null);
    }
  };

  const probeServer = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await fetch(`/api/servers/${encodeURIComponent(id)}/probe`, {
        method: "POST",
      });
      await mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "probe failed");
    } finally {
      setBusyId(null);
    }
  };

  const saveServer = async (
    entry: ServerListEntry,
    patch: ServerUpdatePayload,
  ) => {
    setBusyId(entry.id);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${encodeURIComponent(entry.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`save failed: ${res.status} ${txt}`);
      }
      const fresh = await mutate();
      const picked = fresh?.servers.find((s) => s.id === entry.id);
      if (picked?.isActive) {
        setInstance({
          id: picked.id,
          name: labelFor(picked),
          protocol: picked.protocol,
          port: picked.port,
          hostname: picked.host,
          webEndpoint: picked.webEndpoint,
        });
        await globalMutate("/api/instance/self");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "save failed";
      setError(message);
      throw e;
    } finally {
      setBusyId(null);
    }
  };

  const configured = (data?.servers ?? []).filter((s) => s.configured);
  const discovered = (data?.servers ?? []).filter((s) => !s.configured);

  return (
    <div className="container mx-auto max-w-4xl space-y-8 px-4 py-10">
      <div className="space-y-2">
        <PageTitle>Servers</PageTitle>
        <p className="text-sm text-muted-fg">
          Pick an OpenCode server to bind this Portal UI to. Configured
          servers persist; discovered servers come and go with the
          processes they run in.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-danger-subtle p-3 text-sm text-danger-subtle-fg">
          {error}
        </div>
      )}
      {loadError && (
        <div className="rounded-md bg-danger-subtle p-3 text-sm text-danger-subtle-fg">
          Failed to load: {String(loadError)}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-fg">
          Configured
        </h2>
        {isLoading && <p className="text-sm text-muted-fg">Loading…</p>}
        {!isLoading && configured.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/50 bg-muted/5 p-6 text-center text-sm text-muted-fg">
            No configured servers yet. Promote a discovered one below or
            add manually.
          </div>
        )}
        {configured.map((s) => (
          <ServerCard
            key={s.id}
            entry={s}
            busy={busyId === s.id}
            onUse={() => tryActivate(s)}
            onProbe={() => probeServer(s.id)}
            onRemove={() => requestRemoveServer(s.id)}
            onSetCreds={() =>
              setAuthModal({
                host: s.liveHost ?? s.host,
                port: s.livePort ?? s.port,
                protocol: s.protocol,
                label: labelFor(s),
                serverId: s.id,
                activateAfter: false,
              })
            }
            onOpen={() => void navigate({ to: "/", search: (prev) => prev })}
            onSave={(patch) => saveServer(s, patch)}
            onConfigureDirs={() =>
              setDirectoriesTarget({ serverId: s.id, label: labelFor(s) })
            }
          />
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-fg">
            Discovered
          </h2>
          <Button
            size="sm"
            intent="secondary"
            onPress={async () => {
              setRescanning(true);
              try {
                await mutate();
              } finally {
                setRescanning(false);
              }
            }}
            isDisabled={isLoading || rescanning}
          >
            <ArrowPathIcon
              className={`size-4 ${rescanning ? "animate-spin" : ""}`}
            />
            {rescanning ? "Rescanning\u2026" : "Rescan"}
          </Button>
        </div>
        {!isLoading && discovered.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/50 bg-muted/5 p-6 text-center text-sm text-muted-fg">
            Nothing detected. Make sure opencode-desktop is running, or
            run <code className="rounded bg-muted px-1">opencode serve</code> in a
            terminal.
          </div>
        )}
        {discovered.map((s) => (
          <DiscoveredCard
            key={s.id}
            entry={s}
            busy={busyId === s.id}
            onAdd={() => promoteDiscovered(s)}
            onAddAndOpen={() =>
              promoteDiscovered(s, { activateAfter: true })
            }
          />
        ))}
      </section>

      <ManualAddCard
        onAdded={() => mutate()}
        onActivate={adoptServer}
      />

      <AuthModal
        target={authModal}
        onClose={() => setAuthModal(null)}
        onSuccess={async (info) => {
          setAuthModal(null);
          await mutate();
          if (info.activateAfter && info.serverId) {
            await adoptServer(info.serverId);
          }
        }}
      />

      <DirectoriesModal
        target={directoriesTarget}
        onClose={() => setDirectoriesTarget(null)}
      />

      <ConfirmDialog
        isOpen={removeTarget !== null}
        title="Remove server?"
        description={
          removeTarget
            ? `Remove "${data?.servers.find((s) => s.id === removeTarget)?.displayLabel ?? removeTarget}" from the registry. Stored credentials for this server (if any) are also cleared. The server itself is not stopped \u2014 only this Portal's reference to it.`
            : ""
        }
        confirmLabel="Remove"
        tone="danger"
        busy={busyId === removeTarget}
        onConfirm={performRemoveServer}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}

interface ServerCardProps {
  entry: ServerListEntry;
  busy: boolean;
  onUse: () => void;
  onProbe: () => void;
  onRemove: () => void;
  onSetCreds: () => void;
  onConfigureDirs: () => void;
  onSave: (patch: ServerUpdatePayload) => Promise<void>;
  // Navigate into the bound app for THIS server (only meaningful when
  // entry.isActive and entry.status is not offline).
  onOpen: () => void;
}

function ServerCard({
  entry,
  busy,
  onUse,
  onProbe,
  onRemove,
  onSetCreds,
  onConfigureDirs,
  onSave,
  onOpen,
}: ServerCardProps) {
  const [editOpen, setEditOpen] = useState(false);

  // Cred-lookup hint shown on the card. Same data the Discovered
  // section uses, but rendered here too so the user sees probe
  // progress on freshly-added configured servers without having to
  // open the auth modal. Without this, a manual Add lands the card
  // in `offline` state with no indication that a background probe
  // is in flight.
  const configuredCredHint = entry.credLookup
    ? formatCredHint(entry.credLookup)
    : null;
  const displayLabel = labelFor(entry);
  const liveLabel =
    entry.liveHost && entry.livePort
      ? `${entry.protocol}://${entry.liveHost}:${entry.livePort}`
      : null;
  const isLoopback =
    entry.host === "127.0.0.1" ||
    entry.host === "localhost" ||
    entry.host === "::1";
  const offlineNeedsAuth =
    entry.status === "offline" && !entry.ephemeral && !isLoopback;
  // Reconnect: the active server has gone offline (process died,
  // ephemeral port shifted before our resolver caught it, network
  // hiccup). Surface a Reconnect button so the user can force a
  // re-probe + re-activate without picking a different server first.
  const showReconnect = entry.isActive && entry.status === "offline";
  // Icon tint mirrors the connection state so the card colour reads
  // independently of the small text pill:
  //   green   = reachable (active or online; ephemeral relocated also
  //             counts since the live endpoint is up)
  //   muted   = offline / unknown
  // We don't tint by isActive alone - a configured-but-offline active
  // server is "broken right now", not "happy and connected".
  const reachable =
    entry.status === "active" ||
    entry.status === "online" ||
    entry.status === "ephemeral-online";
  const iconClasses = reachable
    ? "bg-emerald-500/10 text-emerald-600"
    : "bg-muted/30 text-muted-fg";
  const effectiveWebEndpoint =
    entry.webEndpoint ??
    serverOrigin(
      entry.protocol,
      entry.liveHost ?? entry.host,
      entry.livePort ?? entry.port,
    );

  return (
    <>
      <div className="flex items-center gap-4 rounded-xl border border-border/50 bg-bg p-4 shadow-sm">
        <div
          className={`flex size-12 shrink-0 items-center justify-center rounded-lg ${iconClasses}`}
        >
          <ServerStackIcon className="size-6" />
        </div>
        {/*
          Title row uses min-w-0 so the label can truncate inside the
          flex column without pushing the pill off-card. The pill sits
          directly after the label (gap-2) so the visual association is
          unambiguous: this status describes THIS server. Earlier
          version used justify-between, which floated the pill far to
          the right and made it look like it belonged with the action
          buttons instead.
        */}
        <div className="flex flex-1 flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-fg truncate">{displayLabel}</span>
            <StatusPill status={entry.status} />
          </div>
          <div className="text-xs text-muted-fg font-mono truncate">
            ID: {entry.id}
          </div>
          <div className="text-xs text-muted-fg font-mono truncate">
            {entry.protocol}://{entry.host}:{entry.port}
            {entry.resolvedAddress && entry.resolvedAddress !== entry.host
              ? ` (${entry.resolvedAddress})`
              : ""}
            {liveLabel ? ` -> ${liveLabel}` : ""}
            {entry.ephemeral ? " · ephemeral" : ""}
          </div>
          <div className="text-xs text-muted-fg font-mono truncate">
            OpenCode Web UI: {effectiveWebEndpoint}
            {!entry.webEndpoint ? " (default)" : ""}
          </div>
          {configuredCredHint && (
            <div className="flex items-center gap-1.5 text-xs">
              {configuredCredHint.spinner && (
                <ArrowPathIcon className="size-3.5 shrink-0 animate-spin text-muted-fg" />
              )}
              <span
                className={
                  configuredCredHint.tone === "success"
                    ? "text-emerald-600"
                    : configuredCredHint.tone === "danger"
                      ? "text-warning"
                      : "text-muted-fg"
                }
              >
                {configuredCredHint.text}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            intent="secondary"
            onPress={() => setEditOpen(true)}
            isDisabled={busy}
            aria-label="Edit server address and OpenCode Web UI address"
          >
            <PencilSquareIcon className="size-4" />
          </Button>
          {entry.isActive && entry.status !== "offline" && (
            <Button size="sm" intent="primary" onPress={onOpen} isDisabled={busy}>
              Open
            </Button>
          )}
          {showReconnect && (
            <Button
              size="sm"
              intent="primary"
              onPress={onUse}
              isDisabled={busy}
            >
              <ArrowPathIcon className="size-4" />
              Reconnect
            </Button>
          )}
          {!entry.isActive && (
            <Button size="sm" intent="primary" onPress={onUse} isDisabled={busy}>
              Open
            </Button>
          )}
          {offlineNeedsAuth && (
            <Button
              size="sm"
              intent="secondary"
              onPress={onSetCreds}
              isDisabled={busy}
            >
              <KeyIcon className="size-4" />
            </Button>
          )}
          <Button
            size="sm"
            intent="secondary"
            onPress={onConfigureDirs}
            isDisabled={busy}
            aria-label="Configure workspace directories"
          >
            <FolderOpenIcon className="size-4" />
          </Button>
          <Button
            size="sm"
            intent="secondary"
            onPress={onProbe}
            isDisabled={busy}
          >
            <ArrowPathIcon className="size-4" />
          </Button>
          <Button
            size="sm"
            intent="secondary"
            onPress={onRemove}
            isDisabled={busy}
          >
            <TrashIcon className="size-4" />
          </Button>
        </div>
      </div>
      <ServerEditModal
        entry={entry}
        busy={busy}
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        onSave={onSave}
      />
    </>
  );
}

function ServerEditModal({
  entry,
  busy,
  isOpen,
  onClose,
  onSave,
}: {
  entry: ServerListEntry;
  busy: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSave: (patch: ServerUpdatePayload) => Promise<void>;
}) {
  const [editLabel, setEditLabel] = useState(entry.label ?? "");
  const [editProtocol, setEditProtocol] = useState<ServerProtocol>(
    entry.protocol,
  );
  const [editHost, setEditHost] = useState(entry.host);
  const [editPort, setEditPort] = useState(String(entry.port));
  const [editWebEndpoint, setEditWebEndpoint] = useState(
    entry.webEndpoint ?? "",
  );
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEditLabel(entry.label ?? "");
    setEditProtocol(entry.protocol);
    setEditHost(entry.host);
    setEditPort(String(entry.port));
    setEditWebEndpoint(entry.webEndpoint ?? "");
    setEditError(null);
  }, [
    entry.host,
    entry.id,
    entry.label,
    entry.port,
    entry.protocol,
    entry.webEndpoint,
    isOpen,
  ]);

  const saveEdit = async () => {
    const nextHost = editHost.trim();
    const nextPort = Number(editPort);
    if (!nextHost) {
      setEditError("Host is required.");
      return;
    }
    if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
      setEditError("Port must be between 1 and 65535.");
      return;
    }
    setEditError(null);
    try {
      await onSave({
        label: editLabel.trim() || null,
        protocol: editProtocol,
        host: nextHost,
        port: nextPort,
        webEndpoint: editWebEndpoint.trim() || null,
      });
      onClose();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "save failed");
    }
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50"
    >
      <Modal className="outline-none w-full max-w-lg">
        <PrimitiveDialog className="relative outline-none rounded-xl bg-bg shadow-2xl border border-border/50 p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Edit server</h2>
              <p className="text-xs text-muted-fg">
                Blank label uses the automatic fallback shown in the server list.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-muted-fg hover:bg-muted/40 hover:text-fg"
            >
              <XMarkIcon className="size-4" />
            </button>
          </div>

          <div className="space-y-3">
            <label className="block text-sm">
              <div className="text-muted-fg mb-1">Label (optional)</div>
              <Input
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                placeholder={entry.displayLabel}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_7rem]">
              <label className="block text-sm">
                <div className="text-muted-fg mb-1">Protocol</div>
                <Select
                  selectedKey={editProtocol}
                  onSelectionChange={(key) => {
                    if (key === "http" || key === "https") {
                      setEditProtocol(key);
                    }
                  }}
                >
                  <SelectTrigger className="font-mono" />
                  <SelectContent>
                    <SelectItem id="http" textValue="http">
                      http
                    </SelectItem>
                    <SelectItem id="https" textValue="https">
                      https
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="block text-sm">
                <div className="text-muted-fg mb-1">Host</div>
                <Input
                  required
                  value={editHost}
                  onChange={(e) => setEditHost(e.target.value)}
                  className="font-mono"
                />
              </label>
              <label className="block text-sm">
                <div className="text-muted-fg mb-1">Port</div>
                <Input
                  required
                  value={editPort}
                  onChange={(e) => setEditPort(e.target.value)}
                  inputMode="numeric"
                  className="font-mono"
                />
              </label>
            </div>

            <label className="block text-sm">
              <div className="text-muted-fg mb-1">
                OpenCode Web UI address{" "}
                <span className="text-muted-fg/70">(optional)</span>
              </div>
              <Input
                value={editWebEndpoint}
                onChange={(e) => setEditWebEndpoint(e.target.value)}
                placeholder={serverOrigin(
                  editProtocol,
                  editHost || entry.host,
                  Number(editPort) || entry.port,
                )}
                className="font-mono"
              />
            </label>
          </div>

          {editError && (
            <div className="rounded-md bg-danger-subtle p-2 text-sm text-danger-subtle-fg">
              {editError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button intent="secondary" onPress={onClose} isDisabled={busy}>
              Cancel
            </Button>
            <Button intent="primary" onPress={saveEdit} isDisabled={busy}>
              {busy ? "Saving..." : "Save"}
            </Button>
          </div>
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

interface DiscoveredCardProps {
  entry: ServerListEntry;
  busy: boolean;
  onAdd: () => void;
  onAddAndOpen: () => void;
}

function DiscoveredCard({
  entry,
  busy,
  onAdd,
  onAddAndOpen,
}: DiscoveredCardProps) {
  // Default to a no-auth "Ready to connect" hint when the server is
  // listed under Discovered with no credLookup result yet. Most
  // discovered local servers don't need auth (loopback, our own
  // process), so optimism-first reads more naturally than a
  // permanent "looking up..." state for the common case. The
  // background probe will overwrite with the actual outcome within
  // a few seconds.
  const credHint = entry.credLookup
    ? formatCredHint(entry.credLookup)
    : null;
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border/50 bg-bg p-4 shadow-sm">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600">
        <SignalIcon className="size-6" />
      </div>
      {/*
        No StatusPill here. The "Discovered" section heading already
        carries that information; an additional `discovered` pill
        adjacent to every row is redundant noise. The cred-hint below
        is the actual interesting per-row state.
      */}
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-fg truncate">{labelFor(entry)}</span>
        </div>
        <div className="text-xs text-muted-fg font-mono truncate">
          {entry.host}:{entry.port}
          {entry.resolvedAddress && entry.resolvedAddress !== entry.host
            ? ` (${entry.resolvedAddress})`
            : ""}
          {entry.pid ? ` · pid ${entry.pid}` : ""}
          {entry.ephemeral ? " · ephemeral" : ""}
        </div>
        {credHint && (
          <div className="flex items-center gap-1.5 text-xs">
            {credHint.spinner && (
              <ArrowPathIcon className="size-3.5 shrink-0 animate-spin text-muted-fg" />
            )}
            <span
              className={
                credHint.tone === "success"
                  ? "text-emerald-600"
                  : credHint.tone === "danger"
                    ? "text-warning"
                    : "text-muted-fg"
              }
            >
              {credHint.text}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          intent="secondary"
          onPress={onAdd}
          isDisabled={busy}
        >
          <PlusIcon className="size-4" />
          Add
        </Button>
        <Button
          size="sm"
          intent="primary"
          onPress={onAddAndOpen}
          isDisabled={busy}
        >
          Add & open
        </Button>
      </div>
    </div>
  );
}

function formatCredHint(c: CredLookupSummary): {
  text: string;
  tone: "muted" | "success" | "danger";
  spinner: boolean;
} {
  switch (c.state) {
    case "probing-http":
    case "probing-ssh":
      return {
        text: c.step ?? "Looking up credentials\u2026",
        tone: "muted",
        spinner: true,
      };
    case "needs-auth":
      return {
        text: "Server requires authentication. Trying SSH\u2026",
        tone: "muted",
        spinner: true,
      };
    case "succeeded": {
      // Branch on how the success was reached. Each value gets
      // distinct copy so a quick scan of the page tells the user
      // not just "ready" but also why - and crucially, where the
      // password came from. State of the password must always be
      // visible.
      //   none       - server doesn't require auth
      //   discovered - we harvested + validated it via SSH probe
      //   manual     - user typed it in the auth modal this session
      //   stored     - on-disk auth-store has it from a previous
      //                session; no probe ran this session
      let text: string;
      switch (c.authMode) {
        case "none":
          text = "Ready to connect \u2014 instance without password";
          break;
        case "manual":
          text = "Ready to connect \u2014 password provided by you";
          break;
        case "stored":
          text = "Ready to connect \u2014 password saved";
          break;
        case "discovered":
        default:
          text = "Ready to connect \u2014 password retrieved via SSH";
          break;
      }
      return { text, tone: "success", spinner: false };
    }
    case "failed":
      return {
        text: c.message ?? "Could not auto-fetch credentials",
        tone: "danger",
        spinner: false,
      };
    default:
      return { text: "", tone: "muted", spinner: false };
  }
}

// Inspect-host result types. Mirrors the payload from
// POST /api/servers/inspect-host.
interface InspectFinding {
  port: number;
  label: string;
  source: "ssh" | "http-probe";
  needsAuth: boolean;
  username?: string;
  password?: string;
  pid?: number;
  boundHost?: string;
}

interface InspectResult {
  host: string;
  resolvedAddress: string | null;
  ssh: {
    attempted: boolean;
    ok: boolean;
    step?: string;
    message?: string;
    elapsedMs?: number;
  };
  findings: InspectFinding[];
  elapsedMs: number;
}

// Single unified add-form. Host comes first; an inline `Inspect` button
// next to the Host field lets the user say "find every opencode on
// this machine" without committing to a port. Results render below
// the Host row; the user can Add a result or keep typing into Port +
// Label below and Add manually. No mode toggle - Inspect is an action
// you take at any moment, not a state you switch into.
// RFC-1123 hostname / IPv4 / IPv6 validity check used to decide
// whether to auto-fire the inspect probe on host-field change.
// We don't ship the entire RFC matcher - just enough to avoid
// probing on garbage like "des" while the user is mid-typing.
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-f:]+$/i;

function isProbeableHost(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (IPV4_RE.test(v)) {
    // Crude octet sanity check; full validation is opencode's job.
    return v.split(".").every((octet) => {
      const n = Number(octet);
      return Number.isFinite(n) && n >= 0 && n <= 255;
    });
  }
  if (IPV6_RE.test(v) && v.includes(":")) return true;
  return HOSTNAME_RE.test(v);
}

const AUTO_PROBE_DEBOUNCE_MS = 600;

function ManualAddCard({
  onAdded,
  onActivate,
}: {
  onAdded: () => void;
  onActivate: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("4096");
  const [protocol, setProtocol] = useState<ServerProtocol>("http");
  const [webEndpoint, setWebEndpoint] = useState("");
  const [label, setLabel] = useState("");
  const [ephemeral, setEphemeral] = useState(false);
  // submitting carries which submit-button is in flight so each one
  // can show its own "Adding..." text without spinning the other.
  const [submitting, setSubmitting] = useState<null | "add" | "addOpen">(null);
  const [inspecting, setInspecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(
    null,
  );
  // Tracks per-finding-row in-flight state. `mode` distinguishes the
  // two action buttons so they spin independently.
  const [busyFinding, setBusyFinding] = useState<
    null | { port: number; mode: "add" | "addOpen" }
  >(null);
  // Focus target: the Host input. RAF so we wait for the form to
  // mount after the open-toggle re-render before calling focus().
  const hostInputRef = useRef<HTMLInputElement | null>(null);
  // Last host we sent to /api/servers/inspect-host. Used so the
  // auto-probe doesn't re-fire for the same value when the user
  // continues editing port/label.
  const lastProbedHostRef = useRef<string | null>(null);
  // Tracks the latest in-flight auto-probe so a quick succession
  // of edits doesn't overwrite a later result with an earlier
  // one.
  const inspectRunIdRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setErr(null);
      setSubmitting(null);
      setInspecting(false);
      setInspectResult(null);
      setBusyFinding(null);
      lastProbedHostRef.current = null;
      return;
    }
    const raf = requestAnimationFrame(() => {
      hostInputRef.current?.focus();
      hostInputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Shared handler for the two submit buttons. `activateAfter=true` is
  // the "Add & open" variant: after a successful POST we bind the
  // Portal to the new server and navigate to /.
  const submitManualAdd = async (
    activateAfter: boolean,
    e?: React.FormEvent,
  ) => {
    e?.preventDefault();
    setSubmitting(activateAfter ? "addOpen" : "add");
    setErr(null);
    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || null,
          protocol,
          host,
          port: Number(port),
          webEndpoint: webEndpoint.trim() || undefined,
          ephemeral,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`add failed: ${res.status} ${txt}`);
      }
      const { server } = (await res.json()) as { server: { id: string } };
      onAdded();
      setOpen(false);
      if (activateAfter) {
        await onActivate(server.id);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "add failed");
    } finally {
      setSubmitting(null);
    }
  };

  // Runs the inspect probe for the current Host value. Tagged with
  // a monotonically-increasing run id so a stale response from an
  // earlier host doesn't overwrite a newer one when the user
  // types quickly.
  const runInspect = async () => {
    if (!host || inspecting) return;
    const trimmedHost = host.trim();
    const runId = ++inspectRunIdRef.current;
    setInspecting(true);
    setErr(null);
    setInspectResult(null);
    lastProbedHostRef.current = trimmedHost;
    try {
      const extraPorts: number[] = [];
      const portNum = Number(port);
      if (Number.isFinite(portNum) && portNum > 0 && portNum < 65536) {
        extraPorts.push(portNum);
      }
      const res = await fetch("/api/servers/inspect-host", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: trimmedHost, extraPorts }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`inspect failed: ${res.status} ${txt}`);
      }
      const data = (await res.json()) as InspectResult;
      // Discard if a newer run started in the meantime - prevents
      // an older host's result from overwriting a newer probe.
      if (runId !== inspectRunIdRef.current) return;
      setInspectResult(data);
      // Tell the parent to refresh so the Discovered section
      // (server-side inspect-pool) picks up the new findings
      // immediately rather than waiting for the next SWR tick.
      onAdded();
    } catch (e) {
      if (runId !== inspectRunIdRef.current) return;
      setErr(e instanceof Error ? e.message : "inspect failed");
    } finally {
      if (runId === inspectRunIdRef.current) {
        setInspecting(false);
      }
    }
  };

  // Auto-probe: when the Host field changes to a syntactically
  // valid hostname / IP, fire an inspect after a short debounce.
  // The debounce avoids probing every keystroke; the validity
  // check avoids probing partial hostnames like "des".
  useEffect(() => {
    if (!open) return;
    const trimmed = host.trim();
    // If results are showing from a previous host, clear them the
    // moment the user changes the field. The backend pool retains
    // those findings, so they appear in the Discovered section
    // above (we triggered onAdded() when they were probed). We
    // also bump the run id so any in-flight earlier probe is
    // invalidated.
    if (inspectResult && trimmed !== lastProbedHostRef.current) {
      setInspectResult(null);
      inspectRunIdRef.current += 1;
    }
    if (!isProbeableHost(trimmed)) return;
    if (trimmed === lastProbedHostRef.current) return;
    const timer = setTimeout(() => {
      void runInspect();
    }, AUTO_PROBE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // We intentionally exclude `inspecting` from deps - the next
    // edit should still schedule a new probe even if the previous
    // one is still in flight (the runId mechanism handles ordering).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, open]);

  // Adds a single inspect finding as a Configured server. When
  // `activateAfter` is true (the "Add & open" button), we also bind
  // the Portal to it and navigate to /. The auth payload (if any)
  // is attached in the same POST so /api/servers seeds the auth-
  // store and the subsequent activation is silent.
  const addFinding = async (
    finding: InspectFinding,
    activateAfter: boolean,
  ) => {
    setBusyFinding({
      port: finding.port,
      mode: activateAfter ? "addOpen" : "add",
    });
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        label: null,
        protocol: "http",
        host,
        port: finding.port,
        webEndpoint: webEndpoint.trim() || undefined,
      };
      if (finding.username && finding.password) {
        body.auth = {
          username: finding.username,
          password: finding.password,
        };
      }
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`add failed: ${res.status} ${txt}`);
      }
      const { server } = (await res.json()) as { server: { id: string } };
      onAdded();
      // Drop this finding from the inspect result so the user sees
      // it has moved into Configured.
      setInspectResult((prev) =>
        prev
          ? {
              ...prev,
              findings: prev.findings.filter((f) => f.port !== finding.port),
            }
          : prev,
      );
      if (activateAfter) {
        // Close the form and navigate by activating. onActivate
        // (=adoptServer) navigates to /, so this also unmounts the
        // page.
        setOpen(false);
        await onActivate(server.id);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "add failed");
    } finally {
      setBusyFinding(null);
    }
  };

  if (!open) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 bg-muted/5 p-4 text-center">
        <Button size="sm" intent="secondary" onPress={() => setOpen(true)}>
          <PlusIcon className="size-4" />
          Add server manually
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => submitManualAdd(false, e)}
      className="space-y-3 rounded-xl border border-border/50 bg-bg p-4 shadow-sm"
    >
      {/* Host row with inline Inspect button. The button is the
          "find every opencode on this host" action; clicking it
          shows inspect results below. The rest of the form (Port,
          Label, Ephemeral, Add) stays usable independently - the
          user can also just type host+port and click Add directly. */}
      <div className="flex items-end gap-2">
        <label className="text-sm flex-1">
          <div className="text-muted-fg mb-1">Host</div>
          <input
            ref={hostInputRef}
            required
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono"
          />
        </label>
        <Button
          size="sm"
          intent="secondary"
          type="button"
          onPress={runInspect}
          isDisabled={inspecting || submitting !== null || !host}
        >
          {inspecting ? (
            <>
              <ArrowPathIcon className="size-4 animate-spin" />
              Inspecting…
            </>
          ) : (
            <>
              <ArrowPathIcon className="size-4" />
              Inspect host
            </>
          )}
        </Button>
      </div>

      {/* Port, Label, Ephemeral are anchored to the top half of the
          form so they stay in a predictable position. Inspect
          progress and results flow underneath. */}
      <div className="grid gap-3 sm:grid-cols-[9rem_7rem_minmax(0,1fr)]">
        <label className="text-sm">
          <div className="text-muted-fg mb-1">Protocol</div>
          <Select
            selectedKey={protocol}
            onSelectionChange={(key) => {
              if (key === "http" || key === "https") {
                setProtocol(key);
              }
            }}
          >
            <SelectTrigger className="font-mono" />
            <SelectContent>
              <SelectItem id="http" textValue="http">
                http
              </SelectItem>
              <SelectItem id="https" textValue="https">
                https
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="text-sm">
          <div className="text-muted-fg mb-1">Port</div>
          <input
            required
            value={port}
            onChange={(e) => setPort(e.target.value)}
            inputMode="numeric"
            className="w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono"
          />
        </label>
        <label className="text-sm">
          <div className="text-muted-fg mb-1">
            Label{" "}
            <span className="text-muted-fg/70 normal-case">
              (optional, auto)
            </span>
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`${protocol}://${host}:${port}`}
            className="w-full rounded-md border border-border bg-bg px-2 py-1.5"
          />
        </label>
      </div>

      <label className="text-sm block">
        <div className="text-muted-fg mb-1">
          OpenCode Web UI address{" "}
          <span className="text-muted-fg/70 normal-case">
            (optional)
          </span>
        </div>
        <Input
          value={webEndpoint}
          onChange={(e) => setWebEndpoint(e.target.value)}
          placeholder={serverOrigin(protocol, host, Number(port) || 4096)}
          className="font-mono"
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-muted-fg">
        <input
          type="checkbox"
          checked={ephemeral}
          onChange={(e) => setEphemeral(e.target.checked)}
        />
        Ephemeral (port may change between launches; re-discover on
        reconnect)
      </label>

      {/* Inspect-host status + results. Lives below the manual-add
          fields so the form fields stay anchored above and the
          discovery output flows underneath. Mid-typing host
          changes wipe the panel; the entries persist server-side
          in the inspect-pool and surface in the Discovered section
          above. */}
      {inspecting && (
        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/10 p-3 text-sm">
          <ArrowPathIcon className="size-4 shrink-0 animate-spin text-muted-fg" />
          <span className="text-muted-fg">
            Probing {host} via SSH and well-known ports…
          </span>
        </div>
      )}

      {inspectResult && !inspecting && (
        <div className="space-y-2 rounded-md border border-border/50 bg-muted/5 p-3 text-sm">
          <div className="text-xs text-muted-fg">
            <span className="font-mono">{inspectResult.host}</span>
            {inspectResult.resolvedAddress &&
              inspectResult.resolvedAddress !== inspectResult.host && (
                <>
                  {" "}
                  (
                  <span className="font-mono">
                    {inspectResult.resolvedAddress}
                  </span>
                  )
                </>
              )}{" "}
            · probed in {inspectResult.elapsedMs}ms
          </div>
          <div className="text-xs">
            <span className="text-muted-fg">SSH: </span>
            {inspectResult.ssh.ok ? (
              <span className="text-emerald-600">
                connected
                {inspectResult.ssh.elapsedMs
                  ? ` (${inspectResult.ssh.elapsedMs}ms)`
                  : ""}
              </span>
            ) : (
              <span className="text-warning">
                {inspectResult.ssh.message ?? inspectResult.ssh.step}
              </span>
            )}
          </div>
          {inspectResult.findings.length === 0 ? (
            <div className="rounded border border-dashed border-border/40 bg-bg/40 p-3 text-xs text-muted-fg">
              No OpenCode processes found on {inspectResult.host}. You
              can still add a specific host:port manually above.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {inspectResult.findings.map((f) => (
                <li
                  key={f.port}
                  className="flex items-center gap-2 rounded border border-border/40 bg-bg p-2 text-xs"
                >
                  <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-fg">
                        {host}:{f.port}
                      </span>
                      <span
                        className={
                          f.source === "ssh"
                            ? "text-emerald-600"
                            : "text-sky-600"
                        }
                      >
                        via {f.source === "ssh" ? "SSH env" : "HTTP probe"}
                      </span>
                    </div>
                    <div className="text-muted-fg">
                      {f.username && f.password
                        ? "Ready to connect \u2014 password retrieved via SSH"
                        : f.needsAuth
                          ? "Auth required \u2014 SSH saw the process but couldn't read its env"
                          : "Ready to connect \u2014 instance without password"}
                      {f.pid ? ` \u00b7 pid ${f.pid}` : ""}
                      {f.boundHost ? ` \u00b7 bound ${f.boundHost}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      intent="secondary"
                      type="button"
                      onPress={() => addFinding(f, false)}
                      isDisabled={busyFinding !== null}
                    >
                      {busyFinding?.port === f.port &&
                      busyFinding.mode === "add"
                        ? "Adding\u2026"
                        : "Add"}
                    </Button>
                    <Button
                      size="sm"
                      intent="primary"
                      type="button"
                      onPress={() => addFinding(f, true)}
                      isDisabled={busyFinding !== null}
                    >
                      {busyFinding?.port === f.port &&
                      busyFinding.mode === "addOpen"
                        ? "Opening\u2026"
                        : "Add & open"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {err && (
        <div className="rounded-md bg-danger-subtle p-2 text-sm text-danger-subtle-fg">
          {err}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          intent="secondary"
          type="button"
          onPress={() => setOpen(false)}
          isDisabled={submitting !== null || inspecting}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          intent="secondary"
          type="submit"
          isDisabled={submitting !== null || inspecting}
        >
          {submitting === "add" ? "Adding\u2026" : "Add"}
        </Button>
        <Button
          size="sm"
          intent="primary"
          type="button"
          onPress={() => submitManualAdd(true)}
          isDisabled={submitting !== null || inspecting}
        >
          {submitting === "addOpen" ? "Opening\u2026" : "Add & open"}
        </Button>
      </div>
    </form>
  );
}

interface AuthModalProps {
  target: AuthModalTarget | null;
  onClose: () => void;
  onSuccess: (info: { serverId: string; activateAfter: boolean }) => void;
}

// Live cred-lookup poller. Hits GET /api/servers/cred-lookup every
// `pollMs` while the modal is open and the lookup isn't terminal.
function useCredLookup(
  host: string | null,
  port: number | null,
  protocol: ServerProtocol | null,
): {
  status: CredLookupSummary;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<CredLookupSummary>({ state: "idle" });
  const refresh = useCallback(async () => {
    if (!host || !port || !protocol) return;
    try {
      const params = new URLSearchParams({
        host,
        port: String(port),
        protocol,
      });
      const res = await fetch(`/api/servers/cred-lookup?${params}`);
      if (!res.ok) return;
      const next = (await res.json()) as CredLookupSummary;
      setStatus(next);
    } catch {
      // Network blip; keep last status.
    }
  }, [host, port, protocol]);

  useEffect(() => {
    if (!host || !port || !protocol) {
      setStatus({ state: "idle" });
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!alive) return;
      await refresh();
      if (!alive) return;
      // Don't poll once the result is terminal.
      timer = setTimeout(tick, 750);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // We intentionally re-run polling whenever the (host, port) keys
    // change, but not when `status` updates — the loop above stays
    // open continuously while alive.
  }, [host, port, protocol, refresh]);

  return { status, refresh };
}

function AuthModal({ target, onClose, onSuccess }: AuthModalProps) {
  const isOpen = target !== null;
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50"
    >
      <Modal className="outline-none w-full max-w-lg">
        <PrimitiveDialog className="relative outline-none rounded-xl bg-bg shadow-2xl border border-border/50 p-5 space-y-4">
          {target && (
            <AuthModalBody
              target={target}
              onClose={onClose}
              onSuccess={onSuccess}
            />
          )}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

function AuthModalBody({
  target,
  onClose,
  onSuccess,
}: {
  target: AuthModalTarget;
  onClose: () => void;
  onSuccess: AuthModalProps["onSuccess"];
}) {
  const { status, refresh } = useCredLookup(
    target.host,
    target.port,
    target.protocol,
  );
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("opencode");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSshPanel, setShowSshPanel] = useState(false);
  const [sshUser, setSshUser] = useState("");
  // True the first time the SSH probe surfaces creds; offered as an
  // "Apply" inline confirm if the user is mid-typing in the password
  // field. We never auto-replace user input.
  const [pendingAutoApply, setPendingAutoApply] = useState(false);
  const userTypedRef = useRef(false);

  // Kick off (or join) a probe as soon as the modal opens. We don't
  // assume the background probe ran — could be a fresh page load on
  // /servers landing here directly.
  useEffect(() => {
    void fetch("/api/servers/cred-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: target.host,
        port: target.port,
        protocol: target.protocol,
      }),
    });
  }, [target.host, target.port, target.protocol]);

  // When the probe transitions to `succeeded` AND the user hasn't
  // typed: apply silently. If the user has typed, surface a "Got
  // creds via SSH — apply?" confirm.
  useEffect(() => {
    if (status.state !== "succeeded") return;
    if (userTypedRef.current) {
      setPendingAutoApply(true);
      return;
    }
    void persistFromSshAndFinish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.state]);

  // The cred-lookup endpoint never returns the password. To use it
  // server-side we go through a "promote-with-ssh-creds" flow: the
  // promote/auth endpoints look at the cred-lookup cache themselves.
  const persistFromSshAndFinish = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let serverId = target.serverId;
      if (!serverId && target.discoveredId) {
        // Promotion path: promote endpoint reads the cred-lookup cache
        // and writes auth automatically.
        const res = await fetch("/api/servers/promote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ discoveredId: target.discoveredId }),
        });
        if (!res.ok) throw new Error(`promote failed: ${res.status}`);
        const { server } = (await res.json()) as { server: { id: string } };
        serverId = server.id;
      } else if (serverId) {
        // For an already-configured server, re-trigger the resolver so
        // the next request rebuilds with the new auth from the
        // auth-store. The auth was already written by the cred-lookup
        // path indirectly... wait, no: cred-lookup caches in memory
        // only. We need to push it through /auth here. The cred-lookup
        // cache surfaces only state, not creds, to clients. We rely
        // on the server-side `recordKnownGoodCreds` having stored
        // them in the cred-lookup cache; persistence happens via the
        // promote path. For a configured-server scenario without
        // promotion, the user must type the password — fall through
        // below.
      }
      onSuccess({
        serverId: serverId!,
        activateAfter: target.activateAfter,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "promote failed");
      setSubmitting(false);
    }
  };

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      let serverId = target.serverId;
      if (!serverId && target.discoveredId) {
        // Promote first (this won't carry creds because the
        // cred-lookup cache is `failed` or hasn't run; that's fine —
        // we'll write creds in the next step).
        const res = await fetch("/api/servers/promote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ discoveredId: target.discoveredId }),
        });
        if (!res.ok) throw new Error(`promote failed: ${res.status}`);
        const { server } = (await res.json()) as { server: { id: string } };
        serverId = server.id;
      }
      const res = await fetch(
        `/api/servers/${encodeURIComponent(serverId!)}/auth`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        },
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Auth rejected: ${res.status} ${txt}`);
      }
      onSuccess({
        serverId: serverId!,
        activateAfter: target.activateAfter,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "auth failed");
      setSubmitting(false);
    }
  };

  const tryAgainViaSsh = async () => {
    setError(null);
    await fetch("/api/servers/cred-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: target.host,
        port: target.port,
        protocol: target.protocol,
        forceSsh: true,
        sshUser: sshUser || undefined,
      }),
    });
    await refresh();
  };

  const statusBox = renderStatusBox(status);

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-2 top-2 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
      >
        <XMarkIcon className="size-4" />
      </button>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Authenticate to {target.label}</h2>
        <p className="text-xs text-muted-fg font-mono">
          {target.protocol}://{target.host}:{target.port}
        </p>
      </div>

      {statusBox}

      {pendingAutoApply && status.state === "succeeded" && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm space-y-2">
          <p className="text-emerald-700 dark:text-emerald-400">
            Got credentials via SSH. Apply and continue?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              intent="secondary"
              onPress={() => setPendingAutoApply(false)}
            >
              Keep typing
            </Button>
            <Button
              size="sm"
              intent="primary"
              onPress={() => persistFromSshAndFinish()}
              isDisabled={submitting}
            >
              Apply
            </Button>
          </div>
        </div>
      )}

      <form className="space-y-3" onSubmit={submitManual}>
        <label className="block text-sm">
          <div className="text-muted-fg mb-1">OpenCode username</div>
          <input
            type="text"
            value={username}
            onChange={(e) => {
              userTypedRef.current = true;
              setUsername(e.target.value);
            }}
            className="w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono"
          />
        </label>
        <label className="block text-sm">
          <div className="text-muted-fg mb-1">OpenCode password</div>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              userTypedRef.current = true;
              setPassword(e.target.value);
            }}
            placeholder={
              status.state === "probing-ssh" ||
              status.state === "needs-auth" ||
              status.state === "probing-http"
                ? "Looking up automatically — or type to override"
                : undefined
            }
            className="w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono"
            autoComplete="off"
          />
        </label>

        {error && (
          <div className="rounded-md bg-danger-subtle p-2 text-sm text-danger-subtle-fg">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowSshPanel((v) => !v)}
            className="text-xs text-muted-fg underline-offset-2 hover:underline"
          >
            {showSshPanel ? "Hide" : "Try"} SSH options
          </button>
          <div className="flex gap-2">
            <Button
              size="sm"
              intent="secondary"
              onPress={onClose}
              isDisabled={submitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              intent="primary"
              type="submit"
              isDisabled={submitting || password.length === 0}
            >
              {submitting ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        {showSshPanel && (
          <div className="rounded-md border border-border/50 bg-muted/5 p-3 space-y-2 text-sm">
            <p className="text-xs text-muted-fg">
              The Portal will SSH to{" "}
              <code className="font-mono">{target.host}</code> using your
              SSH client config (key auth only — set up{" "}
              <code className="font-mono">ssh-copy-id</code> first if it
              isn't already). It harvests the OpenCode credentials from the
              running server's environment, validates them, and stores them
              encrypted to{" "}
              <code className="font-mono">~/.openportal/openportal-auth.json</code>
              .
            </p>
            <label className="block text-sm">
              <div className="text-muted-fg mb-1">SSH user (optional)</div>
              <input
                type="text"
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
                placeholder="leave blank to use ssh client default"
                className="w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono"
              />
            </label>
            <div className="flex justify-end">
              <Button
                size="sm"
                intent="secondary"
                onPress={tryAgainViaSsh}
                isDisabled={submitting}
              >
                <ArrowPathIcon className="size-4" />
                Try SSH now
              </Button>
            </div>
          </div>
        )}
      </form>
    </>
  );
}

function renderStatusBox(status: CredLookupSummary): React.ReactNode {
  if (status.state === "idle") return null;
  const inFlight =
    status.state === "probing-http" ||
    status.state === "probing-ssh" ||
    status.state === "needs-auth";
  let toneClasses = "border-border/50 bg-muted/10 text-muted-fg";
  if (status.state === "succeeded") {
    toneClasses =
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  } else if (status.state === "failed") {
    toneClasses = "border-warning/40 bg-warning/10 text-fg";
  }
  return (
    <div className={`rounded-md border p-3 text-sm space-y-1 ${toneClasses}`}>
      <div className="flex items-center gap-2">
        {inFlight ? (
          <ArrowPathIcon className="size-4 shrink-0 animate-spin" />
        ) : status.state === "succeeded" ? (
          <CheckCircleIcon className="size-4 shrink-0" />
        ) : (
          <XCircleIcon className="size-4 shrink-0" />
        )}
        <span className="font-medium">
          {status.step ?? humanState(status.state)}
        </span>
      </div>
      {status.message && (
        <p className="pl-6 text-xs opacity-90">{status.message}</p>
      )}
    </div>
  );
}

function humanState(s: CredLookupState): string {
  switch (s) {
    case "probing-http":
      return "Probing server\u2026";
    case "probing-ssh":
      return "Looking up credentials over SSH\u2026";
    case "needs-auth":
      return "Server requires authentication.";
    case "succeeded":
      return "Ready to connect";
    case "failed":
      return "Could not auto-fetch credentials";
    default:
      return "";
  }
}

interface DirEntry {
  path: string;
  level?: number;
  level1?: string[];
}

interface DirectoriesResponse {
  id: string;
  directories: Array<DirEntry | string>;
  history: Array<{
    at: number;
    directories: Array<DirEntry | string>;
  }>;
}

function normalizeEntries(
  entries: Array<DirEntry | string> | undefined,
): DirEntry[] {
  return (entries ?? []).map((e) =>
    typeof e === "string" ? { path: e } : { ...e },
  );
}

function advancedEntryIndexes(entries: DirEntry[]): Set<number> {
  const indexes = new Set<number>();
  entries.forEach((entry, index) => {
    if (
      typeof entry.level === "number" ||
      (entry.level1 !== undefined && entry.level1.length > 0)
    ) {
      indexes.add(index);
    }
  });
  return indexes;
}

function entriesToJson(entries: DirEntry[]): string {
  return JSON.stringify(
    entries.map((e) => {
      const compact: DirEntry = { path: e.path };
      if (typeof e.level === "number") compact.level = e.level;
      if (e.level1 && e.level1.length > 0) compact.level1 = e.level1;
      return compact;
    }),
    null,
    2,
  );
}

function parseJsonEntries(text: string): DirEntry[] {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("Top-level value must be a JSON array");
  }
  const normalized: DirEntry[] = [];
  for (const item of parsed) {
    if (typeof item === "string") {
      if (item.trim()) normalized.push({ path: item.trim() });
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const path = typeof obj.path === "string" ? obj.path.trim() : "";
      if (!path) continue;
      const entry: DirEntry = { path };
      if (typeof obj.level === "number" && Number.isInteger(obj.level)) {
        entry.level = obj.level;
      }
      if (Array.isArray(obj.level1)) {
        const items = (obj.level1 as unknown[]).filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        );
        if (items.length > 0) entry.level1 = items;
      }
      normalized.push(entry);
    }
  }
  return normalized;
}

function DirectoriesModal({
  target,
  onClose,
}: {
  target: { serverId: string; label: string } | null;
  onClose: () => void;
}) {
  const isOpen = target !== null;
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50"
    >
      <Modal className="outline-none w-full max-w-2xl">
        <PrimitiveDialog className="relative outline-none rounded-xl bg-bg shadow-2xl border border-border/50 p-5 space-y-4 max-h-[85vh] overflow-y-auto">
          {target && (
            <DirectoriesModalBody target={target} onClose={onClose} />
          )}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

function DirectoriesModalBody({
  target,
  onClose,
}: {
  target: { serverId: string; label: string };
  onClose: () => void;
}) {
  const dateFormat = useDateFormatStore((s) => s.format);
  const url = `/api/servers/${encodeURIComponent(target.serverId)}/directories`;
  const { data, mutate, isLoading } = useSWR<DirectoriesResponse>(url, fetcher);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedAdv, setExpandedAdv] = useState<Set<number>>(new Set());
  const [level1Drafts, setLevel1Drafts] = useState<Map<number, string>>(
    new Map(),
  );
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current || !data) return;
    const initial = normalizeEntries(data.directories);
    setEntries(initial);
    setJsonText(entriesToJson(initial));
    setExpandedAdv(advancedEntryIndexes(initial));
    seededRef.current = true;
  }, [data]);

  const updatePath = (idx: number, path: string) => {
    setEntries((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], path };
      return next;
    });
  };

  const updateLevel = (idx: number, raw: string) => {
    setEntries((prev) => {
      const next = [...prev];
      if (raw.trim() === "") {
        const copy = { ...next[idx] };
        delete copy.level;
        next[idx] = copy;
      } else {
        const n = Number.parseInt(raw, 10);
        if (Number.isInteger(n) && n >= 1) {
          next[idx] = { ...next[idx], level: n };
        }
      }
      return next;
    });
  };

  const updateLevel1 = (idx: number, raw: string) => {
    setLevel1Drafts((prev) => {
      const next = new Map(prev);
      next.set(idx, raw);
      return next;
    });
    setEntries((prev) => {
      const next = [...prev];
      const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length === 0) {
        const copy = { ...next[idx] };
        delete copy.level1;
        next[idx] = copy;
      } else {
        next[idx] = { ...next[idx], level1: parts };
      }
      return next;
    });
  };

  const toggleAdv = (idx: number) => {
    setExpandedAdv((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const resetDrafts = () => {
    setLevel1Drafts(new Map());
  };

  const removeRow = (idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
    setExpandedAdv(new Set());
    resetDrafts();
  };

  const addRow = () => {
    setEntries((prev) => [...prev, { path: "" }]);
  };

  const switchToForm = () => {
    if (mode === "form") return;
    try {
      const next = parseJsonEntries(jsonText);
      setEntries(next);
      setExpandedAdv(advancedEntryIndexes(next));
      setJsonError(null);
      resetDrafts();
      setMode("form");
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const switchToJson = () => {
    if (mode === "json") return;
    setJsonText(entriesToJson(entries));
    setJsonError(null);
    setMode("json");
  };

  const loadHistorical = (snapshot: Array<DirEntry | string>) => {
    const normalized = normalizeEntries(snapshot);
    setEntries(normalized);
    setJsonText(entriesToJson(normalized));
    setExpandedAdv(advancedEntryIndexes(normalized));
    setJsonError(null);
    resetDrafts();
    setMode("form");
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);

    let payload: DirEntry[];
    if (mode === "json") {
      try {
        payload = parseJsonEntries(jsonText);
        setEntries(payload);
        setExpandedAdv(advancedEntryIndexes(payload));
        setJsonError(null);
        resetDrafts();
      } catch (e) {
        setJsonError(e instanceof Error ? e.message : "Invalid JSON");
        setSaving(false);
        return;
      }
    } else {
      payload = entries;
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directories: payload.filter((e) => e.path.trim()),
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      await mutate();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const history = data?.history ?? [];

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Workspace directories</h2>
          <p className="text-xs text-muted-fg">
            For server <span className="font-mono">{target.label}</span>. Overrides the
            top-level Portal directories when this server is active.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-muted-fg hover:bg-muted/40 hover:text-fg"
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>

      {isLoading && <p className="text-sm text-muted-fg">Loading…</p>}

      {!isLoading && (
        <div className="space-y-3">
          <div
            role="tablist"
            aria-label="Directories editor mode"
            className="flex border-b border-border/60"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "form"}
              onClick={switchToForm}
              className={
                mode === "form"
                  ? "px-3 py-1.5 text-xs font-medium border-b-2 border-primary text-fg -mb-px"
                  : "px-3 py-1.5 text-xs font-medium border-b-2 border-transparent text-muted-fg hover:text-fg"
              }
            >
              Form
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "json"}
              onClick={switchToJson}
              className={
                mode === "json"
                  ? "px-3 py-1.5 text-xs font-medium border-b-2 border-primary text-fg -mb-px"
                  : "px-3 py-1.5 text-xs font-medium border-b-2 border-transparent text-muted-fg hover:text-fg"
              }
            >
              JSON
            </button>
          </div>

          {jsonError && mode === "json" && (
            <p className="text-xs text-warning">JSON error: {jsonError}</p>
          )}

          {mode === "form" && (
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-muted-fg">
                Paths
              </label>
              {entries.length === 0 && (
                <p className="text-xs text-muted-fg italic">
                  No directories configured. The top-level Portal fallback will apply.
                </p>
              )}
              {entries.map((e, idx) => {
                const isExpanded = expandedAdv.has(idx);
                const hasAdv =
                  typeof e.level === "number" ||
                  (e.level1 !== undefined && e.level1.length > 0);
                const level1DisplayValue =
                  level1Drafts.get(idx) ?? (e.level1 ?? []).join(", ");
                return (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={e.path}
                        onChange={(ev) => updatePath(idx, ev.target.value)}
                        placeholder="/absolute/path or ~/relative"
                        className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm font-mono outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => toggleAdv(idx)}
                        className={
                          isExpanded
                            ? "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-primary/15 text-primary"
                            : hasAdv
                              ? "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-muted/40 text-fg hover:bg-muted/60"
                              : "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-fg hover:bg-muted/30 hover:text-fg"
                        }
                        title="Toggle level / level1 advanced fields"
                        aria-label={
                          isExpanded
                            ? "Hide advanced fields"
                            : "Show advanced fields"
                        }
                        aria-expanded={isExpanded}
                      >
                        adv{hasAdv ? "*" : ""}
                      </button>
                      <Button
                        size="sm"
                        intent="secondary"
                        onPress={() => removeRow(idx)}
                        aria-label="Remove path"
                      >
                        <XMarkIcon className="size-3.5" />
                      </Button>
                    </div>
                    {isExpanded && (
                      <div className="ml-2 rounded-md border border-border/40 bg-muted/5 p-2 space-y-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor={`dir-${idx}-level`}
                            className="w-14 shrink-0 text-muted-fg"
                          >
                            level
                          </label>
                          <input
                            id={`dir-${idx}-level`}
                            type="number"
                            min={1}
                            step={1}
                            value={
                              typeof e.level === "number" ? String(e.level) : ""
                            }
                            onChange={(ev) => updateLevel(idx, ev.target.value)}
                            placeholder="(default: 1)"
                            className="w-24 rounded border border-border bg-bg px-2 py-0.5 font-mono outline-none focus:border-primary"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor={`dir-${idx}-level1`}
                            className="w-14 shrink-0 text-muted-fg"
                          >
                            level1
                          </label>
                          <input
                            id={`dir-${idx}-level1`}
                            type="text"
                            value={level1DisplayValue}
                            onChange={(ev) =>
                              updateLevel1(idx, ev.target.value)
                            }
                            placeholder="comma-separated, e.g. ai-workspace, dreamhost-ai-configuration"
                            className="flex-1 rounded border border-border bg-bg px-2 py-0.5 font-mono outline-none focus:border-primary"
                          />
                        </div>
                        <p className="text-[10px] text-muted-fg">
                          <code className="font-mono">level</code>: how many
                          folders deep to expand this base path
                          (default&nbsp;
                          <code className="font-mono">1</code>).{" "}
                          <code className="font-mono">level1</code>: explicit list
                          of sub-folder names to include at the first level
                          (overrides auto-expansion). Both are optional.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
              <Button size="sm" intent="secondary" onPress={addRow}>
                <PlusIcon className="size-3.5" />
                Add path
              </Button>
            </div>
          )}

          {mode === "json" && (
            <div className="space-y-2">
              <textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  if (jsonError) setJsonError(null);
                }}
                spellCheck={false}
                rows={10}
                className="w-full rounded-md border border-border bg-muted/10 px-2 py-1 text-xs font-mono outline-none focus:border-primary"
              />
              <p className="text-[10px] text-muted-fg">
                Raw JSON for the directories array. Each entry is either a bare
                path string or an object{" "}
                <code className="font-mono">
                  {"{ path, level?, level1? }"}
                </code>
                . Switching to the Form tab parses this content; Save commits
                whatever is shown here.
              </p>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-fg hover:text-fg underline underline-offset-2"
          >
            <ClockIcon className="size-3.5" />
            {showHistory ? "Hide" : "Show"} history ({history.length})
          </button>
          {showHistory && (
            <ul className="space-y-1 max-h-40 overflow-y-auto rounded-md border border-border/50 bg-muted/5 p-2 text-xs">
              {history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => loadHistorical(h.directories)}
                    className="rounded p-0.5 text-muted-fg hover:bg-muted/40 hover:text-fg"
                    aria-label="Restore this snapshot"
                    title="Restore this snapshot"
                  >
                    <ArrowPathIcon className="size-3.5" />
                  </button>
                  <span className="text-muted-fg whitespace-nowrap">
                    {formatFullDateTime(h.at, dateFormat)}
                  </span>
                  <span className="font-mono text-muted-fg/70 truncate">
                    {normalizeEntries(h.directories)
                      .map((e) => e.path)
                      .join(", ") || "(empty)"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {saveError && (
        <div className="rounded-md bg-danger-subtle p-2 text-xs text-danger-subtle-fg">
          {saveError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button intent="secondary" onPress={onClose} isDisabled={saving}>
          Cancel
        </Button>
        <Button intent="primary" onPress={save} isDisabled={saving || isLoading}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </>
  );
}
