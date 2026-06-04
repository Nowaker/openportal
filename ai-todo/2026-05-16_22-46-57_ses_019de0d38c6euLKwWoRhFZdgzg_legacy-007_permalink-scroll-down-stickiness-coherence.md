---
status: DONE
session: ses_019de0d38c6euLKwWoRhFZdgzg
queued_at: 2026-05-16T22:46:57-05:00
legacy_number: 7
commits:
  attributed:
    - 14acda5dc8f8
  on_main:
    - 14acda5dc8f8
  reverted: false
verdict: present
verdict_reason: "Commit 14acda5 on main: 'feat(session): sticky-bottom scroll + floating jump-to-bottom button'. ResizeObserver at apps/web/src/routes/_app/session/$id.tsx:4226 invokes scrollToBottom() on container resize so banners re-pin"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Permalink + scroll-down-stickiness coherence

User prompt:

> 21. remember about scrolldown stickiness. if we're in sticky mode WE MUST ALWAYS BE SCROLLED DOWN. say, stuck notification showed, lost connection banner appeared, etc — these inject content that shifts the bottom; the stuck-at-bottom must re-pin to the new bottom.

Banner injections (build-mismatch, reconnecting, stuck-detector, etc.) shift document height. Sticky-bottom must re-pin on those height changes. Need a single observer hook that handles resize → re-pin.
