import { useCallback, useEffect, useRef, useState } from "react";

// Whisper-sidecar transcriber. Captures mic audio via MediaRecorder, uploads
// the resulting blob to the sidecar's POST /transcribe endpoint, and forwards
// the transcript via onTranscript. Continuous (VAD) mode is implemented by
// segmenting on browser-side silence detection (RMS analyser threshold) and
// firing a /transcribe upload per detected utterance; in PTT mode there's
// just one upload per start/stop cycle.
//
// The contract intentionally mirrors useSpeechRecognition so the composer
// can swap engines via a single backend setting without reshaping its state.

interface UseWhisperRecorderOptions {
  continuous?: boolean;
  sidecarUrl: string;
  onTranscript: (text: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

interface UseWhisperRecorderResult {
  isSupported: boolean;
  isListening: boolean;
  start: () => void;
  stop: () => void;
}

const VAD_RMS_THRESHOLD = 0.015;
const VAD_SILENCE_MS = 5000;
const VAD_MIN_UTTERANCE_MS = 600;
const ANALYSER_FFT_SIZE = 512;

async function uploadBlobForTranscription(
  url: string,
  blob: Blob,
): Promise<string> {
  const target = url.replace(/\/+$/, "") + "/transcribe";
  const ext = blob.type.includes("ogg")
    ? "ogg"
    : blob.type.includes("wav")
      ? "wav"
      : "webm";
  const form = new FormData();
  form.append("audio", blob, `audio.${ext}`);
  const res = await fetch(target, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sidecar HTTP ${res.status}: ${text || "transcription failed"}`);
  }
  const data = (await res.json()) as { text?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return (data.text ?? "").trim();
}

export function useWhisperRecorder({
  continuous,
  sidecarUrl,
  onTranscript,
  onError,
  onEnd,
}: UseWhisperRecorderOptions): UseWhisperRecorderResult {
  const [isListening, setIsListening] = useState(false);
  const callbackRef = useRef({ onTranscript, onError, onEnd });
  callbackRef.current = { onTranscript, onError, onEnd };

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const utteranceStartedAtRef = useRef<number | null>(null);
  const lastVoiceAtRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const continuousRef = useRef(continuous ?? false);
  continuousRef.current = continuous ?? false;
  const sidecarUrlRef = useRef(sidecarUrl);
  sidecarUrlRef.current = sidecarUrl;

  const isSupported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const cleanupRecorder = useCallback(() => {
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    try {
      sourceRef.current?.disconnect();
    } catch {}
    sourceRef.current = null;
    try {
      analyserRef.current?.disconnect();
    } catch {}
    analyserRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {}
    }
    recorderRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
    }
    streamRef.current = null;
  }, []);

  const finalizeRecorderToBlob = useCallback(
    (recorder: MediaRecorder, chunks: BlobPart[]): Promise<Blob> => {
      return new Promise<Blob>((resolve) => {
        const onStop = () => {
          recorder.removeEventListener("stop", onStop);
          resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        };
        recorder.addEventListener("stop", onStop);
        if (recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch {
            resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
          }
        } else {
          resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        }
      });
    },
    [],
  );

  const transcribeAndDispatch = useCallback(async (blob: Blob) => {
    try {
      const text = await uploadBlobForTranscription(sidecarUrlRef.current, blob);
      if (text) callbackRef.current.onTranscript(text);
    } catch (err) {
      callbackRef.current.onError?.(
        err instanceof Error ? err.message : "transcription failed",
      );
    }
  }, []);

  const startInternal = useCallback(async () => {
    if (!isSupported) {
      callbackRef.current.onError?.("Microphone not supported in this browser");
      return;
    }
    if (recorderRef.current) return;
    stoppingRef.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      callbackRef.current.onError?.(
        err instanceof Error ? err.message : "Microphone permission denied",
      );
      return;
    }
    streamRef.current = stream;

    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"]
      .find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    recorderRef.current = recorder;
    let chunks: BlobPart[] = [];

    recorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    });

    if (continuousRef.current) {
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      analyserRef.current = analyser;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      utteranceStartedAtRef.current = null;
      lastVoiceAtRef.current = null;

      // Visibility-change guard: requestAnimationFrame PAUSES when the
      // browser tab is hidden, but MediaRecorder keeps capturing audio.
      // When the tab becomes visible again, lastVoiceAtRef is stale (it
      // holds a timestamp from BEFORE the tab was hidden). On the very
      // next tick() the silence-since check `now - lastVoiceAtRef >
      // VAD_SILENCE_MS` fires immediately even though the user may have
      // resumed speaking the instant they switched back. That's the
      // 'premature flush' the user reported - the utterance gets cut
      // off the moment focus returns. Fix: on tab becoming visible,
      // refresh both timers to NOW so the silence countdown restarts
      // from a known-good baseline.
      const onVisibility = () => {
        if (document.visibilityState !== "visible") return;
        const now = performance.now();
        if (lastVoiceAtRef.current !== null) lastVoiceAtRef.current = now;
        if (utteranceStartedAtRef.current !== null) {
          utteranceStartedAtRef.current = now;
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      const detachVisibility = () => {
        document.removeEventListener("visibilitychange", onVisibility);
      };
      recorder.addEventListener("stop", detachVisibility, { once: true });

      const tick = () => {
        if (!analyserRef.current || !recorderRef.current) return;
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = buffer[i] ?? 0;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffer.length);
        const now = performance.now();
        if (rms > VAD_RMS_THRESHOLD) {
          if (utteranceStartedAtRef.current === null) {
            utteranceStartedAtRef.current = now;
          }
          lastVoiceAtRef.current = now;
        } else if (
          utteranceStartedAtRef.current !== null &&
          lastVoiceAtRef.current !== null &&
          now - lastVoiceAtRef.current > VAD_SILENCE_MS &&
          now - utteranceStartedAtRef.current > VAD_MIN_UTTERANCE_MS
        ) {
          const r = recorderRef.current;
          const captured = chunks;
          chunks = [];
          utteranceStartedAtRef.current = null;
          lastVoiceAtRef.current = null;
          void finalizeRecorderToBlob(r, captured).then((blob) => {
            void transcribeAndDispatch(blob);
            try {
              r.start(250);
            } catch {}
          });
        }
        vadRafRef.current = requestAnimationFrame(tick);
      };
      recorder.start(250);
      vadRafRef.current = requestAnimationFrame(tick);
    } else {
      recorder.start();
    }

    setIsListening(true);
    recorder.addEventListener("stop", () => {
      if (stoppingRef.current) {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        chunks = [];
        if (blob.size > 0) {
          void transcribeAndDispatch(blob).finally(() => {
            cleanupRecorder();
            setIsListening(false);
            callbackRef.current.onEnd?.();
          });
        } else {
          cleanupRecorder();
          setIsListening(false);
          callbackRef.current.onEnd?.();
        }
        stoppingRef.current = false;
      }
    });
  }, [isSupported, cleanupRecorder, finalizeRecorderToBlob, transcribeAndDispatch]);

  const start = useCallback(() => {
    void startInternal();
  }, [startInternal]);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {}
    } else {
      cleanupRecorder();
      setIsListening(false);
      callbackRef.current.onEnd?.();
    }
  }, [cleanupRecorder]);

  useEffect(() => {
    return () => {
      cleanupRecorder();
    };
  }, [cleanupRecorder]);

  return { isSupported, isListening, start, stop };
}
