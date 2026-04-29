import { useEffect } from "react";
import { create } from "zustand";

const THRESHOLD_PX = 80;
const MAX_PULL_PX = 120;
const MAX_VERTICAL_RATIO = 1.6;

interface PullState {
  pullDistance: number;
  releasing: boolean;
  setPullDistance: (px: number) => void;
  startReleasing: () => void;
  reset: () => void;
}

export const usePullState = create<PullState>((set) => ({
  pullDistance: 0,
  releasing: false,
  setPullDistance: (px) => set({ pullDistance: px, releasing: false }),
  startReleasing: () => set({ releasing: true }),
  reset: () => set({ pullDistance: 0, releasing: false }),
}));

export const PULL_THRESHOLD_PX = THRESHOLD_PX;
export const PULL_MAX_PX = MAX_PULL_PX;

// Manual pull-to-refresh with visual feedback. Portal's app shell uses
// h-dvh + overflow-hidden, so window-level scroll never reaches
// scrollTop=0 (no scroll), which means Chrome's native pull-to-refresh
// never fires. We listen to touchstart at the document level, walk up to
// the nearest scrollable ancestor, drive a Zustand-backed pullDistance
// state for the indicator + page-drag, and on release past THRESHOLD_PX
// trigger a hard reload. Filters diagonal swipes via MAX_VERTICAL_RATIO.
// Past threshold the pull is rubber-banded at half-rate so it feels
// resistant + so the page-drag never disappears off-screen.
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
  const setPullDistance = usePullState((s) => s.setPullDistance);
  const startReleasing = usePullState((s) => s.startReleasing);
  const reset = usePullState((s) => s.reset);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("ontouchstart" in window)) return;

    let startX = 0;
    let startY = 0;
    let startScrollTop = 0;
    let armed = false;
    let pulled = 0;

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
      pulled = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!armed || e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const dy = t.clientY - startY;
      const dx = Math.abs(t.clientX - startX);
      if (dy <= 0) {
        pulled = 0;
        setPullDistance(0);
        return;
      }
      if (dx * MAX_VERTICAL_RATIO > dy) {
        armed = false;
        pulled = 0;
        setPullDistance(0);
        return;
      }
      pulled =
        dy <= THRESHOLD_PX
          ? dy
          : Math.min(MAX_PULL_PX, THRESHOLD_PX + (dy - THRESHOLD_PX) * 0.5);
      setPullDistance(pulled);
    };

    const onTouchEnd = () => {
      if (!armed) {
        reset();
        return;
      }
      armed = false;
      if (pulled >= THRESHOLD_PX) {
        startReleasing();
        window.setTimeout(() => {
          window.location.reload();
        }, 200);
      } else {
        reset();
      }
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
  }, [setPullDistance, startReleasing, reset]);
}
