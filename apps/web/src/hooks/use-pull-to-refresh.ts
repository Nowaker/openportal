import { useEffect } from "react";

const THRESHOLD_PX = 80;
const MAX_VERTICAL_RATIO = 1.6;

// Manual pull-to-refresh: Portal's app shell uses h-dvh + overflow-hidden,
// so window-level scroll never reaches scrollTop=0 (no scroll), which means
// Chrome's native pull-to-refresh never fires. We listen to touchstart at
// the document level, walk up to the nearest scrollable ancestor of the
// touch target, and if that ancestor is at scrollTop=0 AND the user pulls
// straight down past THRESHOLD_PX without scrolling horizontally, trigger
// a hard reload. Filters out diagonal swipes (sidebar gestures, etc.) via
// MAX_VERTICAL_RATIO.
function findScrollableParent(el: Element | null): Element | null {
  let cursor: Element | null = el;
  while (cursor && cursor !== document.body) {
    const style = window.getComputedStyle(cursor);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      cursor.scrollHeight > cursor.clientHeight
    ) {
      return cursor;
    }
    cursor = cursor.parentElement;
  }
  return document.scrollingElement;
}

export function usePullToRefresh() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("ontouchstart" in window)) return;

    let startX = 0;
    let startY = 0;
    let startScrollTop = 0;
    let armed = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        armed = false;
        return;
      }
      const t = e.touches[0]!;
      const target = e.target as Element | null;
      const scroller = findScrollableParent(target);
      startScrollTop = scroller?.scrollTop ?? 0;
      startX = t.clientX;
      startY = t.clientY;
      armed = startScrollTop <= 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!armed || e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const dy = t.clientY - startY;
      const dx = Math.abs(t.clientX - startX);
      if (dy <= 0) return;
      if (dx * MAX_VERTICAL_RATIO > dy) {
        armed = false;
        return;
      }
      if (dy >= THRESHOLD_PX) {
        armed = false;
        window.location.reload();
      }
    };

    const onTouchEnd = () => {
      armed = false;
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);
}
