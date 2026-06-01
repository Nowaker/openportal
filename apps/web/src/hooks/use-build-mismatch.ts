import { useEffect, useState } from "react";
import { logSystemMessage } from "@/stores/system-messages-store";

declare const __OPENPORTAL_BUILD_ID__: string;

const HEADER = "X-OpenPortal-Build";
const COMMIT_SUBJECT_HEADER = "X-OpenPortal-Commit-Subject";
const COMMIT_SHA_HEADER = "X-OpenPortal-Commit-Sha";
const GITLAB_COMMIT_BASE_URL = "https://gitlab.com/Nowaker/openportal/-/commit/";
const POLL_URL = "/api/instance/self";
const POLL_INTERVAL_MS = 60_000;

export interface BuildMismatchState {
  mismatched: boolean;
  incomingCommitSubject: string | null;
  incomingCommitUrl: string | null;
}

// Detects when the running Portal backend has been upgraded to a build
// different from the one this browser tab loaded its bundle from. We piggy-
// back on the existing /api/instance/self ping (cheap, already used by
// connection-monitor) - on the first response that comes back with a
// X-OpenPortal-Build header that disagrees with this bundle's baked-in id,
// we lock in `mismatched=true` and never reset to false (one-way trapdoor;
// once the user is informed they should reload, no value in flipping back
// even if the server downgrades - the right action is still a reload).
//
// Side-effect-free: we do NOT auto-reload. Surfacing an explicit banner
// per user spec lets the user finish whatever they're typing first.
export function useBuildMismatch(): BuildMismatchState {
  const [state, setState] = useState<BuildMismatchState>({
    mismatched: false,
    incomingCommitSubject: null,
    incomingCommitUrl: null,
  });

  useEffect(() => {
    if (state.mismatched) return;
    if (typeof __OPENPORTAL_BUILD_ID__ !== "string") return;
    const ours = __OPENPORTAL_BUILD_ID__;
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await fetch(POLL_URL, { cache: "no-store" });
        if (cancelled) return;
        const theirs = res.headers.get(HEADER);
        if (theirs && theirs !== ours) {
          const incomingCommitSubject =
            res.headers.get(COMMIT_SUBJECT_HEADER)?.trim() || null;
          const incomingCommitSha = res.headers.get(COMMIT_SHA_HEADER)?.trim() || "";
          const incomingCommitUrl = incomingCommitSha
            ? `${GITLAB_COMMIT_BASE_URL}${incomingCommitSha}`
            : null;
          setState({
            mismatched: true,
            incomingCommitSubject,
            incomingCommitUrl,
          });
          logSystemMessage(
            "version",
            "info",
            `OpenPortal upgraded: this tab is running ${ours}, latest is ${theirs}`,
            `This browser tab loaded OpenPortal build ${ours}.\nThe backend is now serving build ${theirs}.\nReload (Ctrl+R / Cmd+R) to upgrade the tab.\n\nNote: builds are content-hashed (not sequential), so we cannot show 'N versions behind' - only the loaded vs latest build IDs.`,
          );
        }
      } catch {
        // network blip - unrelated to build mismatch
      }
    };
    void probe();
    const id = window.setInterval(() => void probe(), POLL_INTERVAL_MS);
    const onFocus = () => void probe();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [state.mismatched]);

  return state;
}
