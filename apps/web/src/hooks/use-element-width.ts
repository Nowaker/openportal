import { useEffect, useState } from "react";

// ResizeObserver-backed width measurement. The TopBar action cluster
// publishes its rendered width through this so the banner stack (which
// shares its parent) can reserve matching `padding-right` and never
// flow under the hamburger / action icons.
//
// Why ResizeObserver: the cluster's width changes whenever an action
// item shows/hides (PinTopbarButton on session-only routes, the
// "outside burger" template icons configurable in Settings, the
// SessionContextDial which only appears when a session is loaded).
// Polling or fixed widths would either flicker or constantly mis-align.
export function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = Math.ceil(entry.contentRect.width);
      setWidth((prev) => (prev === next ? prev : next));
    });
    ro.observe(el);
    setWidth(Math.ceil(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
