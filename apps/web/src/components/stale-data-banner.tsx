import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import { useConnectionMonitor } from "@/hooks/use-connection-monitor";

interface StaleDataBannerProps {
  // Optional override for the headline copy. Defaults to a generic
  // "opencode unreachable, showing cached data" message. Pages that
  // want to spell out which view is cached (e.g. "Showing cached
  // prompt history") can pass their own headline.
  headline?: string;
  // Optional override for the secondary line. Defaults to the
  // retry-status hint. Pages can use this to tell the user which
  // actions are unavailable until opencode comes back (e.g.
  // "Refire is disabled while opencode is unreachable").
  hint?: string;
}

// In-page yellow banner. Renders ONLY when opencode is unreachable
// AND there's an active server context (per the connection monitor).
// Used at the top of openportal-owned routes (prompts archive, server
// list, settings) so the user knows the rows below were served off
// openportal's local cache instead of going live to opencode.
//
// Distinct from the global ConnectionStatusBanner in _app.tsx: the
// global one is the headline / always-visible signal; this one is the
// in-route reinforcement co-located with the cached rows. Pages can
// choose to render only one of them - typically the in-page version
// makes the staleness feel attached to the data the user is reading,
// while the global banner makes it visible no matter the route.
export function StaleDataBanner({ headline, hint }: StaleDataBannerProps) {
  const status = useConnectionMonitor();
  if (status !== "opencode-down") return null;
  const head =
    headline ?? "Showing cached data - opencode is unreachable.";
  const body =
    hint ??
    "Openportal-owned views (prompts, settings, server list) keep working. Live opencode reads will resume automatically once it's back.";
  return (
    <div className="flex items-start gap-2 border-b border-warning/40 bg-warning-subtle px-3 py-2 text-sm">
      <ExclamationTriangleIcon
        className="size-4 shrink-0 text-warning-subtle-fg mt-0.5"
        aria-hidden="true"
      />
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-warning-subtle-fg">{head}</span>
        <span className="text-xs text-warning-subtle-fg/80">{body}</span>
      </div>
    </div>
  );
}
