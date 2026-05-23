import { useState } from "react";

export type CompactBannerIntent = "warning" | "danger" | "info";

interface CompactBannerProps {
  intent: CompactBannerIntent;
  icon: React.ReactNode;
  message: React.ReactNode;
  actions?: React.ReactNode;
  details?: React.ReactNode;
  dataTest?: string;
}

const PALETTE: Record<
  CompactBannerIntent,
  { wrap: string; iconColor: string; bodyColor: string; detailColor: string }
> = {
  warning: {
    wrap: "border-warning/40 bg-warning-subtle",
    iconColor: "text-warning-subtle-fg",
    bodyColor: "text-warning-subtle-fg",
    detailColor: "text-warning-subtle-fg/80",
  },
  danger: {
    wrap: "border-danger/40 bg-danger-subtle/40",
    iconColor: "text-danger",
    bodyColor: "text-fg",
    detailColor: "text-muted-fg",
  },
  info: {
    wrap: "border-info/40 bg-info-subtle",
    iconColor: "text-info-subtle-fg",
    bodyColor: "text-info-subtle-fg",
    detailColor: "text-info-subtle-fg/80",
  },
};

export function CompactBanner({
  intent,
  icon,
  message,
  actions,
  details,
  dataTest,
}: CompactBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const p = PALETTE[intent];
  const expandable = Boolean(details);
  return (
    <div
      className={`flex flex-col gap-0.5 border-b px-3 py-1.5 text-xs ${p.wrap}`}
      data-test={dataTest}
    >
      <div className="flex items-center gap-2">
        <span className={`shrink-0 ${p.iconColor}`}>{icon}</span>
        <button
          type="button"
          onClick={() => {
            if (expandable) setExpanded((v) => !v);
          }}
          disabled={!expandable}
          aria-expanded={expandable ? expanded : undefined}
          className={`flex-1 min-w-0 truncate text-left ${p.bodyColor} ${
            expandable ? "cursor-pointer hover:underline" : "cursor-default"
          }`}
        >
          {message}
        </button>
        {actions && (
          <span className="shrink-0 flex items-center gap-1.5">{actions}</span>
        )}
      </div>
      {expandable && expanded && (
        <div className={`pl-6 ${p.detailColor}`}>{details}</div>
      )}
    </div>
  );
}
