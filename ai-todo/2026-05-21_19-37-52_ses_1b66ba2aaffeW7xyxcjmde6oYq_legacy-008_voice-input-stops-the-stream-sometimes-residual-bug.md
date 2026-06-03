---
status: DONE
commit: 44dba1e
session: ses_1b66ba2aaffeW7xyxcjmde6oYq
queued_at: 2026-05-21T19:37:52-05:00
legacy_number: 8
---

# Voice-input "stops the stream sometimes" residual bug

User prompt:

> I suspect something is interrupting the input voice input collection process and triggering it to flush right away or something like that maybe it's hearing me even though I'm not active in mic at the time but my voice is propagating somewhere from the speakers or maybe it's only hearing me when I start a sentence so it does some weird buffering and dimming when it figures out I'm not...

`030bc13` plugged one premature-flush leak. User suspects there's STILL a leak. Fresh debugging pass on VAD threshold + buffering logic.
