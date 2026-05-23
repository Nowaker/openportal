import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useBreadcrumb } from "@/contexts/breadcrumb-context";

export const Route = createFileRoute("/_app/docs")({
  component: DocsPage,
});

function DocsPage() {
  const { setPageTitle } = useBreadcrumb();
  useEffect(() => {
    setPageTitle("Documentation");
    return () => setPageTitle(null);
  }, [setPageTitle]);

  return (
    <div className="-m-4 flex flex-1 flex-col min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 space-y-8 text-sm">
        <header className="space-y-2 border-b border-border pb-4">
          <h1 className="text-2xl font-semibold">OpenPortal documentation</h1>
          <p className="text-muted-fg">
            Reference for the indicators, badges, and visual cues that
            OpenPortal uses across the sidebar and chat surfaces.
          </p>
        </header>

        <BadgesSection />
        <DotsSection />
        <ConnectionStatesSection />
      </div>
    </div>
  );
}

function BadgesSection() {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Session status badges</h2>
        <p className="text-xs text-muted-fg">
          Coloured chip in the title bar of the active session. Surfaces
          the most actionable runtime state. Priority chain - the
          highest-priority badge wins; lower-priority badges never
          render even if their state also matches.
        </p>
      </div>
      <ul className="divide-y divide-border/40 rounded-md border border-border/60 overflow-hidden">
        <BadgeRow
          label="ERROR"
          className="bg-danger text-danger-fg"
          desc="The assistant's last turn ended with an error. Needs your attention - click to see the error block."
        />
        <BadgeRow
          label="STUCK"
          className="bg-danger text-danger-fg animate-pulse"
          desc="OpenPortal's stuck-detector probe reports the runner is wedged (no-runner, stale-stream, etc.). Sourced from the runtime probe, not the event stream, so it surfaces wedged sessions the event-stream-based busy signal would miss."
        />
        <BadgeRow
          label="QUESTION"
          className="bg-sky-500 text-white animate-pulse"
          desc="The assistant is asking you a question and is blocked on your answer. Scroll the chat - the question widget is somewhere in view."
        />
        <BadgeRow
          label="PERMISSION"
          className="bg-sky-500 text-white animate-pulse"
          desc="A tool is asking for permission to run. Look for the permission panel inline in the chat. Allow / Allow Always / Reject."
        />
        <BadgeRow
          label="COMPACTING"
          className="bg-violet-500 text-white animate-pulse"
          desc="OpenCode is summarising older history into a compaction block. Briefly blocks new prompts."
        />
        <BadgeRow
          label="TOOL: bash"
          className="bg-warning text-warning-fg animate-pulse"
          desc="The assistant is running a tool right now. Label shows the tool name (bash, edit, read, grep, glob, todowrite, task, etc.)."
        />
        <BadgeRow
          label="THINKING"
          className="bg-warning text-warning-fg animate-pulse"
          desc="The assistant is generating a response. Yellow pulse signals 'busy, not waiting on you'. Fires when either the event stream reports busy=true OR the stuck-detector verdict is in-progress, so the badge shows reliably even when opencode misses firing message.created."
        />
        <BadgeRow
          label="QUEUED"
          className="bg-muted text-muted-fg"
          desc="One or more prompts are sitting in OpenPortal's local queue, waiting for opencode to come back online. Will dispatch automatically once the connection recovers."
        />
      </ul>
    </section>
  );
}

