import { useEffect, useState } from "react";

// Composer max-height in pixels.
//
// dvh is supposed to track the visible viewport across keyboard show/hide,
// but on Android Chrome and iOS Safari it's flaky: the value either lags or
// stays at the full viewport while the soft keyboard is up, leaving the
// composer overlapping the keyboard. visualViewport.height is the
// browser-blessed source of truth for "how much of the page can the user
// actually see right now", so we read that and cap the composer at 60% of
// it. SSR / no-visualViewport fallback stays at 50% of innerHeight, which
// matches the original 50dvh behaviour.
//
// Shared between session/$id.tsx (existing-session composer) and
// session/new.tsx (new-session composer). The latter previously had NO
// cap at all - the textarea grew unbounded with content and pushed the
// init-template picker off-screen.
export function useComposerMaxHeight(): number {
  const [maxPx, setMaxPx] = useState<number>(() => {
    if (typeof window === "undefined") return 600;
    const vv = window.visualViewport;
    return Math.round((vv?.height ?? window.innerHeight) * 0.6);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    const update = () => {
      const h = vv?.height ?? window.innerHeight;
      setMaxPx(Math.round(h * 0.6));
    };
    update();
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    }
    window.addEventListener("resize", update);
    return () => {
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      }
      window.removeEventListener("resize", update);
    };
  }, []);

  return maxPx;
}
