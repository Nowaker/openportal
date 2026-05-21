import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TtsState {
  enabled: boolean;
  rate: number;
  pitch: number;
  voice: string | null;
  setEnabled: (on: boolean) => void;
  setRate: (rate: number) => void;
  setPitch: (pitch: number) => void;
  setVoice: (voice: string | null) => void;
}

export const useTtsStore = create<TtsState>()(
  persist(
    (set) => ({
      enabled: false,
      rate: 1.0,
      pitch: 1.0,
      voice: null,
      setEnabled: (enabled) => set({ enabled }),
      setRate: (rate) => set({ rate: Math.max(0.5, Math.min(2.0, rate)) }),
      setPitch: (pitch) => set({ pitch: Math.max(0, Math.min(2.0, pitch)) }),
      setVoice: (voice) => set({ voice }),
    }),
    { name: "openportal-tts" },
  ),
);

let activeUtterance: SpeechSynthesisUtterance | null = null;

export function speakText(text: string): void {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  const { enabled, rate, pitch, voice } = useTtsStore.getState();
  if (!enabled) return;
  if (!text.trim()) return;
  const stripped = text
    .replace(/```[\s\S]*?```/g, "[code block]")
    .replace(/`[^`]+`/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "[image]")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(stripped);
  utter.rate = rate;
  utter.pitch = pitch;
  if (voice) {
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.name === voice);
    if (match) utter.voice = match;
  }
  activeUtterance = utter;
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking(): void {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  activeUtterance = null;
}

export function isSpeaking(): boolean {
  if (typeof window === "undefined") return false;
  if (!("speechSynthesis" in window)) return false;
  return window.speechSynthesis.speaking;
}
