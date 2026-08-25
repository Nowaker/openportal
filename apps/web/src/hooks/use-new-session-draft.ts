import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import useMediaQuery from "@/hooks/use-media-query";
import {
  DRAFT_MIN_BYTES,
  newSessionDraftKey,
  readDraft,
  writeDraft,
} from "@/lib/session-indicators";

export interface NewSessionDraftController {
  readonly text: string;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  readonly submittedRef: MutableRefObject<boolean>;
  readonly hasUserEditedRef: MutableRefObject<boolean>;
  readonly draftSaveTimerRef: MutableRefObject<number | null>;
  readonly draftKey: string | null;
  readonly scheduleDraftSave: (value: string) => void;
}

export function clearVirtualSessionIfAbandoned(
  submittedRef: MutableRefObject<boolean>,
  clearStore: () => void,
): void {
  if (!submittedRef.current) clearStore();
}

export function draftTextForContext(
  draftKey: string | null,
  autoPrompt: string | undefined,
): string {
  if (autoPrompt) return autoPrompt;
  return draftKey ? readDraft(draftKey) : "";
}

function shouldPersistDraft(draftKey: string, value: string): boolean {
  if (value.length === 0) return false;
  if (value.length >= DRAFT_MIN_BYTES) return true;
  return readDraft(draftKey).length === 0;
}

// Owns text state, textarea ref, submitted/hasUserEdited/draft-save-timer
// refs, draft restore on directory change, focus-on-mount, and the
// unmount cleanup that persists the current draft. Init templates do NOT
// prefill the textarea any more - they are prepended on submit as
// "/template Name" lines and expanded server-side. Only refire-from-
// history (autoPrompt) or a previous draft ever populates the textarea
// on mount.
export function useNewSessionDraft(
  directory: string | null,
  autoPrompt: string | undefined,
  isMobile: boolean,
): NewSessionDraftController {
  const draftKey = directory ? newSessionDraftKey(directory) : null;

  const [text, setText] = useState(() =>
    draftTextForContext(draftKey, autoPrompt),
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittedRef = useRef(false);
  const hasUserEditedRef = useRef(
    Boolean(!autoPrompt && draftKey && readDraft(draftKey)),
  );
  const draftSaveTimerRef = useRef<number | null>(null);
  const activeDraftKeyRef = useRef(draftKey);
  const previousDraftKeyRef = useRef(draftKey);

  // When the user navigates from /session/new?directory=A to
  // ?directory=B (sidebar + on a different project) the component stays
  // mounted and draftKey switches. Load B's draft into the composer;
  // useLayoutEffect (not useEffect) so the swap happens before paint
  // without a flash of A's text. Synchronous restore on initial mount
  // already happened in the useState initializer; this effect handles
  // the in-mount change.
  useLayoutEffect(() => {
    const previousDraftKey = previousDraftKeyRef.current;
    if (previousDraftKey !== draftKey) {
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      const previousText = textareaRef.current?.value ?? "";
      if (
        previousDraftKey &&
        !submittedRef.current &&
        shouldPersistDraft(previousDraftKey, previousText)
      ) {
        writeDraft(previousDraftKey, previousText);
      }
    }
    const nextText = draftTextForContext(draftKey, autoPrompt);
    setText(nextText);
    hasUserEditedRef.current = Boolean(!autoPrompt && nextText);
    submittedRef.current = false;
    activeDraftKeyRef.current = draftKey;
    previousDraftKeyRef.current = draftKey;
  }, [draftKey, autoPrompt]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const persistShortIfNoPrior = useCallback(
    (value: string) => {
      return draftKey ? shouldPersistDraft(draftKey, value) : false;
    },
    [draftKey],
  );

  const scheduleDraftSave = useCallback(
    (value: string) => {
      if (!draftKey) return;
      if (!persistShortIfNoPrior(value)) return;
      if (!isMobile) {
        writeDraft(draftKey, value);
        return;
      }
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
      }
      draftSaveTimerRef.current = window.setTimeout(() => {
        writeDraft(draftKey, value);
        draftSaveTimerRef.current = null;
      }, 5000);
    },
    [draftKey, persistShortIfNoPrior, isMobile],
  );

  useEffect(
    () => () => {
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      if (submittedRef.current) return;
      const activeDraftKey = activeDraftKeyRef.current;
      if (!activeDraftKey) return;
      const value = textareaRef.current?.value ?? "";
      if (shouldPersistDraft(activeDraftKey, value)) {
        writeDraft(activeDraftKey, value);
      }
    },
    [],
  );

  return {
    text,
    setText,
    textareaRef,
    submittedRef,
    hasUserEditedRef,
    draftSaveTimerRef,
    draftKey,
    scheduleDraftSave,
  };
}
