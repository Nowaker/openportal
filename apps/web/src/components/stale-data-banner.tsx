import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import { useConnectionMonitor } from "@/hooks/use-connection-monitor";
import { CompactBanner } from "@/components/ui/compact-banner";

interface StaleDataBannerProps {
  headline?: string;
  hint?: string;
}

// In-route reinforcement of the global ConnectionStatusBanner, co-located
// with the cached rows. Both gate on "opencode-down", so the global warning
// banner is always directly above this one - hence seamlessTop, to avoid a
// doubled border at the route-subtree seam.
export function StaleDataBanner({ headline, hint }: StaleDataBannerProps) {
  const status = useConnectionMonitor();
  if (status !== "opencode-down") return null;
  return (
    <CompactBanner
      intent="warning"
      seamlessTop
      icon={<ExclamationTriangleIcon className="size-3.5" aria-hidden="true" />}
      message={headline ?? "Showing cached data - OpenCode is unreachable."}
      details={
        <span>
          {hint ??
            "OpenPortal-owned views (prompts, settings, server list) keep working. Live OpenCode reads will resume automatically once it's back."}
        </span>
      }
      dataTest="portal-stale-data-banner"
    />
  );
}
