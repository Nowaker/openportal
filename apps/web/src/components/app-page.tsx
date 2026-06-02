import type { ComponentProps, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export function AppPage({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={twMerge(
        "flex min-h-0 flex-1 flex-col overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

export function AppPageHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={twMerge(
        "shrink-0 border-b border-border px-3 py-2 sm:px-4",
        className,
      )}
      {...props}
    />
  );
}

interface AppPageBodyProps extends ComponentProps<"div"> {
  padded?: boolean;
  scroll?: boolean;
}

export function AppPageBody({
  className,
  padded = true,
  scroll = true,
  ...props
}: AppPageBodyProps) {
  return (
    <div
      className={twMerge(
        "min-h-0 flex-1",
        scroll && "overflow-auto overscroll-contain",
        padded && "px-3 py-3 sm:px-4",
        className,
      )}
      {...props}
    />
  );
}

interface AppPageContainerProps extends AppPageBodyProps {
  maxWidth?: "3xl" | "4xl" | "none";
  children: ReactNode;
}

export function AppPageContainer({
  children,
  className,
  maxWidth = "none",
  padded = true,
  ...props
}: AppPageContainerProps) {
  const maxWidthClass =
    maxWidth === "3xl"
      ? "max-w-3xl"
      : maxWidth === "4xl"
        ? "max-w-4xl"
        : "max-w-none";

  return (
    <AppPageBody padded={false} {...props}>
      <div
        className={twMerge(
          "mx-auto w-full",
          maxWidthClass,
          padded && "px-4 py-6",
          className,
        )}
      >
        {children}
      </div>
    </AppPageBody>
  );
}
