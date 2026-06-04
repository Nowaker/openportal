---
status: DONE
session: ses_1b66ba2aaffeW7xyxcjmde6oYq
queued_at: 2026-05-21T19:37:52-05:00
legacy_number: 8
commits:
  attributed:
    - 44dba1ebcd1e
  on_main:
    - 44dba1ebcd1e
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Voice-input "stops the stream sometimes" residual bug

User prompt:

> I suspect something is interrupting the input voice input collection process and triggering it to flush right away or something like that maybe it's hearing me even though I'm not active in mic at the time but my voice is propagating somewhere from the speakers or maybe it's only hearing me when I start a sentence so it does some weird buffering and dimming when it figures out I'm not...

`030bc13` plugged one premature-flush leak. User suspects there's STILL a leak. Fresh debugging pass on VAD threshold + buffering logic.
