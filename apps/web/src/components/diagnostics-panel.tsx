import * as React from "react";
import useSWR from "swr";
import {
  useInstances,
  usePortalConfig,
  useProjectPaths,
  useProviders,
  useSelfInstance,
  useSessions,
  useQuestions,
} from "@/hooks/use-opencode";
import { PageTitle, SectionTitle } from "@/components/ui/typography";
import { useTheme } from "@/providers/theme-provider";
import { useAccentStore } from "@/stores/accent-store";
import { useDateFormatStore } from "@/stores/date-format-store";
import { useFontSizeStore } from "@/stores/font-size-store";
import { useThinkingStore } from "@/stores/thinking-store";
import { useComposerStore } from "@/stores/composer-store";
import type { Session } from "@opencode-ai/sdk";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};

interface RawProviderConfig {
  id: string;
  name?: string;
  models?: Record<string, { id: string; name?: string }>;
}

interface DiagnosticsResponse {
  process: {
    pid: number | null;
    uptimeSeconds: number | null;
    nodeVersion: string | null;
    bunVersion: string | null;
    platform: string | null;
  };
  os: { hostname: string; type: string; release: string };
  stateFiles: Record<
    string,
    { path: string; exists: boolean; bytes: number | null }
  >;
}

interface InstanceSummary {
  id: string;
  name: string;
  directory: string;
  port: number;
  webPort: number | null;
  hostname: string;
  startedAt: string;
}

