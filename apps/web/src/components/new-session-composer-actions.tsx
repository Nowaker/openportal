import { MicrophoneIcon, PlayIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import type { NewSessionSttController } from "@/hooks/use-new-session-stt";

interface NewSessionComposerActionsProps {
  readonly stt: NewSessionSttController;
  readonly sending: boolean;
  readonly submissionDisabled: boolean;
  readonly hasContent: boolean;
  readonly pendingAttachmentsCount: number;
}

export function NewSessionComposerActions({
  stt,
  sending,
  submissionDisabled,
  hasContent,
  pendingAttachmentsCount,
}: NewSessionComposerActionsProps) {
  const {
    speechRecognition,
    sttMode,
    sttAutoSubmitOnEnd,
    sttTimeoutProgress,
    sttCountdownDigit,
    handleMicToggle,
  } = stt;
  return (
    <div className="pointer-events-none absolute bottom-1 right-1 flex flex-col items-end gap-1.5">
      {sttMode !== "off" && speechRecognition.isSupported && (
        <div className="pointer-events-auto flex w-12 gap-0 justify-end">
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              handleMicToggle();
            }}
            className={`relative size-6 rounded-md inline-flex items-center justify-center transition-colors ${
              speechRecognition.isListening
                ? "bg-red-500 text-white"
                : "bg-muted hover:bg-muted/80 text-muted-fg"
            } ${speechRecognition.isListening && sttTimeoutProgress === null ? "animate-pulse" : ""}`}
            aria-label={
              speechRecognition.isListening
                ? "Stop voice input"
                : "Start voice input"
            }
            title={
              sttMode === "push-to-talk"
                ? speechRecognition.isListening
                  ? "Tap to stop and submit"
                  : "Tap to start; tap again to stop and submit"
                : speechRecognition.isListening
                  ? "Tap to stop listening"
                  : "Tap to start continuous listening"
            }
          >
            {sttTimeoutProgress !== null && (
              <svg
                className="absolute inset-0 size-full -rotate-90"
                viewBox="0 0 24 24"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="62.83"
                  strokeDashoffset={62.83 - (62.83 * sttTimeoutProgress) / 100}
                  className="text-white/50 transition-all duration-75"
                />
              </svg>
            )}
            <MicrophoneIcon className="size-3" />
          </button>
        </div>
      )}
      <Button
        type="submit"
        isDisabled={
          sending ||
          submissionDisabled ||
          (!hasContent && pendingAttachmentsCount === 0)
        }
        className={`pointer-events-auto size-12 !p-0 ${
          sttCountdownDigit !== null ? "animate-pulse" : ""
        }`}
        aria-label={
          sttCountdownDigit !== null
            ? sttAutoSubmitOnEnd
              ? `Auto-submit in ${sttCountdownDigit}`
              : `Voice grace ${sttCountdownDigit}`
            : sending
              ? "Starting…"
              : submissionDisabled
                ? "Waiting for init templates"
              : "Send"
        }
      >
        {sttCountdownDigit !== null ? (
          <span
            className="text-2xl font-bold tabular-nums"
            data-test="portal-composer-stt-countdown"
          >
            {sttCountdownDigit}
          </span>
        ) : (
          <PlayIcon className="size-6" />
        )}
      </Button>
    </div>
  );
}
