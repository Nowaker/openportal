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

  const [text, setText] = useState(() => {
    if (autoPrompt) return autoPrompt;
    if (draftKey) {
      const d = readDraft(draftKey);
      if (d) return d;
    }
    return "";
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittedRef = useRef(false);
  const hasUserEditedRef = useRef(
    Boolean(!autoPrompt && draftKey && readDraft(draftKey)),
  );
  const draftSaveTimerRef = useRef<number | null>(null);

  // When the user navigates from /session/new?directory=A to
  // ?directory=B (sidebar + on a different project) the component stays
  // mounted and draftKey switches. Load B's draft into the composer;
  // useLayoutEffect (not useEffect) so the swap happens before paint
  // without a flash of A's text. Synchronous restore on initial mount
  // already happened in the useState initializer; this effect handles
  // the in-mount change.
  useLayoutEffect(() => {
    if (autoPrompt) return;
    if (!draftKey) return;
    const d = readDraft(draftKey);
    if (d) {
      setText(d);
      hasUserEditedRef.current = true;
    }
  }, [draftKey, autoPrompt]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const persistShortIfNoPrior = useCallback(
    (value: string) => {
      if (!draftKey) return false;
      if (value.length === 0) return false;
      if (value.length >= DRAFT_MIN_BYTES) return true;
      return readDraft(draftKey).length === 0;
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

  useEffect(() => {
    return () => {
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      if (submittedRef.current) return;
      if (!draftKey) return;
      const value = textareaRef.current?.value ?? "";
      if (persistShortIfNoPrior(value)) {
        writeDraft(draftKey, value);
      }
    };
  }, [draftKey, persistShortIfNoPrior]);

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
