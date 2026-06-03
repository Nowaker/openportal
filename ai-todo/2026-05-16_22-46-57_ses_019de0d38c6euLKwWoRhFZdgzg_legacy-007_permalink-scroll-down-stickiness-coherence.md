---
status: DONE
commit: 
session: ses_019de0d38c6euLKwWoRhFZdgzg
queued_at: 2026-05-16T22:46:57-05:00
legacy_number: 7
---

# Permalink + scroll-down-stickiness coherence

User prompt:

> 21. remember about scrolldown stickiness. if we're in sticky mode WE MUST ALWAYS BE SCROLLED DOWN. say, stuck notification showed, lost connection banner appeared, etc — these inject content that shifts the bottom; the stuck-at-bottom must re-pin to the new bottom.

Banner injections (build-mismatch, reconnecting, stuck-detector, etc.) shift document height. Sticky-bottom must re-pin on those height changes. Need a single observer hook that handles resize → re-pin.
