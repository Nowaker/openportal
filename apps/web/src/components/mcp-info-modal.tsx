import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  ChevronRightIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useMcpStatus } from "@/hooks/use-mcp";
import {
  useMcpConfig,
  useUpdateMcpEntry,
  useMarkMcpRestarted,
  type McpConfigEntry,
} from "@/hooks/use-mcp-config";
import { useInstanceStore } from "@/stores/instance-store";
import { McpJsonEditor } from "@/components/mcp-json-editor";

interface Props {
  isOpen: boolean;
  mcpName: string | null;
  onOpenChange: (open: boolean) => void;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface McpDetails {
  name: string;
  type: "local" | "remote" | "unknown";
  url?: string;
  command?: string[];
  status?: string;
  serverInfo?: { name?: string; version?: string };
  instructions?: string;
  tools?: McpTool[];
  toolsError?: string;
}

interface McpDetailsResponse {
  details: McpDetails | null;
  refreshing: boolean;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

function useMcpDetails(name: string | null) {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  return useSWR<McpDetailsResponse>(
    port && name
      ? `/api/opencode/${port}/mcp-details?name=${encodeURIComponent(name)}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      refreshInterval: (data) =>
        data && data.details === null ? 1500 : 0,
    },
  );
}

async function refreshMcpServerDetails(
  port: number | null,
  name: string,
): Promise<void> {
  if (!port) return;
  await fetch(`/api/opencode/${port}/mcp-details`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

interface ParsedParam {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  enumValues?: string[];
  defaultValue?: unknown;
}

function parseInputSchema(schema: unknown): ParsedParam[] {
  if (!schema || typeof schema !== "object") return [];
  const obj = schema as Record<string, unknown>;
  if (obj.type && obj.type !== "object") return [];
  const props = obj.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  const required = Array.isArray(obj.required)
    ? (obj.required as string[])
    : [];
  if (!props) return [];
  return Object.entries(props).map(([name, def]) => {
    const rawType = def.type;
    const typeStr = Array.isArray(rawType)
      ? rawType.join(" | ")
      : typeof rawType === "string"
        ? rawType
        : "any";
    return {
      name,
      type: typeStr,
      description:
        typeof def.description === "string" ? def.description : undefined,
      required: required.includes(name),
      enumValues: Array.isArray(def.enum) ? def.enum.map(String) : undefined,
      defaultValue: def.default,
    };
  });
}

function JsonNode({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}): React.ReactNode {
  const pad = "  ".repeat(depth);
  const padNext = "  ".repeat(depth + 1);
  if (value === null)
    return <span className="text-violet-400">null</span>;
  if (typeof value === "boolean")
    return <span className="text-violet-400">{String(value)}</span>;
  if (typeof value === "number")
    return <span className="text-amber-400">{value}</span>;
  if (typeof value === "string")
    return <span className="text-emerald-400">"{value}"</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span>[]</span>;
    return (
      <>
        [
        {value.map((v, i) => (
          <span key={i}>
            {"\n" + padNext}
            <JsonNode value={v} depth={depth + 1} />
            {i < value.length - 1 ? "," : ""}
          </span>
        ))}
        {"\n" + pad}]
      </>
    );
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span>{"{}"}</span>;
    return (
      <>
        {"{"}
        {entries.map(([k, v], i) => (
          <span key={k}>
            {"\n" + padNext}
            <span className="text-sky-400">"{k}"</span>
            <span>: </span>
            <JsonNode value={v} depth={depth + 1} />
            {i < entries.length - 1 ? "," : ""}
          </span>
        ))}
        {"\n" + pad}
        {"}"}
      </>
    );
  }
  return <span>{String(value)}</span>;
}

export function McpInfoModal({ isOpen, mcpName, onOpenChange }: Props) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm"
    >
      <Modal className="w-full max-w-xl max-h-[85dvh] flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col flex-1 min-h-0 outline-none">
          {({ close }) =>
            mcpName ? <Body mcpName={mcpName} onClose={close} /> : null
          }
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

function statusLabel(kind: string): string {
  switch (kind) {
    case "connected":
      return "Connected";
    case "disabled":
      return "Disabled";
    case "failed":
      return "Failed";
    case "needsAuth":
      return "Needs auth";
    case "needsClientRegistration":
      return "Needs client registration";
    default:
      return kind;
  }
}

function statusDot(kind: string): string {
  if (kind === "connected") return "bg-emerald-500";
  if (kind === "disabled") return "bg-muted-fg/40";
  if (kind === "failed") return "bg-red-500";
  if (kind === "needsAuth") return "bg-amber-500";
  if (kind === "needsClientRegistration") return "bg-red-600";
  return "bg-muted-fg";
}

// Three-step OAuth handshake for an MCP server in `needsAuth` state.
// Manual code paste because the OAuth provider's redirect lands on
// the user's browser machine, not on the host running opencode -
// localhost callback capture only works for the desktop client.
// Cross-component signal: the sidebar's MCP knob click on a `needsAuth`
// row sets this sessionStorage key before opening the info modal, so
// McpAuthSection knows to kick off the OAuth handshake automatically
// (one-click flow rather than knob -> modal -> Start OAuth handshake).
const AUTO_AUTH_KEY = "openportal-mcp-auto-auth";

// Match URLs like https://google-calendar-new.mcp.dh-int.com/sse/...
// DreamHost's MCP gateways use a custom path-token auth scheme (the
// trailing token in the SSE URL is what expires). Re-auth is done via
// <origin>/auth/google which redirects to Google OAuth and returns a
// new SSE URL the user pastes back here. Opencode's generic
// /mcp/<name>/auth endpoint doesn't know this flow so we fall back to
// it when opencode returns UnknownError on a dh-int.com host.
function deriveDhAuthUrl(mcpUrl: string | undefined): string | null {
  if (!mcpUrl) return null;
  try {
    const u = new URL(mcpUrl);
    if (!u.hostname.endsWith(".mcp.dh-int.com")) return null;
    return `${u.origin}/auth/google`;
  } catch {
    return null;
  }
}

function McpAuthSection({
  mcpName,
  port,
  mcpUrl,
  currentEntry,
}: {
  mcpName: string;
  port: number | null;
  mcpUrl?: string;
  currentEntry: McpConfigEntry | null;
}) {
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [dhNewUrl, setDhNewUrl] = useState("");
  const [dhSaving, setDhSaving] = useState(false);
  const [dhSaved, setDhSaved] = useState(false);
  const { mutate: revalidateStatus } = useMcpStatus();
  const updateEntry = useUpdateMcpEntry();
  const dhAuthUrl = deriveDhAuthUrl(mcpUrl);

  useEffect(() => {
    try {
      const auto = sessionStorage.getItem(AUTO_AUTH_KEY);
      if (auto === mcpName) {
        sessionStorage.removeItem(AUTO_AUTH_KEY);
        if (dhAuthUrl) {
          window.open(dhAuthUrl, "_blank", "noopener,noreferrer,popup=yes");
        } else if (port && !authUrl && !success && !busy) {
          void startFlow();
        }
      }
    } catch {
      // sessionStorage can throw in some sandboxed contexts; just no-op
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcpName, port, dhAuthUrl]);

  const saveDhUrl = async () => {
    const trimmed = dhNewUrl.trim();
    if (!trimmed || !currentEntry) return;
    setDhSaving(true);
    setError(null);
    try {
      await updateEntry(mcpName, { ...currentEntry, url: trimmed });
      setDhSaved(true);
      setDhNewUrl("");
      await revalidateStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setDhSaving(false);
    }
  };

  const startFlow = async () => {
    if (!port) return;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const r = await fetch(`/api/opencode/${port}/mcp-auth-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: mcpName }),
      });
      const json = (await r.json()) as {
        ok: boolean;
        authorizationUrl?: string;
        error?: string;
      };
      if (!r.ok || !json.ok || !json.authorizationUrl) {
        setError(json.error ?? `start failed (HTTP ${r.status})`);
      } else {
        setAuthUrl(json.authorizationUrl);
        window.open(
          json.authorizationUrl,
          "_blank",
          "noopener,noreferrer,popup=yes",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    if (!port) return;
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/opencode/${port}/mcp-auth-callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: mcpName, code: trimmed }),
      });
      const json = (await r.json()) as {
        ok: boolean;
        error?: string;
        body?: unknown;
      };
      if (!r.ok || !json.ok) {
        setError(
          (typeof json.body === "object" &&
            json.body &&
            "message" in (json.body as object) &&
            String((json.body as { message?: unknown }).message)) ||
            json.error ||
            `callback failed (HTTP ${r.status})`,
        );
      } else {
        setSuccess(true);
        setCode("");
        setAuthUrl(null);
        await revalidateStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  if (dhAuthUrl) {
    return (
      <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
          DreamHost re-authentication required
        </div>
        {!dhSaved && (
          <>
            <p className="text-sm text-fg/90">
              The session token in this MCP's SSE URL has expired. Re-authenticate
              at DreamHost to get a fresh URL, then paste it below and save.
            </p>
            <a
              href={dhAuthUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent/90"
              data-test="portal-mcp-dh-auth-open"
            >
              Re-authenticate at DreamHost
            </a>
            <div className="text-[10px] text-muted-fg break-all">
              Opens <code className="text-xs">{dhAuthUrl}</code> in a new tab.
              After Google sign-in, DreamHost shows you a new SSE URL.
            </div>
            <div className="space-y-2 pt-1">
              <label className="block text-[11px] font-medium uppercase tracking-wide text-muted-fg">
                New SSE URL
              </label>
              <textarea
                value={dhNewUrl}
                onChange={(e) => setDhNewUrl(e.target.value)}
                placeholder={mcpUrl ?? "https://...mcp.dh-int.com/sse/<email>/<new-token>"}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                rows={3}
                className="w-full rounded-md border border-border bg-bg p-2 font-mono text-[11px] outline-none focus:border-primary break-all"
                data-test="portal-mcp-dh-new-url"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void saveDhUrl()}
                  disabled={dhSaving || !dhNewUrl.trim() || !currentEntry}
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent/90 disabled:opacity-50"
                  data-test="portal-mcp-dh-save"
                >
                  {dhSaving ? "Saving..." : "Save new URL"}
                </button>
              </div>
            </div>
          </>
        )}
        {dhSaved && (
          <>
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              New URL saved to <code>~/.config/opencode/opencode.json</code>.
              Restart opencode (top of modal) for the change to take effect.
            </p>
          </>
        )}
        {error && (
          <p className="text-sm text-danger break-words">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        OAuth handshake required
      </div>
      {!authUrl && !success && (
        <>
          <p className="text-sm text-fg/90">
            This MCP server needs OAuth credentials before it can connect.
            Start the handshake to open the provider's login page.
          </p>
          <button
            type="button"
            onClick={() => void startFlow()}
            disabled={busy || !port}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent/90 disabled:opacity-50"
            data-test="portal-mcp-auth-start"
          >
            Start OAuth handshake
          </button>
        </>
      )}
      {authUrl && !success && (
        <>
          <p className="text-sm text-fg/90">
            A new tab should have opened at the OAuth provider. After you log
            in, the provider redirects with{" "}
            <code className="text-xs">?code=...</code> in the URL. Copy that
            code and paste it below.
          </p>
          <div className="text-xs">
            <span className="text-muted-fg">Auth URL: </span>
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-accent underline"
            >
              {authUrl}
            </a>
          </div>
          <div className="flex flex-wrap items-stretch gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="paste authorization code"
              className="flex-1 min-w-0 rounded-md border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              data-test="portal-mcp-auth-code"
            />
            <button
              type="button"
              onClick={() => void submitCode()}
              disabled={busy || !code.trim()}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent/90 disabled:opacity-50"
              data-test="portal-mcp-auth-submit"
            >
              Submit code
            </button>
          </div>
        </>
      )}
      {success && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          Auth completed. The server should connect on its own; if not, toggle
          its switch in the hamburger menu.
        </p>
      )}
      {error && (
        <p className="text-sm text-danger break-words">{error}</p>
      )}
    </div>
  );
}

type Tab = "view" | "json";

function Body({
  mcpName,
  onClose,
}: {
  mcpName: string;
  onClose: () => void;
}) {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const { data: status } = useMcpStatus();
  const { data: mcpConfigData, isLoading: configLoading } = useMcpConfig();
  const updateEntry = useUpdateMcpEntry();
  const markRestarted = useMarkMcpRestarted();
  const {
    data: response,
    error: detailsError,
    mutate: revalidateDetails,
  } = useMcpDetails(mcpName);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("view");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<McpConfigEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  const details = response?.details;
  const refreshing = response?.refreshing ?? false;
  const detailsLoading = !response || (response.details === null && refreshing);

  const currentEntry: McpConfigEntry | null =
    (mcpConfigData?.current?.[mcpName] as McpConfigEntry | undefined) ?? null;
  const activeEntry: McpConfigEntry | null =
    (mcpConfigData?.active?.[mcpName] as McpConfigEntry | undefined) ?? null;
  const isPendingThis = Boolean(
    mcpConfigData &&
      (mcpConfigData.diff.modified.includes(mcpName) ||
        mcpConfigData.diff.added.includes(mcpName) ||
        mcpConfigData.diff.removed.includes(mcpName)),
  );
  const globalPending = mcpConfigData?.pending ?? false;

  const stat = status?.[mcpName];
  const kind = stat?.status ?? "unknown";

  useEffect(() => {
    if (!editing) {
      setDraft(null);
      setSaveError(null);
    }
  }, [editing, mcpName]);

  const startEdit = () => {
    const seed: McpConfigEntry = currentEntry
      ? JSON.parse(JSON.stringify(currentEntry))
      : { type: "remote", enabled: true };
    setDraft(seed);
    setEditing(true);
    setSaveError(null);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateEntry(mcpName, draft);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const revertToActive = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateEntry(mcpName, activeEntry);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const restart = async () => {
    if (
      !window.confirm(
        "Restart opencode to apply MCP changes? In-flight tool calls will be interrupted.",
      )
    ) {
      return;
    }
    setRestarting(true);
    setRestartError(null);
    try {
      const r = await fetch("/api/servers/restart-opencode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}: ${txt}`);
      }
      await markRestarted();
    } catch (err) {
      setRestartError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestarting(false);
    }
  };

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    try {
      await refreshMcpServerDetails(port, mcpName);
      await revalidateDetails();
    } finally {
      setManualRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="shrink-0 flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="flex-1 min-w-0 truncate text-sm font-semibold">
          {mcpName}
        </h2>
        {isPendingThis && (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400"
            title="Config on disk differs from what opencode is running. Restart to apply."
          >
            Pending restart
          </span>
        )}
        {globalPending && (
          <button
            type="button"
            onClick={() => void restart()}
            disabled={restarting}
            title="Restart opencode so the latest config takes effect"
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-emerald-500/60 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <ArrowPathIcon
              className={`size-3.5 ${restarting ? "animate-spin" : ""}`}
            />
            {restarting ? "Restarting..." : "Restart opencode"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleManualRefresh()}
          disabled={manualRefreshing}
          aria-label="Refresh introspection"
          title="Re-introspect this MCP server"
          className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg disabled:opacity-40"
        >
          <ArrowPathIcon
            className={`size-4 ${manualRefreshing ? "animate-spin" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
        >
          <XMarkIcon className="size-4" />
        </button>
      </header>

      {restartError && (
        <div className="shrink-0 border-b border-border bg-red-500/10 px-4 py-2 text-xs text-danger break-words">
          Restart failed: {restartError}
        </div>
      )}

      <div className="shrink-0 flex items-center gap-1 border-b border-border px-4 text-xs">
        <TabButton active={tab === "view"} onClick={() => setTab("view")}>
          View
        </TabButton>
        <TabButton active={tab === "json"} onClick={() => setTab("json")}>
          JSON
        </TabButton>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
        {configLoading && !mcpConfigData ? (
          <div className="flex items-center justify-center py-8 text-muted-fg">
            <ArrowPathIcon className="size-5 animate-spin" />
          </div>
        ) : tab === "view" ? (
          <>
            {details?.serverInfo && (
              <div className="text-sm">
                <span className="font-medium">
                  {details.serverInfo.name ?? mcpName}
                </span>
                {details.serverInfo.version && (
                  <span className="ml-2 text-muted-fg">
                    v{details.serverInfo.version}
                  </span>
                )}
              </div>
            )}

            {details?.instructions && (
              <div className="text-sm text-fg/90 whitespace-pre-wrap">
                {details.instructions}
              </div>
            )}

            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-fg">Status</span>
              <span
                className={`size-2 rounded-full ${statusDot(kind)}`}
                aria-hidden
              />
              <span>{statusLabel(kind)}</span>
            </div>

            {editing && draft ? (
              <EditForm
                draft={draft}
                setDraft={setDraft}
                onSave={() => void saveDraft()}
                onCancel={cancelEdit}
                saving={saving}
                error={saveError}
              />
            ) : (
              <PrettyView
                cfg={currentEntry}
                onEdit={startEdit}
                canEdit={Boolean(currentEntry)}
              />
            )}

            {isPendingThis && !editing && (
              <PendingDiffPanel
                active={activeEntry}
                current={currentEntry}
                onRevert={() => void revertToActive()}
                reverting={saving}
              />
            )}

            {kind === "needsAuth" && (
              <McpAuthSection
                mcpName={mcpName}
                port={port}
                mcpUrl={typeof currentEntry?.url === "string" ? currentEntry.url : undefined}
                currentEntry={currentEntry}
              />
            )}

            <div className="border-t border-border pt-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-fg mb-2">
                Tools
              </h3>
              {detailsLoading && (
                <p className="text-sm text-muted-fg">
                  Introspecting MCP server\u2026
                </p>
              )}
              {!detailsLoading && detailsError && (
                <p className="text-sm text-danger">
                  Failed to fetch:{" "}
                  {detailsError instanceof Error
                    ? detailsError.message
                    : String(detailsError)}
                </p>
              )}
              {!detailsLoading && details?.toolsError && (
                <p className="text-sm text-danger break-words">
                  {details.toolsError}
                </p>
              )}
              {!detailsLoading &&
                !details?.toolsError &&
                details?.tools &&
                details.tools.length === 0 && (
                  <p className="text-sm text-muted-fg">
                    No tools registered by this MCP server.
                  </p>
                )}
              {!detailsLoading &&
                details?.tools &&
                details.tools.length > 0 && (
                  <div className="space-y-2">
                    {details.tools.map((tool) => (
                      <ToolRow key={tool.name} tool={tool} />
                    ))}
                  </div>
                )}
            </div>
          </>
        ) : (
          <JsonTab
            mcpName={mcpName}
            currentEntry={currentEntry}
            activeEntry={activeEntry}
            isPendingThis={isPendingThis}
            onSave={async (entry) => {
              await updateEntry(mcpName, entry);
            }}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 font-medium transition-colors ${
        active
          ? "border-fg text-fg"
          : "border-transparent text-muted-fg hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function PrettyView({
  cfg,
  onEdit,
  canEdit,
}: {
  cfg: McpConfigEntry | null;
  onEdit: () => void;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-fg">
          Configuration
        </h3>
        <button
          type="button"
          onClick={onEdit}
          disabled={!canEdit}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
          data-test="portal-mcp-edit"
        >
          <PencilSquareIcon className="size-3.5" />
          Edit
        </button>
      </div>
      {!cfg ? (
        <p className="text-xs text-muted-fg">
          No config entry found in opencode.json. Status comes from the
          running server only.
        </p>
      ) : (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-sm">
          {cfg.type && (
            <>
              <dt className="text-muted-fg">Type</dt>
              <dd>{String(cfg.type)}</dd>
            </>
          )}
          {typeof cfg.enabled === "boolean" && (
            <>
              <dt className="text-muted-fg">Enabled</dt>
              <dd>{cfg.enabled ? "true" : "false"}</dd>
            </>
          )}
          {cfg.url && (
            <>
              <dt className="text-muted-fg">URL</dt>
              <dd className="break-all font-mono text-xs">{cfg.url}</dd>
            </>
          )}
          {cfg.command && cfg.command.length > 0 && (
            <>
              <dt className="text-muted-fg">Command</dt>
              <dd className="break-all font-mono text-xs">
                {cfg.command.join(" ")}
              </dd>
            </>
          )}
          {cfg.headers && Object.keys(cfg.headers).length > 0 && (
            <>
              <dt className="self-start text-muted-fg">Headers</dt>
              <dd className="font-mono text-xs space-y-0.5">
                {Object.entries(cfg.headers).map(([k, v]) => (
                  <div key={k} className="break-all">
                    {k}: <span className="text-muted-fg">{v}</span>
                  </div>
                ))}
              </dd>
            </>
          )}
          {((cfg.environment && Object.keys(cfg.environment).length > 0) ||
            (cfg.env && Object.keys(cfg.env).length > 0)) && (
            <>
              <dt className="self-start text-muted-fg">Environment</dt>
              <dd className="font-mono text-xs space-y-0.5">
                {Object.entries({
                  ...(cfg.environment ?? {}),
                  ...(cfg.env ?? {}),
                }).map(([k, v]) => (
                  <div key={k} className="break-all">
                    {k}: <span className="text-muted-fg">{v}</span>
                  </div>
                ))}
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

const KNOWN_TYPES = ["local", "remote"] as const;

function EditForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  saving,
  error,
}: {
  draft: McpConfigEntry;
  setDraft: (next: McpConfigEntry) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const setField = (k: keyof McpConfigEntry, v: unknown) =>
    setDraft({ ...draft, [k]: v });

  const currentType = typeof draft.type === "string" ? draft.type : "";
  const typeIsCustom = currentType && !KNOWN_TYPES.includes(currentType as "local" | "remote");

  const setCommand = (next: string[]) => setField("command", next);
  const command: string[] = Array.isArray(draft.command) ? draft.command : [];
  const envObj: Record<string, string> = useMemo(
    () => ({ ...(draft.environment ?? {}), ...(draft.env ?? {}) }),
    [draft.environment, draft.env],
  );
  const envEntries = Object.entries(envObj);

  const setEnv = (next: Record<string, string>) => {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(next)) {
      if (k.trim() !== "") cleaned[k] = v;
    }
    const merged: McpConfigEntry = { ...draft };
    delete merged.env;
    merged.environment = cleaned;
    setDraft(merged);
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-fg">
        Edit configuration
      </h3>

      <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-2.5 items-start">

      <Field label="Type">
        <div className="flex gap-1">
          <select
            value={typeIsCustom ? "__custom__" : currentType}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__custom__") {
                setField("type", "custom");
              } else {
                setField("type", v);
              }
            }}
            className="rounded-md border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-primary"
          >
            <option value="">(unset)</option>
            {KNOWN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value="__custom__">custom...</option>
          </select>
          {typeIsCustom && (
            <input
              type="text"
              value={currentType}
              onChange={(e) => setField("type", e.target.value)}
              placeholder="custom type"
              className="flex-1 min-w-0 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs outline-none focus:border-primary"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          )}
        </div>
      </Field>

      <Field label="Enabled">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={draft.enabled !== false}
            onChange={(e) => setField("enabled", e.target.checked)}
            className="size-4"
          />
          <span>{draft.enabled !== false ? "true" : "false"}</span>
        </label>
      </Field>

      <Field label="URL">
        <input
          type="text"
          value={typeof draft.url === "string" ? draft.url : ""}
          onChange={(e) => setField("url", e.target.value)}
          placeholder="https://..."
          className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs outline-none focus:border-primary"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <p className="mt-0.5 text-[10px] text-muted-fg">
          Used when type is "remote". Ignored for "local".
        </p>
      </Field>

      <Field label="Command (argv)">
        <div className="space-y-1">
          {command.map((arg, i) => (
            <div key={i} className="flex gap-1">
              <input
                type="text"
                value={arg}
                onChange={(e) => {
                  const next = [...command];
                  next[i] = e.target.value;
                  setCommand(next);
                }}
                className="flex-1 min-w-0 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs outline-none focus:border-primary"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button
                type="button"
                aria-label="Remove argument"
                onClick={() => {
                  const next = command.filter((_, j) => j !== i);
                  setCommand(next);
                }}
                className="shrink-0 rounded-md border border-border bg-bg p-1 text-muted-fg hover:bg-muted hover:text-fg"
              >
                <TrashIcon className="size-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setCommand([...command, ""])}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-fg hover:bg-muted hover:text-fg"
          >
            <PlusIcon className="size-3" />
            Add argument
          </button>
        </div>
        <p className="mt-0.5 text-[10px] text-muted-fg">
          Used when type is "local". Ignored for "remote".
        </p>
      </Field>

      <Field label="Environment">
        <div className="space-y-1">
          {envEntries.map(([k, v], i) => (
            <div key={`${i}-${k}`} className="flex gap-1">
              <input
                type="text"
                value={k}
                onChange={(e) => {
                  const next = { ...envObj };
                  delete next[k];
                  next[e.target.value] = v;
                  setEnv(next);
                }}
                placeholder="KEY"
                className="w-1/3 min-w-0 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs outline-none focus:border-primary"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <input
                type="text"
                value={v}
                onChange={(e) => {
                  const next = { ...envObj };
                  next[k] = e.target.value;
                  setEnv(next);
                }}
                placeholder="value"
                className="flex-1 min-w-0 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs outline-none focus:border-primary"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button
                type="button"
                aria-label={`Remove ${k}`}
                onClick={() => {
                  const next = { ...envObj };
                  delete next[k];
                  setEnv(next);
                }}
                className="shrink-0 rounded-md border border-border bg-bg p-1 text-muted-fg hover:bg-muted hover:text-fg"
              >
                <TrashIcon className="size-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setEnv({ ...envObj, "": "" })}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-fg hover:bg-muted hover:text-fg"
          >
            <PlusIcon className="size-3" />
            Add env var
          </button>
        </div>
      </Field>

      </div>

      {error && (
        <p className="text-xs text-danger break-words">{error}</p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-border bg-bg px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent/90 disabled:opacity-50"
          data-test="portal-mcp-save"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="text-xs font-medium text-muted-fg pt-1.5 whitespace-nowrap">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </>
  );
}

function PendingDiffPanel({
  active,
  current,
  onRevert,
  reverting,
}: {
  active: McpConfigEntry | null;
  current: McpConfigEntry | null;
  onRevert: () => void;
  reverting: boolean;
}) {
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
          Changes pending restart
        </h4>
        <button
          type="button"
          onClick={onRevert}
          disabled={reverting}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          title="Restore the configuration opencode is currently running"
        >
          <ArrowUturnLeftIcon className="size-3.5" />
          {reverting ? "Reverting..." : "Revert to active"}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <DiffColumn label="Active (running)" entry={active} />
        <DiffColumn label="Saved (pending)" entry={current} />
      </div>
    </div>
  );
}

function DiffColumn({
  label,
  entry,
}: {
  label: string;
  entry: McpConfigEntry | null;
}) {
  return (
    <div>
      <div className="text-muted-fg mb-1">{label}</div>
      <pre className="rounded-md border border-border/50 bg-bg/60 p-2 font-mono text-[11px] text-fg/80 overflow-x-auto whitespace-pre-wrap break-words leading-snug">
        {entry === null ? "(removed)" : <JsonNode value={entry} />}
      </pre>
    </div>
  );
}

function JsonTab({
  mcpName,
  currentEntry,
  activeEntry,
  isPendingThis,
  onSave,
}: {
  mcpName: string;
  currentEntry: McpConfigEntry | null;
  activeEntry: McpConfigEntry | null;
  isPendingThis: boolean;
  onSave: (entry: McpConfigEntry | null) => Promise<void>;
}) {
  const baseText = useMemo(
    () =>
      currentEntry === null
        ? "null"
        : JSON.stringify(currentEntry, null, 2),
    [currentEntry],
  );
  const [text, setText] = useState(baseText);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setText(baseText);
  }, [baseText, editing]);

  const startEdit = () => {
    setText(baseText);
    setEditing(true);
    setError(null);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
    setText(baseText);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const parsed: unknown =
        text.trim() === "" || text.trim() === "null"
          ? null
          : JSON.parse(text);
      if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) {
        throw new Error("MCP entry must be a JSON object (or null to delete)");
      }
      await onSave(parsed as McpConfigEntry | null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-fg">
          {editing ? "Editing JSON" : "JSON"}
          {isPendingThis && !editing && (
            <span className="ml-2 text-amber-600 dark:text-amber-400 normal-case">
              (saved, pending restart)
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1">
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              disabled={!currentEntry}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
              data-test="portal-mcp-json-edit"
            >
              <PencilSquareIcon className="size-3.5" />
              Edit JSON
            </button>
          )}
        </div>
      </div>

      {!editing ? (
        <pre className="rounded-md border border-border/50 bg-bg/60 p-3 font-mono text-[12px] text-fg/90 overflow-x-auto whitespace-pre leading-relaxed">
          <JsonNode value={currentEntry} />
        </pre>
      ) : (
        <>
          <McpJsonEditor
            value={text}
            onChange={setText}
            rows={Math.max(8, Math.min(24, text.split("\n").length + 1))}
          />
          <p className="text-[10px] text-muted-fg">
            Set to <code>null</code> to delete this MCP. Known type values:{" "}
            <code>"local"</code>, <code>"remote"</code>. Custom values are
            accepted - opencode validates at load.
            <br />
            <kbd>Ctrl+Space</kbd> triggers suggestions; suggestions also
            appear automatically while typing inside known fields. Use{" "}
            <kbd>Up</kbd>/<kbd>Down</kbd> to navigate,{" "}
            <kbd>Tab</kbd>/<kbd>Enter</kbd> to insert, <kbd>Esc</kbd> to
            dismiss.
          </p>
          {error && (
            <p className="text-xs text-danger break-words">{error}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="rounded-md border border-border bg-bg px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent/90 disabled:opacity-50"
              data-test="portal-mcp-json-save"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </>
      )}

      {isPendingThis && !editing && activeEntry && (
        <div className="border-t border-border pt-3 space-y-1">
          <h4 className="text-xs font-bold uppercase tracking-widest text-muted-fg">
            Active (running) JSON
          </h4>
          <pre className="rounded-md border border-border/50 bg-bg/60 p-3 font-mono text-[12px] text-fg/70 overflow-x-auto whitespace-pre leading-relaxed">
            <JsonNode value={activeEntry} />
          </pre>
        </div>
      )}

      <p className="text-[10px] text-muted-fg italic">
        Writes go to <code>~/.config/opencode/opencode.json</code> ({mcpName}).
        Restart opencode (top of modal) to apply.
      </p>
    </div>
  );
}

function ToolRow({ tool }: { tool: McpTool }) {
  const [schemaExpanded, setSchemaExpanded] = useState(false);
  const params = parseInputSchema(tool.inputSchema);
  const hasSchema =
    tool.inputSchema !== undefined &&
    tool.inputSchema !== null &&
    typeof tool.inputSchema === "object" &&
    Object.keys(tool.inputSchema as Record<string, unknown>).length > 0;
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 overflow-hidden">
      <div className="px-3 py-2 flex flex-col gap-1.5">
        <span className="font-mono text-sm">{tool.name}</span>
        {tool.description && (
          <div className="prose prose-sm dark:prose-invert max-w-none text-xs text-muted-fg [&_p]:my-1 [&_code]:text-[11px]">
            <Markdown remarkPlugins={[remarkGfm]}>{tool.description}</Markdown>
          </div>
        )}
        {params.length > 0 && (
          <ul className="mt-1 space-y-1 text-xs">
            {params.map((p) => (
              <li key={p.name} className="flex flex-col">
                <span>
                  <span className="font-mono text-fg">{p.name}</span>
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-fg">
                    {p.type}
                  </span>
                  {p.required && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-500">
                      required
                    </span>
                  )}
                  {p.enumValues && p.enumValues.length > 0 && (
                    <span className="ml-1.5 text-[10px] text-muted-fg">
                      one of [{p.enumValues.join(", ")}]
                    </span>
                  )}
                  {p.defaultValue !== undefined && (
                    <span className="ml-1.5 text-[10px] text-muted-fg">
                      default: {JSON.stringify(p.defaultValue)}
                    </span>
                  )}
                </span>
                {p.description && (
                  <span className="text-muted-fg leading-snug ml-0">
                    {p.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {params.length === 0 && !hasSchema && (
          <span className="text-[11px] text-muted-fg">No input parameters.</span>
        )}
        {hasSchema && (
          <button
            type="button"
            onClick={() => setSchemaExpanded((v) => !v)}
            className="self-start mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-fg hover:text-fg"
          >
            <ChevronRightIcon
              className={`size-3 transition-transform ${schemaExpanded ? "rotate-90" : ""}`}
            />
            {schemaExpanded ? "Hide" : "Show"} JSON schema
          </button>
        )}
      </div>
      {schemaExpanded && hasSchema && (
        <pre className="px-3 py-2 border-t border-border/50 bg-bg/40 font-mono text-[11px] text-fg/80 overflow-x-auto whitespace-pre leading-relaxed">
          <JsonNode value={tool.inputSchema} />
        </pre>
      )}
    </div>
  );
}