function formatUptime(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// SectionHeader and Row both render flat children of a single outer grid
// declared on DiagnosticsPanel. That makes the label column (col 1) auto-
// size to the LONGEST label across every section, not just within one
// section, so labels in adjacent sections stack on the same x-coordinate.
// Using one grid + col-span-2 headers is simpler than per-section subgrid
// and works in every modern browser.
function SectionHeader({ title }: { title: string }) {
  return (
    <SectionTitle as="h3" className="col-span-2 pt-4 first:pt-0">
      {title}
    </SectionTitle>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-fg">{label}</dt>
      <dd className="font-mono text-xs sm:text-sm break-all">{children}</dd>
    </>
  );
}

export function DiagnosticsPanel() {
  const self = useSelfInstance();
  const portalConfig = usePortalConfig();
  const projectPaths = useProjectPaths();
  const providers = useProviders();
  const sessions = useSessions();
  const questions = useQuestions();
  const instances = useInstances();
  const diagnostics = useSWR<DiagnosticsResponse>(
    "/api/diagnostics",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );

  const { theme, fontFamily } = useTheme();
  const accent = useAccentStore((s) => s.accentColor);
  const fontScale = useFontSizeStore((s) => s.scale);
  const dateFormat = useDateFormatStore((s) => s.format);
  const globalThinking = useThinkingStore((s) => s.defaultEffort);
  const enterKeyAction = useComposerStore((s) => s.enterKeyAction);

  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const selfInstance = self.data?.instance ?? null;
  const sessionList: Session[] = sessions.data ?? [];
  const archivedCount = sessionList.filter(
    (s) => "directory" in s && (s as Session & { time?: { archived?: number } }).time?.archived,
  ).length;
  const activeSessionCount = sessionList.length - archivedCount;

  const rawProviders = providers.data as
    | { providers?: RawProviderConfig[] }
    | RawProviderConfig[]
    | null
    | undefined;
  const providerList: RawProviderConfig[] = Array.isArray(rawProviders)
    ? rawProviders
    : Array.isArray(rawProviders?.providers)
      ? rawProviders.providers
      : [];
  const totalModels = providerList.reduce(
    (sum, p) => sum + Object.keys(p.models ?? {}).length,
    0,
  );

  const otherInstances: InstanceSummary[] = (
    (instances.data?.instances ?? []) as InstanceSummary[]
  ).filter((inst) => inst.id !== selfInstance?.id);

  const baseDirs = portalConfig.data?.baseDirs ?? [];
  const configDrops = portalConfig.data?.drops ?? [];
  const projectErrors = projectPaths.data?.errors ?? [];
  const discoveredProjects = projectPaths.data?.paths ?? [];

  const viewport =
    typeof window !== "undefined"
      ? `${window.innerWidth}×${window.innerHeight}`
      : "—";
  const dpr =
    typeof window !== "undefined" ? window.devicePixelRatio.toFixed(2) : "—";
  const userAgent =
    typeof navigator !== "undefined" ? navigator.userAgent : "—";
  const language =
    typeof navigator !== "undefined" ? navigator.language : "—";
  const onlineState =
    typeof navigator !== "undefined"
      ? navigator.onLine
        ? "online"
        : "offline"
      : "—";

  const stateFiles = diagnostics.data?.stateFiles ?? {};
  const uptimeBase = diagnostics.data?.process.uptimeSeconds ?? null;
  const uptimeFetchedAt = React.useRef<number>(now);
  React.useEffect(() => {
    if (diagnostics.data) uptimeFetchedAt.current = Date.now();
  }, [diagnostics.data]);
  const uptimeNow =
    uptimeBase === null
      ? null
      : uptimeBase + Math.floor((now - uptimeFetchedAt.current) / 1000);

  return (
    <div className="space-y-4">
      <div>
        <PageTitle as="h2">Diagnostics</PageTitle>
        <p className="text-sm text-muted-fg">
          Read-only snapshot of this Portal, its workspace, the connected
          opencode instance, and your client.
        </p>
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
        <SectionHeader title="This Portal" />
        <Row label="Instance ID">{selfInstance?.id ?? "—"}</Row>
        <Row label="Name">{selfInstance?.name ?? "—"}</Row>
        <Row label="Web port">{selfInstance?.port ?? "—"}</Row>
        <Row label="opencode port">{selfInstance?.port ?? "—"}</Row>
        <Row label="Hostname">
          {selfInstance?.hostname ?? diagnostics.data?.os.hostname ?? "—"}
        </Row>
        <Row label="Directory">{selfInstance?.directory ?? "—"}</Row>
        <Row label="PID">{diagnostics.data?.process.pid ?? "—"}</Row>
        <Row label="Uptime">{formatUptime(uptimeNow)}</Row>
        <Row label="Runtime">
          {diagnostics.data?.process.bunVersion
            ? `Bun ${diagnostics.data.process.bunVersion}`
            : diagnostics.data?.process.nodeVersion
              ? `Node ${diagnostics.data.process.nodeVersion}`
              : "—"}
        </Row>
        <Row label="Platform">
          {diagnostics.data?.process.platform ?? "—"}{" "}
          {diagnostics.data
            ? `(${diagnostics.data.os.type} ${diagnostics.data.os.release})`
            : ""}
        </Row>

        <SectionHeader title="Workspace" />
        <Row label="Home">{portalConfig.data?.home ?? "—"}</Row>
        <Row label="Base dirs">
          {baseDirs.length === 0 ? (
            "—"
          ) : (
            <ul className="space-y-0.5">
              {baseDirs.map((b) => (
                <li key={b.path}>
                  {b.path}{" "}
                  <span className="text-muted-fg">
                    (level {b.level}
                    {b.level1.length > 0
                      ? `, level1: ${b.level1.join(", ")}`
                      : ""}
                    )
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row label="Projects discovered">{discoveredProjects.length}</Row>
        {projectErrors.length > 0 && (
          <Row label="Scan errors">
            <ul className="space-y-0.5 text-danger">
              {projectErrors.map((e) => (
                <li key={e.base}>
                  {e.base}: {e.error}
                </li>
              ))}
            </ul>
          </Row>
        )}
        {configDrops.length > 0 && (
          <Row label="Config warnings">
            <ul className="space-y-0.5 text-warning">
              {configDrops.map((d) => (
                <li key={d.path}>
                  {d.path}: {d.reason}
                </li>
              ))}
            </ul>
          </Row>
        )}

        <SectionHeader title="opencode" />
        <Row label="Providers">
          {providers.isLoading ? "loading…" : providerList.length}
        </Row>
        <Row label="Models">
          {providers.isLoading ? "loading…" : totalModels}
        </Row>
        <Row label="Active sessions">
          {sessions.isLoading ? "loading…" : activeSessionCount}
        </Row>
        <Row label="Archived sessions">
          {sessions.isLoading ? "loading…" : archivedCount}
        </Row>
        <Row label="Pending questions">
          {questions.isLoading ? "loading…" : (questions.data?.length ?? 0)}
        </Row>

        {otherInstances.length > 0 && (
          <>
            <SectionHeader title="Other Portals on host" />
            {otherInstances.map((inst) => (
              <Row key={inst.id} label={inst.name}>
                {inst.directory} (web:{inst.webPort ?? "—"} oc:{inst.port})
              </Row>
            ))}
          </>
        )}

        <SectionHeader title="State files" />
        {Object.entries(stateFiles).map(([key, info]) => (
          <Row key={key} label={key}>
            {info.path}{" "}
            <span className="text-muted-fg">
              ({info.exists ? formatBytes(info.bytes) : "missing"})
            </span>
          </Row>
        ))}

        <SectionHeader title="Client preferences" />
        <Row label="Theme">{theme}</Row>
        <Row label="Accent">{accent}</Row>
        <Row label="Font family">{fontFamily}</Row>
        <Row label="Font scale">{fontScale.toFixed(2)}×</Row>
        <Row label="Date format">{dateFormat}</Row>
        <Row label="Default thinking">{globalThinking || "—"}</Row>
        <Row label="Enter key">{enterKeyAction}</Row>

        <SectionHeader title="Browser" />
        <Row label="User agent">{userAgent}</Row>
        <Row label="Language">{language}</Row>
        <Row label="Viewport">{viewport}</Row>
        <Row label="DPR">{dpr}</Row>
        <Row label="Network">{onlineState}</Row>
      </dl>
    </div>
  );
}
