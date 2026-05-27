import { TextArea, type TextAreaProps } from "react-aria-components";
import { twJoin } from "tailwind-merge";
import { cx } from "@/lib/primitive";

interface TextareaComponentProps extends TextAreaProps {
  ref?: React.Ref<HTMLTextAreaElement>;
}

export function Textarea({ className, ref, ...props }: TextareaComponentProps) {
  return (
    // The wrapper is a flex column with `h-full min-h-0` so callers placing
    // the textarea inside a flex slot (composer, modal forms, ...) can rely
    // on it to fill the available height instead of collapsing to its own
    // intrinsic content. The inner <TextArea> uses `field-sizing-content`
    // for natural growth with input AND `max-h-full` so growth caps at the
    // wrapper - which is the slot's height. This is what makes the
    // composer's 50dvh cap actually hold.
    <span
      data-slot="control"
      className="relative flex flex-col w-full h-full min-h-0"
    >
      <TextArea
        ref={ref}
        {...props}
        className={cx(
          twJoin([
            "field-sizing-content relative block min-h-16 max-h-full w-full appearance-none rounded-lg px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)]",
            "text-sm/6 text-fg placeholder:text-muted-fg",
            "border border-input enabled:hover:border-muted-fg/30",
            "outline-hidden focus:border-ring/70 focus:ring-3 focus:ring-ring/20 focus:enabled:hover:border-ring/80",
            "invalid:border-danger-subtle-fg/70 focus:invalid:border-danger-subtle-fg/70 focus:invalid:ring-danger-subtle-fg/20 invalid:enabled:hover:border-danger-subtle-fg/80 invalid:focus:enabled:hover:border-danger-subtle-fg/80",
            "disabled:bg-muted forced-colors:in-disabled:text-[GrayText]",
            "in-disabled:bg-muted forced-colors:in-disabled:text-[GrayText]",
            "dark:scheme-dark",
            // Mobile touch behavior:
            // - `touch-pan-y`: a finger drag inside the textarea pans the
            //   textarea's own content vertically (Tailwind => CSS
            //   `touch-action: pan-y`). Without this, Android Chrome
            //   sometimes bubbles the gesture to the nearest scrollable
            //   ancestor (the chat container or the new-session page) and
            //   the user sees the wrong surface scroll.
            // - `overscroll-contain`: once the textarea's internal scroll
            //   hits its top or bottom limit, additional drag does NOT fall
            //   through to scroll the page. The textarea's scroll position
            //   is the only thing the gesture controls.
            "touch-pan-y overscroll-contain",
          ]),
          className,
        )}
      />
    </span>
  );
}
