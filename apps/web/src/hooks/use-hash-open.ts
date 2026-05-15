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

// Two-way binding between a string|null UI state and a prefixed URL
// fragment of the shape `#<prefix>:<value>`. Used for modals whose
// open state is identified by which value is shown (e.g. "the MCP
// info modal for redis" -> `#mcp:redis`; "the plugin info modal for
// @scope/pkg" -> `#plugin:%40scope%2Fpkg`). null clears the hash.
//
// Same semantics as useHashOpen: pushState on set-to-value,
// replaceState on set-to-null (so closing doesn't leave a stale
// history entry). Listens to popstate + hashchange so browser
// navigation flips the React state.
export function useHashValue(
  prefix: string,
): [string | null, (value: string | null) => void] {
  const tag = `#${prefix}:`;
  const read = useCallback(() => {
    if (typeof window === "undefined") return null;
    const h = window.location.hash;
    if (!h.startsWith(tag)) return null;
    try {
      return decodeURIComponent(h.slice(tag.length));
    } catch {
      return h.slice(tag.length);
    }
  }, [tag]);

  const [value, setValueInternal] = useState<string | null>(read);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setValueInternal(read());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    sync();
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [read]);

  const setValue = useCallback(
    (next: string | null) => {
      if (typeof window === "undefined") {
        setValueInternal(next);
        return;
      }
      const url = new URL(window.location.href);
      const desired = next === null ? "" : `${prefix}:${encodeURIComponent(next)}`;
      const currentHashWithoutLead = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      if (currentHashWithoutLead === desired) {
        setValueInternal(next);
        return;
      }
      url.hash = desired;
      if (next === null) {
        window.history.replaceState(null, "", url.toString());
      } else {
        window.history.pushState(null, "", url.toString());
      }
      setValueInternal(next);
    },
    [prefix],
  );

  return [value, setValue];
}
