import { ArrowPathIcon } from "@heroicons/react/24/outline";
import {
  PULL_THRESHOLD_PX,
  PULL_MAX_PX,
  usePullState,
} from "@/hooks/use-pull-to-refresh";

// Shows a circular refresh icon at the top of the viewport that reveals as
// the user pulls down. Past PULL_THRESHOLD_PX the icon goes solid + the
// background tint deepens, signaling "release to refresh". On release we
// either reload (handled by the hook) or animate back to zero. Pairs with
// a sibling app-shell wrapper that translates the page DOWN by the same
// distance so the gesture mimics native iOS/Android pull-to-refresh.
export function PullToRefreshIndicator() {
  const pullDistance = usePullState((s) => s.pullDistance);
  const releasing = usePullState((s) => s.releasing);

  if (pullDistance <= 0 && !releasing) return null;

  const ready = pullDistance >= PULL_THRESHOLD_PX;
  const visibleDistance = Math.min(PULL_MAX_PX, pullDistance);
  const progress = Math.min(1, pullDistance / PULL_THRESHOLD_PX);
  const iconRotation = (pullDistance / PULL_THRESHOLD_PX) * 360;
  const opacity = Math.min(1, progress);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] flex items-start justify-center"
      style={{
        height: `${visibleDistance}px`,
        transition: releasing ? "height 150ms ease-out" : "none",
      }}
    >
      <div
        className={`mt-2 flex size-9 items-center justify-center rounded-full border ${
          ready
            ? "border-primary bg-primary/15 text-primary"
            : "border-border bg-bg/95 text-muted-fg"
        } shadow-sm`}
        style={{ opacity }}
      >
        <ArrowPathIcon
          className="size-5"
          style={{
            transform: releasing
              ? "rotate(360deg)"
              : `rotate(${iconRotation}deg)`,
            transition: releasing
              ? "transform 600ms linear"
              : "transform 60ms linear",
          }}
        />
      </div>
    </div>
  );
}

// Wrap the app's content. Translates the wrapped subtree down with the
// pull gesture so the user sees the page actually drop, with the indicator
// revealing in the gap above.
export function PullToRefreshWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const pullDistance = usePullState((s) => s.pullDistance);
  const releasing = usePullState((s) => s.releasing);
  const visibleDistance = Math.min(PULL_MAX_PX, pullDistance);
  return (
    <div
      style={{
        transform: `translateY(${visibleDistance}px)`,
        transition: releasing ? "transform 150ms ease-out" : "none",
        willChange: visibleDistance > 0 ? "transform" : undefined,
      }}
    >
      {children}
    </div>
  );
}
