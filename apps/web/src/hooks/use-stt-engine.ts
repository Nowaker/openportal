import { useSttModeStore } from "@/stores/stt-mode-store";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useWhisperRecorder } from "@/hooks/use-whisper-recorder";

export interface UseSttEngineOptions {
  continuous?: boolean;
  onTranscript: (text: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export interface UseSttEngineResult {
  isSupported: boolean;
  isListening: boolean;
  start: () => void;
  stop: () => void;
}

// Backend-aware facade. Always instantiates both engines (cheap; neither
// touches the mic until .start() fires) and routes by the user's backend
// setting. Keeps the composer mic logic backend-agnostic - it just calls
// .start()/.stop() and consumes onTranscript regardless of which engine is
// active. Switching backends in Settings takes effect immediately because
// both refs stay live; the next start() goes through the new branch.
export function useSttEngine(opts: UseSttEngineOptions): UseSttEngineResult {
  const backend = useSttModeStore((s) => s.backend);
  const sidecarUrl = useSttModeStore((s) => s.sidecarUrl);

  const webSpeech = useSpeechRecognition(opts);
  const whisper = useWhisperRecorder({ ...opts, sidecarUrl });

  return backend === "whisper-sidecar" ? whisper : webSpeech;
}
