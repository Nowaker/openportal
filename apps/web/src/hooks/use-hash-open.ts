import { useCallback, useEffect, useState } from "react";

// Two-way binding between a boolean "is this thing open" state and a
// URL fragment identifier (e.g. `#info`). The hook is the project's
// canonical way to make modals, panels, expanded sections, and other
// "open/closed" UI permalinkable so:
//   - The user can copy the URL while a modal is open and paste it to
//     reopen the exact same view.
//   - Browser back/forward navigates in and out of the modal state.
//   - State survives a hard refresh.
//
// Multiple useHashOpen hooks can coexist on the same page IFF each one
// uses a distinct hashId; only one identifier can be "open" at a time
// (the hash holds at most one value). For composite or namespaced
// states (e.g. `#mcp:redis`) pass the full identifier directly.
//
// pushState (NOT replaceState) is intentional: opening a modal creates
// a history entry so the browser back button closes it. Closing
// without an explicit pop is similarly pushed so forward navigation
// can reopen the modal.
export function useHashOpen(
  hashId: string,
): [boolean, (open: boolean) => void] {
  const matches = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.location.hash === `#${hashId}`;
  }, [hashId]);

  const [isOpen, setIsOpenInternal] = useState<boolean>(matches);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setIsOpenInternal(matches());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    sync();
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [matches]);

  const setOpen = useCallback(
    (open: boolean) => {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      const desired = open ? `#${hashId}` : "";
      if (url.hash === desired) {
        setIsOpenInternal(open);
        return;
      }
      url.hash = desired;
      window.history.pushState(null, "", url.toString());
      setIsOpenInternal(open);
    },
    [hashId],
  );

  return [isOpen, setOpen];
}
