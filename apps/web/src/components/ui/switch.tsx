import * as React from "react";
import {
  Switch as AriaSwitch,
  type SwitchProps as AriaSwitchProps,
} from "react-aria-components";

// Match opencode's `<Switch hideLabel>` API: pass the label as children
// for accessibility (aria-label is derived from it) but visually hide
// it when the toggle stands alone next to a separate text label.

export interface SwitchProps extends Omit<AriaSwitchProps, "children"> {
  children?: React.ReactNode;
  hideLabel?: boolean;
}

export function Switch({
  children,
  hideLabel,
  className,
  ...props
}: SwitchProps) {
  const ariaLabel =
    typeof children === "string" && hideLabel && !props["aria-label"]
      ? children
      : props["aria-label"];

  return (
    <AriaSwitch
      {...props}
      aria-label={ariaLabel}
      className={`group inline-flex cursor-pointer items-center gap-2 text-sm outline-none ${
        className ?? ""
      }`}
    >
      <div className="relative inline-flex h-5 w-9 shrink-0 rounded-full bg-muted ring-1 ring-border transition-colors group-data-[selected]:bg-accent group-data-[disabled]:opacity-50 group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-accent/50">
        <div className="absolute top-0.5 left-0.5 block size-4 rounded-full bg-bg shadow transition-transform group-data-[selected]:translate-x-4" />
      </div>
      {!hideLabel && children && <span>{children}</span>}
    </AriaSwitch>
  );
}
