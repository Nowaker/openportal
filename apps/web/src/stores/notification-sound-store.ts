import { create } from "zustand";
import { persist } from "zustand/middleware";

// Mirrors opencode's notification-sound model:
//   agent       - session completed OR agent is asking for attention
//   permissions - a tool requires the user's approval
//   errors      - a session hit an error
// Each category has its own enabled flag + selected soundId. Sound
// files live at /sounds/<id>.mp3 (copied from opencode's
// packages/ui/src/assets/audio).
export type NotificationCategory = "agent" | "permissions" | "errors";

export const SOUND_OPTIONS = [
  { id: "alert-01", label: "Alert 01" },
  { id: "alert-02", label: "Alert 02" },
  { id: "alert-03", label: "Alert 03" },
  { id: "alert-04", label: "Alert 04" },
  { id: "alert-05", label: "Alert 05" },
  { id: "alert-06", label: "Alert 06" },
  { id: "alert-07", label: "Alert 07" },
  { id: "alert-08", label: "Alert 08" },
  { id: "alert-09", label: "Alert 09" },
  { id: "alert-10", label: "Alert 10" },
  { id: "bip-bop-01", label: "Bip Bop 01" },
  { id: "bip-bop-02", label: "Bip Bop 02" },
  { id: "bip-bop-03", label: "Bip Bop 03" },
  { id: "bip-bop-04", label: "Bip Bop 04" },
  { id: "bip-bop-05", label: "Bip Bop 05" },
  { id: "bip-bop-06", label: "Bip Bop 06" },
  { id: "bip-bop-07", label: "Bip Bop 07" },
  { id: "bip-bop-08", label: "Bip Bop 08" },
  { id: "bip-bop-09", label: "Bip Bop 09" },
  { id: "bip-bop-10", label: "Bip Bop 10" },
  { id: "staplebops-01", label: "Staplebops 01" },
  { id: "staplebops-02", label: "Staplebops 02" },
  { id: "staplebops-03", label: "Staplebops 03" },
  { id: "staplebops-04", label: "Staplebops 04" },
  { id: "staplebops-05", label: "Staplebops 05" },
  { id: "staplebops-06", label: "Staplebops 06" },
  { id: "staplebops-07", label: "Staplebops 07" },
  { id: "nope-01", label: "Nope 01" },
  { id: "nope-02", label: "Nope 02" },
  { id: "nope-03", label: "Nope 03" },
  { id: "nope-04", label: "Nope 04" },
  { id: "nope-05", label: "Nope 05" },
  { id: "nope-06", label: "Nope 06" },
  { id: "nope-07", label: "Nope 07" },
  { id: "nope-08", label: "Nope 08" },
  { id: "nope-09", label: "Nope 09" },
  { id: "nope-10", label: "Nope 10" },
  { id: "nope-11", label: "Nope 11" },
  { id: "nope-12", label: "Nope 12" },
  { id: "yup-01", label: "Yup 01" },
  { id: "yup-02", label: "Yup 02" },
  { id: "yup-03", label: "Yup 03" },
  { id: "yup-04", label: "Yup 04" },
  { id: "yup-05", label: "Yup 05" },
  { id: "yup-06", label: "Yup 06" },
] as const;

export type SoundId = (typeof SOUND_OPTIONS)[number]["id"];

interface CategoryConfig {
  enabled: boolean;
  soundId: SoundId;
}

interface NotificationSoundState {
  volume: number;
  agent: CategoryConfig;
  permissions: CategoryConfig;
  errors: CategoryConfig;
  setVolume: (vol: number) => void;
  setCategoryEnabled: (category: NotificationCategory, on: boolean) => void;
  setCategorySound: (category: NotificationCategory, soundId: SoundId) => void;
}

export const useNotificationSoundStore = create<NotificationSoundState>()(
  persist(
    (set) => ({
      volume: 0.5,
      agent: { enabled: true, soundId: "staplebops-01" },
      permissions: { enabled: true, soundId: "staplebops-02" },
      errors: { enabled: true, soundId: "nope-03" },
      setVolume: (volume) =>
        set({ volume: Math.max(0, Math.min(1, volume)) }),
      setCategoryEnabled: (category, enabled) =>
        set((state) => ({
          [category]: { ...state[category], enabled },
        })),
      setCategorySound: (category, soundId) =>
        set((state) => ({
          [category]: { ...state[category], soundId },
        })),
    }),
    { name: "openportal-notification-sound" },
  ),
);

const audioCache = new Map<SoundId, HTMLAudioElement>();

function play(soundId: SoundId, volume: number): void {
  if (typeof window === "undefined") return;
  let audio = audioCache.get(soundId);
  if (!audio) {
    audio = new Audio(`/sounds/${soundId}.mp3`);
    audio.preload = "auto";
    audioCache.set(soundId, audio);
  }
  audio.volume = volume;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    /* autoplay blocked or hardware unavailable - silent failure */
  });
}

export function playNotificationSound(category: NotificationCategory): void {
  const state = useNotificationSoundStore.getState();
  const cfg = state[category];
  if (!cfg.enabled) return;
  play(cfg.soundId, state.volume);
}

// Used by Test buttons in Settings to preview a sound regardless of
// the category's enabled flag.
export function playSoundById(soundId: SoundId): void {
  const { volume } = useNotificationSoundStore.getState();
  play(soundId, volume);
}
