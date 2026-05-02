import { useCallback, useEffect, useRef, useState } from "react";

// Browser-native Web Speech API wrapper. Works on Android Chrome over the
// tailnet; degrades gracefully (isSupported=false) on browsers that lack it.
// Future: Whisper sidecar will replace this layer for self-hosted privacy +
// better accuracy. Same hook surface so the composer doesn't change when we
// swap the engine.

interface UseSpeechRecognitionOptions {
  continuous?: boolean;
  onTranscript: (text: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

interface UseSpeechRecognitionResult {
  isSupported: boolean;
  isListening: boolean;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    [index: number]: { transcript: string };
  }>;
}

interface SpeechRecognitionErrorEvent {
  error?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition({
  continuous,
  onTranscript,
  onError,
  onEnd,
}: UseSpeechRecognitionOptions): UseSpeechRecognitionResult {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [isListening, setIsListening] = useState(false);
  const callbackRef = useRef({ onTranscript, onError, onEnd });
  callbackRef.current = { onTranscript, onError, onEnd };

  const isSupported = typeof window !== "undefined" &&
    getSpeechRecognitionCtor() !== null;

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      callbackRef.current.onError?.("Speech recognition not supported in this browser");
      return;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }
    const recognition = new Ctor();
    recognition.continuous = continuous ?? false;
    recognition.interimResults = false;
    recognition.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    recognition.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) text += r[0].transcript;
      }
      const trimmed = text.trim();
      if (trimmed) callbackRef.current.onTranscript(trimmed);
    };
    recognition.onerror = (event) => {
      const code = event.error ?? "speech-recognition-error";
      // 'aborted' fires when stop() is called before the engine produced a
      // result and 'no-speech' fires when the user stayed silent. Both are
      // legitimate user actions, not failures - swallow them so the toast
      // doesn't spam on every empty PTT session.
      if (code !== "aborted" && code !== "no-speech") {
        callbackRef.current.onError?.(code);
      }
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      callbackRef.current.onEnd?.();
    };
    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
    } catch (err) {
      callbackRef.current.onError?.(
        err instanceof Error ? err.message : "Failed to start speech recognition",
      );
    }
  }, [continuous]);

  const stop = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    try { r.stop(); } catch {}
  }, []);

  useEffect(() => {
    return () => {
      const r = recognitionRef.current;
      if (r) {
        try { r.abort(); } catch {}
      }
    };
  }, []);

  return { isSupported, isListening, start, stop };
}
