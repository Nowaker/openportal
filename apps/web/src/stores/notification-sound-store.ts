import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SoundKind = "turn-complete" | "attention" | "error";

interface NotificationSoundState {
  enabled: boolean;
  volume: number;
  setEnabled: (on: boolean) => void;
  setVolume: (vol: number) => void;
}

export const useNotificationSoundStore = create<NotificationSoundState>()(
  persist(
    (set) => ({
      enabled: false,
      volume: 0.5,
      setEnabled: (enabled) => set({ enabled }),
      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
    }),
    { name: "openportal-notification-sound" },
  ),
);

const SOUND_PATHS: Record<SoundKind, string> = {
  "turn-complete": "/sounds/turn-complete.mp3",
  attention: "/sounds/attention.mp3",
  error: "/sounds/error.mp3",
};

const audioCache = new Map<SoundKind, HTMLAudioElement>();

export function playNotificationSound(kind: SoundKind): void {
  if (typeof window === "undefined") return;
  const { enabled, volume } = useNotificationSoundStore.getState();
  if (!enabled) return;
  let audio = audioCache.get(kind);
  if (!audio) {
    audio = new Audio(SOUND_PATHS[kind]);
    audio.preload = "auto";
    audioCache.set(kind, audio);
  }
  audio.volume = volume;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    /* autoplay blocked or hardware unavailable - silent failure is correct */
  });
}
