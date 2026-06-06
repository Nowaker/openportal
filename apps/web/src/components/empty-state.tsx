import { Link } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { Keyboard } from "@/components/ui/keyboard";
import { useSidebar } from "@/components/ui/sidebar";
import { useCmdStore } from "@/stores/cmd-store";

const actionLinkClass =
  "font-medium text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm";

export default function EmptyState() {
  const { isMobile, setIsOpenOnMobile, setOpen } = useSidebar();
  const openCommandMenu = useCmdStore((s) => s.open);

  const openNavbar = useCallback(() => {
    if (isMobile) {
      setIsOpenOnMobile(true);
      return;
    }
    setOpen(true);
  }, [isMobile, setIsOpenOnMobile, setOpen]);

  useEffect(() => {
    openNavbar();
  }, [openNavbar]);

  const commandShortcut =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘ K"
      : "Ctrl + K";

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-bg"
      data-test="portal-empty-chat-state"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-8">
        <div className="max-w-md text-center">
          <div className="mb-4 flex items-center justify-center gap-x-2">
            <img src="/logo.svg" alt="OpenCode Portal" className="size-8" />
            <h2 className="text-2xl font-medium text-fg">OpenCode Portal</h2>
          </div>

          <p className="mb-3 text-base font-medium text-fg">No session open.</p>
          <p className="text-sm leading-6 text-muted-fg">
            Open a session from the{" "}
            <button
              type="button"
              onClick={openNavbar}
              className={actionLinkClass}
            >
              left navbar
            </button>
            ,{" "}
            <Link
              to="/session/new"
              search={(prev) => prev}
              className={actionLinkClass}
            >
              create a new session
            </Link>
            , or{" "}
            <button
              type="button"
              onClick={openCommandMenu}
              className={actionLinkClass}
            >
              find a session
            </button>
            .
          </p>

          <div className="mt-6 text-sm text-muted-fg">
            Press{" "}
            <Keyboard className="inline-flex rounded bg-secondary px-1.5 py-0.5 font-mono text-secondary-fg text-xs">
              {commandShortcut}
            </Keyboard>{" "}
            to search sessions from anywhere.
          </div>
        </div>
      </div>
    </div>
  );
}
