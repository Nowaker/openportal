import { useState } from "react";
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
  ChevronRightIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useConfig } from "@/hooks/use-opencode";
import { useMcpStatus } from "@/hooks/use-mcp";
import { useInstanceStore } from "@/stores/instance-store";

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

interface OpencodeConfig {
  mcp?: Record<string, McpConfigEntry>;
}

interface McpConfigEntry {
  type?: "local" | "remote";
  enabled?: boolean;
  command?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

function Body({
  mcpName,
  onClose,
}: {
  mcpName: string;
  onClose: () => void;
}) {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const { data: status } = useMcpStatus();
  const { data: config } = useConfig();
  const {
    data: response,
    error: detailsError,
    mutate: revalidateDetails,
  } = useMcpDetails(mcpName);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const details = response?.details;
  const refreshing = response?.refreshing ?? false;
  const detailsLoading = !response || (response.details === null && refreshing);
  const cfg = (config as OpencodeConfig | undefined)?.mcp?.[mcpName];
  const stat = status?.[mcpName];
  const kind = stat?.status ?? "unknown";

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
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
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

        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-fg">Status</dt>
          <dd className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${statusDot(kind)}`}
              aria-hidden
            />
            {statusLabel(kind)}
          </dd>

          {cfg?.type && (
            <>
              <dt className="text-muted-fg">Type</dt>
              <dd>{cfg.type}</dd>
            </>
          )}

          {typeof cfg?.enabled === "boolean" && (
            <>
              <dt className="text-muted-fg">Config enabled</dt>
              <dd>{cfg.enabled ? "true" : "false"}</dd>
            </>
          )}

          {cfg?.url && (
            <>
              <dt className="text-muted-fg">URL</dt>
              <dd className="break-all font-mono text-xs">{cfg.url}</dd>
            </>
          )}

          {cfg?.command && cfg.command.length > 0 && (
            <>
              <dt className="text-muted-fg">Command</dt>
              <dd className="break-all font-mono text-xs">
                {cfg.command.join(" ")}
              </dd>
            </>
          )}

          {cfg?.headers && Object.keys(cfg.headers).length > 0 && (
            <>
              <dt className="self-start text-muted-fg">Headers</dt>
              <dd className="font-mono text-xs space-y-0.5">
                {Object.entries(cfg.headers).map(([k]) => (
                  <div key={k} className="break-all">
                    {k}: <span className="text-muted-fg">(set)</span>
                  </div>
                ))}
              </dd>
            </>
          )}

          {cfg?.env && Object.keys(cfg.env).length > 0 && (
            <>
              <dt className="self-start text-muted-fg">Env</dt>
              <dd className="font-mono text-xs space-y-0.5">
                {Object.entries(cfg.env).map(([k]) => (
                  <div key={k} className="break-all">
                    {k}: <span className="text-muted-fg">(set)</span>
                  </div>
                ))}
              </dd>
            </>
          )}
        </dl>

        {!cfg && (
          <p className="text-xs text-muted-fg">
            No config entry found for this MCP in opencode.json. Status comes
            from the running server only.
          </p>
        )}

        <div className="border-t border-border pt-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-fg mb-2">
            Tools
          </h3>
          {detailsLoading && (
            <p className="text-sm text-muted-fg">Introspecting MCP server\u2026</p>
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
      </div>
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
