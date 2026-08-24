import { useCallback, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useSttEngine } from "@/hooks/use-stt-engine";
import { useSttModeStore } from "@/stores/stt-mode-store";

export interface NewSessionSttController {
  readonly speechRecognition: ReturnType<typeof useSttEngine>;
  readonly sttMode: ReturnType<typeof useSttModeStore.getState>["mode"];
  readonly sttAutoSubmitOnEnd: boolean;
  readonly sttEndOfStreamTimeoutMs: number;
  readonly sttTimeoutProgress: number | null;
  readonly sttCountdownDigit: number | null;
  readonly sttTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
  readonly cancelSttTimeout: () => void;
  readonly handleMicToggle: () => void;
}

export function useNewSessionStt(input: {
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly scheduleDraftSave: (value: string) => void;
  readonly hasUserEditedRef: RefObject<boolean>;
  readonly handleSubmit: (override?: string) => Promise<void>;
}): NewSessionSttController {
  const {
    textareaRef,
    setText,
    scheduleDraftSave,
    hasUserEditedRef,
    handleSubmit,
  } = input;

  const sttMode = useSttModeStore((s) => s.mode);
  const sttEndOfStreamTimeoutMs = useSttModeStore(
    (s) => s.endOfStreamTimeoutMs,
  );
  const sttAutoSubmitOnEnd = useSttModeStore((s) => s.autoSubmitOnEnd);
  const sttSubmitOnEndRef = useRef(false);
  const sttTranscriptArrivedRef = useRef(false);
  const [sttTimeoutProgress, setSttTimeoutProgress] = useState<number | null>(
    null,
  );
  const sttTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sttIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Visible "5..1" digit on the submit button during STT grace window.
  // Clamped at 1 so the button never shows 0 - auto-submit happens AT 0.
  const sttCountdownDigit =
    sttTimeoutProgress !== null && sttEndOfStreamTimeoutMs > 0
      ? Math.max(
          1,
          Math.ceil(
            ((100 - sttTimeoutProgress) / 100) *
              (sttEndOfStreamTimeoutMs / 1000),
          ),
        )
      : null;

  const cancelSttTimeout = useCallback(() => {
    if (sttTimeoutRef.current) clearTimeout(sttTimeoutRef.current);
    if (sttIntervalRef.current) clearInterval(sttIntervalRef.current);
    sttTimeoutRef.current = null;
    sttIntervalRef.current = null;
    setSttTimeoutProgress(null);
  }, []);

  const speechRecognition = useSttEngine({
    continuous: sttMode === "vad",
    onTranscript: (transcript) => {
      cancelSttTimeout();
      sttTranscriptArrivedRef.current = true;
      const ta = textareaRef.current;
      if (!ta) return;
      const current = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = current.substring(0, start);
      const after = current.substring(end);
      const sepBefore =
        before && !before.endsWith(" ") && !before.endsWith("\n") ? " " : "";
      const sepAfter =
        after && !after.startsWith(" ") && !after.startsWith("\n") ? " " : "";
      const insert = `${sepBefore}${transcript}${sepAfter}`;
      const next = before + insert + after;
      setText(next);
      scheduleDraftSave(next);
      setTimeout(() => {
        const ref = textareaRef.current;
        if (!ref) return;
        ref.selectionStart = start + insert.length - sepAfter.length;
        ref.selectionEnd = ref.selectionStart;
        const active = document.activeElement;
        const onComposerSurface =
          active === ref ||
          active === document.body ||
          active === null ||
          active === document.documentElement;
        if (onComposerSurface) {
          ref.focus({ preventScroll: true });
        }
      }, 0);
      hasUserEditedRef.current = true;
    },
    onEnd: () => {
      if (sttMode === "push-to-talk" && sttSubmitOnEndRef.current) {
        sttSubmitOnEndRef.current = false;
        cancelSttTimeout();
        if (sttTranscriptArrivedRef.current && sttAutoSubmitOnEnd) {
          sttTranscriptArrivedRef.current = false;
          void handleSubmit();
        } else {
          sttTranscriptArrivedRef.current = false;
        }
      } else if (sttMode === "push-to-talk" && sttEndOfStreamTimeoutMs > 0) {
        const startTime = Date.now();
        setSttTimeoutProgress(0);

        sttIntervalRef.current = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(
            100,
            (elapsed / sttEndOfStreamTimeoutMs) * 100,
          );
          setSttTimeoutProgress(progress);
        }, 50);

        sttTimeoutRef.current = setTimeout(() => {
          cancelSttTimeout();
          if (speechRecognition.isListening) {
            sttSubmitOnEndRef.current = true;
            speechRecognition.stop();
          } else {
            sttSubmitOnEndRef.current = false;
            if (sttTranscriptArrivedRef.current && sttAutoSubmitOnEnd) {
              sttTranscriptArrivedRef.current = false;
              void handleSubmit();
            } else {
              sttTranscriptArrivedRef.current = false;
            }
          }
        }, sttEndOfStreamTimeoutMs);

        setTimeout(() => {
          if (sttTimeoutRef.current) {
            speechRecognition.start();
          }
        }, 10);
      }
    },
  });

  const handleMicToggle = () => {
    if (speechRecognition.isListening || sttTimeoutRef.current) {
      sttSubmitOnEndRef.current = sttMode === "push-to-talk";
      cancelSttTimeout();
      void speechRecognition.stop();
      if (sttTranscriptArrivedRef.current && sttAutoSubmitOnEnd) {
        sttTranscriptArrivedRef.current = false;
        void handleSubmit();
      } else {
        sttTranscriptArrivedRef.current = false;
      }
    } else {
      sttSubmitOnEndRef.current = false;
      sttTranscriptArrivedRef.current = false;
      void speechRecognition.start();
    }
  };

  return {
    speechRecognition,
    sttMode,
    sttAutoSubmitOnEnd,
    sttEndOfStreamTimeoutMs,
    sttTimeoutProgress,
    sttCountdownDigit,
    sttTimeoutRef,
    cancelSttTimeout,
    handleMicToggle,
  };
}
