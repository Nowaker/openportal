import { useEffect, useRef, useState } from "react";
import { useAccentStore } from "@/stores/accent-store";
import { useComposerStore } from "@/stores/composer-store";
import { useDateFormatStore } from "@/stores/date-format-store";
import { useFontSizeStore } from "@/stores/font-size-store";
import { useFontStore } from "@/stores/font-store";
import { useToolsStore } from "@/stores/tools-store";

const SETTINGS_URL = "/api/state/settings";
const PUSH_DEBOUNCE_MS = 500;

// Cross-device sync for user-facing settings. Bootstrapping order:
//   1. zustand persist hydrates each store from localStorage (runs before
//      this hook ever mounts; so stores have a sensible default visible
//      while the server fetch is in flight).
//   2. On mount we GET /api/state/settings and override each store with
//      the server value. The "lastPushed" JSON snapshot is set BEFORE the
//      override, so the change-listener's first fire after the override
//      compares equal and doesn't loop the value back to the server.
//   3. We subscribe each store. On any local mutation we debounce 500ms
//      then POST {namespace, value} - but only if JSON-different from
//      the last value we pulled or pushed.
// Streaming preference is intentionally NOT in this list - per user spec
// it stays per-tab/per-device localStorage only.
export function useSettingsSync(): boolean {
  const [hydrated, setHydrated] = useState(false);
  const lastSeenJson = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(SETTINGS_URL);
        if (cancelled) return;
        if (res.ok) {
          const json = (await res.json()) as { settings?: Record<string, unknown> };
          const s = json.settings ?? {};
          applyServerSettings(s, lastSeenJson.current);
        }
      } catch {
        // server unreachable - localStorage values stay in effect
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
    const push = (namespace: string, value: unknown) => {
      const serialized = JSON.stringify(value);
      if (lastSeenJson.current[namespace] === serialized) return;
      lastSeenJson.current[namespace] = serialized;
      if (timers[namespace]) clearTimeout(timers[namespace]);
      timers[namespace] = setTimeout(() => {
        void fetch(SETTINGS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ namespace, value }),
        }).catch(() => {
          // network blip - next subscribe-fire will retry
        });
      }, PUSH_DEBOUNCE_MS);
    };

    const unsubs = [
      useAccentStore.subscribe((s) =>
        push("accent", { accentColor: s.accentColor }),
      ),
      useDateFormatStore.subscribe((s) =>
        push("dateFormat", { format: s.format }),
      ),
      useFontSizeStore.subscribe((s) => push("fontSize", { scale: s.scale })),
      useFontStore.subscribe((s) => push("font", { fontFamily: s.fontFamily })),
      useComposerStore.subscribe((s) =>
        push("composer", { enterKeyAction: s.enterKeyAction }),
      ),
      useToolsStore.subscribe((s) =>
        push("tools", {
          disabledIds: s.disabledIds,
          systemOverrides: s.systemOverrides,
          customTools: s.customTools,
        }),
      ),
    ];

    return () => {
      for (const u of unsubs) u();
      for (const k of Object.keys(timers)) {
        const t = timers[k];
        if (t) clearTimeout(t);
      }
    };
  }, [hydrated]);

  return hydrated;
}

function applyServerSettings(
  s: Record<string, unknown>,
  lastSeen: Record<string, string>,
): void {
  if (s.accent) {
    lastSeen.accent = JSON.stringify(s.accent);
    useAccentStore.setState(s.accent as Parameters<typeof useAccentStore.setState>[0]);
  }
  if (s.dateFormat) {
    lastSeen.dateFormat = JSON.stringify(s.dateFormat);
    useDateFormatStore.setState(
      s.dateFormat as Parameters<typeof useDateFormatStore.setState>[0],
    );
  }
  if (s.fontSize) {
    lastSeen.fontSize = JSON.stringify(s.fontSize);
    useFontSizeStore.setState(
      s.fontSize as Parameters<typeof useFontSizeStore.setState>[0],
    );
  }
  if (s.font) {
    lastSeen.font = JSON.stringify(s.font);
    useFontStore.setState(s.font as Parameters<typeof useFontStore.setState>[0]);
  }
  if (s.composer) {
    lastSeen.composer = JSON.stringify(s.composer);
    useComposerStore.setState(
      s.composer as Parameters<typeof useComposerStore.setState>[0],
    );
  }
  if (s.tools) {
    lastSeen.tools = JSON.stringify(s.tools);
    useToolsStore.setState(s.tools as Parameters<typeof useToolsStore.setState>[0]);
  }
}
