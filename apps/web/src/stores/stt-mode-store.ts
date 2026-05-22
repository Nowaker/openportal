import { create } from "zustand";
import { persist } from "zustand/middleware";

// STT preferences live per-tab/per-device in localStorage; not synced via the
// cross-device settings pipeline because mic + audio capabilities vary by
// browser/OS, and the sidecar URL is host-specific.
//
// Mode controls the interaction surface in the composer:
//   off          - no mic UI in the composer
//   push-to-talk - tap to start, tap again to stop + auto-submit the prompt
//   vad          - tap to toggle continuous listening; user submits manually
//
// Backend chooses the actual transcription engine:
//   web-speech     - browser's SpeechRecognition (free, on-device on some
//                    Chromium builds, cloud on others). Quick to enable.
//   whisper-sidecar - POSTs audio to the @openportal/voice-stt service,
//                    which runs whisper.cpp locally. Privacy + accuracy.
export type SttMode = "off" | "push-to-talk" | "vad";
export type SttBackend = "web-speech" | "whisper-sidecar";

interface SttModeState {
  mode: SttMode;
  backend: SttBackend;
  sidecarUrl: string;
  endOfStreamTimeoutMs: number;
  autoSubmitOnEnd: boolean;
  setMode: (mode: SttMode) => void;
  setBackend: (backend: SttBackend) => void;
  setSidecarUrl: (url: string) => void;
  setEndOfStreamTimeoutMs: (ms: number) => void;
  setAutoSubmitOnEnd: (autoSubmit: boolean) => void;
}

export const useSttModeStore = create<SttModeState>()(
  persist(
    (set) => ({
      mode: "off",
      backend: "web-speech",
      sidecarUrl: "http://127.0.0.1:4150",
      endOfStreamTimeoutMs: 5000,
      autoSubmitOnEnd: false,
      setMode: (mode) => set({ mode }),
      setBackend: (backend) => set({ backend }),
      setSidecarUrl: (sidecarUrl) => set({ sidecarUrl }),
      setEndOfStreamTimeoutMs: (endOfStreamTimeoutMs) => set({ endOfStreamTimeoutMs }),
      setAutoSubmitOnEnd: (autoSubmitOnEnd) => set({ autoSubmitOnEnd }),
    }),
    { name: "openportal-stt-mode" },
  ),
);
