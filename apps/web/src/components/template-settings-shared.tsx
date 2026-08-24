import type { ReactNode } from "react";

export const FLAG_HELP = {
  burger: "Visible in the topbar templates menu.",
  init: "Shown in the new-session template list.",
  defaultOn:
    "Pre-checked when the new-session template list opens. You can still uncheck it for that session.",
  slash:
    "Available in composer slash autocomplete as /template <name>; accepting it inserts the template body.",
  outside:
    "Promoted out of the hamburger into the title bar as its own desktop icon button.",
} as const;

export const TEMPLATE_ROW_LAYOUT_CLASS =
  "flex flex-wrap items-start gap-2 xl:flex-nowrap xl:items-center";
export const TEMPLATE_ROW_WIDE_TITLE_CLASS = "hidden xl:block";
export const TEMPLATE_ROW_NARROW_TITLE_CLASS = "xl:hidden";

type FlagCheckboxProps = {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly title: string;
  readonly disabled?: boolean;
};

export function FlagCheckbox({
  label,
  checked,
  onChange,
  title,
  disabled,
}: FlagCheckboxProps) {
  return (
    <label
      className={`group relative flex w-20 items-center gap-1 text-[11px] tracking-wide text-muted-fg ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        className={`size-4 accent-primary ${
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        }`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-64 rounded-md border border-(--tooltip-border) [--tooltip-border:var(--color-muted-fg)]/30 bg-overlay px-2 py-1 text-xs normal-case tracking-normal text-overlay-fg shadow-md sm:group-hover:block sm:group-focus-within:block"
      >
        {title}
      </span>
    </label>
  );
}

type TemplateTitleBlockProps = {
  readonly name: string;
  readonly description?: string;
  readonly badge?: ReactNode;
  readonly scope?: string;
  readonly className?: string;
};

export function TemplateTitleBlock({
  name,
  description,
  badge,
  scope,
  className = "",
}: TemplateTitleBlockProps) {
  return (
    <div className={`min-w-0 flex-1 px-2 ${className}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-sm">{name}</span>
        {scope && (
          <span className="break-all text-[10px] text-muted-fg/70 font-mono">
            {scope}
          </span>
        )}
        {badge}
      </div>
      {description && (
        <p className="text-xs text-muted-fg mt-0.5">{description}</p>
      )}
    </div>
  );
}