function DotsSection() {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Sidebar status dots</h2>
        <p className="text-xs text-muted-fg">
          The small coloured dot to the left of every session row in
          the sidebar. Uses a different vocabulary than the title-bar
          badge - dots focus on signalling without text.
        </p>
      </div>
      <ul className="divide-y divide-border/40 rounded-md border border-border/60 overflow-hidden">
        <DotRow
          dotClassName="bg-red-500"
          pulse={false}
          desc="Session has an error. Either the session's own turn errored or one of its subagents errored (the parent inherits the dot)."
        />
        <DotRow
          dotClassName="bg-sky-500"
          pulse
          desc="AI is waiting for your answer to a question. Pulses because it actively blocks the session."
        />
        <DotRow
          dotClassName="bg-amber-500"
          pulse
          desc="Top-level session is running. Yellow pulse signals 'busy, will finish on its own'."
        />
        <DotRow
          dotClassName="bg-amber-600"
          pulse={false}
          desc="Top-level session is in a retry state (transient error, opencode is retrying). Yellow, no pulse so it visually settles vs. the active running pulse."
        />
        <DotRow
          dotClassName="bg-violet-500"
          pulse
          desc="A subagent is running, OR a subsession of this top-level session is running. Violet keeps the parent + child running state visually continuous."
        />
        <DotRow
          dotClassName="bg-violet-600"
          pulse={false}
          desc="Subagent in retry state. Same as amber-600 but for subagents."
        />
        <DotRow
          dotClassName="bg-violet-500"
          pulse={false}
          desc="Task complete - review needed. Violet steady (no pulse) means the session finished while you weren't looking; the dot clears the moment you open the session."
        />
        <DotRow
          dotClassName=""
          pulse={false}
          desc="Empty space (no dot). Session is idle and there's nothing to surface."
          empty
        />
      </ul>
      <p className="text-xs text-muted-fg">
        The sidebar also shows a pencil icon next to sessions with an
        unsent draft. Drafts persist per-session in localStorage and
        sync across tabs via BroadcastChannel.
      </p>
    </section>
  );
}

function ConnectionStatesSection() {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Top-of-page connection banners</h2>
        <p className="text-xs text-muted-fg">
          Banners rendered above the chat when something is degraded.
        </p>
      </div>
      <dl className="space-y-3 text-sm">
        <BannerEntry
          headline="OpenCode unreachable - retrying every 10s"
          intent="warning"
          desc="OpenPortal is up, but the bound opencode instance is reporting health=down. OpenPortal-owned data (prompts archive, server list, settings) keeps working. Live opencode reads (session messages, providers, agents) degrade. Auto-recovers when opencode comes back."
        />
        <BannerEntry
          headline="OpenPortal lost - reconnecting"
          intent="danger"
          desc="/api/instance/self itself stopped answering. Likely cause: portal restarted to ship code, transient network blip. Drafts and pasted images are safe in localStorage."
        />
        <BannerEntry
          headline="OpenPortal updated - reload to upgrade"
          intent="warning"
          desc="The backend has shipped a newer build than the one this browser tab loaded. Click Reload to pick it up. The old tab keeps working via the asset-fallback layer until you reload."
        />
        <BannerEntry
          headline="Notifications blocked"
          intent="warning"
          desc="You denied browser notifications earlier. Click the lock / tune icon in the address bar > Site settings > Notifications > Allow, then reload."
        />
      </dl>
    </section>
  );
}

function BadgeRow({
  label,
  className,
  desc,
}: {
  label: string;
  className: string;
  desc: string;
}) {
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <span
        className={`shrink-0 inline-flex items-center rounded px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide leading-4 whitespace-nowrap ${className}`}
      >
        {label}
      </span>
      <span className="text-xs text-fg/80 leading-relaxed">{desc}</span>
    </li>
  );
}

function DotRow({
  dotClassName,
  pulse,
  desc,
  empty,
}: {
  dotClassName: string;
  pulse: boolean;
  desc: string;
  empty?: boolean;
}) {
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <span className="shrink-0 size-4 inline-flex items-center justify-center">
        {empty ? (
          <span className="size-2 rounded-full border border-dashed border-border" aria-hidden />
        ) : pulse ? (
          <span className="relative flex size-2 shrink-0">
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${dotClassName.replace("500", "400").replace("600", "500")}`}
            />
            <span
              className={`relative inline-flex size-2 rounded-full ${dotClassName}`}
            />
          </span>
        ) : (
          <span className={`size-2 shrink-0 rounded-full ${dotClassName}`} />
        )}
      </span>
      <span className="text-xs text-fg/80 leading-relaxed">{desc}</span>
    </li>
  );
}

function BannerEntry({
  headline,
  intent,
  desc,
}: {
  headline: string;
  intent: "warning" | "danger";
  desc: string;
}) {
  const palette =
    intent === "danger"
      ? "border-danger/40 bg-danger-subtle/40 text-fg"
      : "border-warning/40 bg-warning-subtle text-warning-subtle-fg";
  return (
    <div className="space-y-1">
      <div
        className={`rounded-md border px-3 py-1.5 text-xs font-medium ${palette}`}
      >
        {headline}
      </div>
      <dd className="text-xs text-muted-fg pl-3">{desc}</dd>
    </div>
  );
}
