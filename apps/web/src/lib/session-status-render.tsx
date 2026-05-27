// Rendering primitives for the unified session-status indicator system.
// Pure logic + the visual map live in @/lib/session-status (a JSX-free
// `.ts` module) so bun unit tests can import the pickers without
// dragging in `react/jsx-dev-runtime`. This file owns the JSX:
//
//   <StatusDot kind="..." />           - the 8px chip used in sidebar /
//                                        pinned tabs / project tiles
//   <StatusBadge kind="..." />         - the long pill used in the
//                                        active-session title bar
//   <StatusIndicator size="dot|badge"  - the convenience wrapper that
//                    kind="..." />       picks dot or badge by prop

import * as React from "react";

import {
  STATUS_DEFAULTS,
  STATUS_VISUALS,
  type StatusKind,
} from "@/lib/session-status";

export function StatusDot({
  kind,
  title,
  className = "",
}: {
  kind: StatusKind;
  title?: string;
  className?: string;
}) {
  const v = STATUS_VISUALS[kind];
  const label = title ?? STATUS_DEFAULTS[kind].title;

  if (v.pulse && v.ping) {
    return (
      <span
        className={`relative flex size-2 shrink-0 ${className}`}
        aria-label={label}
        title={label}
        data-status-kind={kind}
      >
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${v.ping}`}
        />
        <span className={`relative inline-flex size-2 rounded-full ${v.bg}`} />
      </span>
    );
  }

  return (
    <span
      className={`size-2 shrink-0 rounded-full ${v.bg} ${className}`}
      aria-label={label}
      title={label}
      data-status-kind={kind}
    />
  );
}

export function StatusBadge({
  kind,
  label,
  title,
  className = "",
}: {
  kind: StatusKind;
  label?: string;
  title?: string;
  className?: string;
}) {
  const v = STATUS_VISUALS[kind];
  const finalLabel = label ?? STATUS_DEFAULTS[kind].label;
  const finalTitle = title ?? STATUS_DEFAULTS[kind].title;
  const pulseCls = v.pulse ? "animate-pulse" : "";
  const baseCls = `inline-flex items-center rounded px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide leading-4 whitespace-nowrap ${v.bg} ${v.badgeFg} ${pulseCls} ${className}`;

  return (
    <span
      className={baseCls}
      title={finalTitle}
      aria-label={finalTitle}
      data-status-kind={kind}
    >
      {finalLabel}
    </span>
  );
}

export function StatusIndicator({
  kind,
  size,
  label,
  title,
  className,
}: {
  kind: StatusKind;
  size: "dot" | "badge";
  label?: string;
  title?: string;
  className?: string;
}) {
  if (size === "dot") {
    return <StatusDot kind={kind} title={title} className={className} />;
  }
  return <StatusBadge kind={kind} label={label} title={title} className={className} />;
}
