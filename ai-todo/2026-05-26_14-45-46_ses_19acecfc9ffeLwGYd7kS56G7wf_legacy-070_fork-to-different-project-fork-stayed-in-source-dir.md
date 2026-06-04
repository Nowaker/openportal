---
status: DONE
session: ses_19acecfc9ffeLwGYd7kS56G7wf
queued_at: 2026-05-26T14:45:46-05:00
legacy_number: 70
commits:
  attributed:
    - 3ad3c598bf17
  on_main:
    - 3ad3c598bf17
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Fork-to-different-project: fork stayed in source dir

User prompt (verbatim):

> then: forking into a different project did not result in a fork moved to the target project/directory. inspect why.

Design notes:
- Section L (entry #1 in PENDING) shipped the Fork dialog with project picker. User reports the fork backend isn't actually relocating the forked session to the chosen target directory — it stays in the source session's directory.
- Inspect `/api/opencode/[port]/session/[id]/fork` handler: opencode's `/session/{id}/fork` accepts the body but session.directory may be IMMUTABLE per the opencode public API (see prompt-archive.ts:91-93). If immutable, forking + then move-local-style relocation is required. Confirm with opencode SDK.
- Likely fix: chain fork → moveLocal(forkId, targetPath) when targetPath differs from source. Reuse the existing move-to-project endpoint plumbing (move-local.ts + the section M backend). On success, route browser to the new session in the new directory.
