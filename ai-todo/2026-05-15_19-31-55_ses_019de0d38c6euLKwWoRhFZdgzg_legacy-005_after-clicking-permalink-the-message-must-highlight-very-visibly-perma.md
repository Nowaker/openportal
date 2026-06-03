---
status: DONE
commit: 695ae79
session: ses_019de0d38c6euLKwWoRhFZdgzg
queued_at: 2026-05-15T19:31:55-05:00
legacy_number: 5
---

# "After clicking permalink, the message must highlight very visibly" + permalink-UX

User prompt:

> 2. after clicking permanlink https://portal.desktop.ts.nowaker.net:8443/session/ses_019de0d38c6euLKwWoRhFZdgzg?server=srv-2dy1srwz#msg-msg_e2e26f34d001s9sGAKYu3JpLP9 must highlight very visibily the message permalinked.
> 3. permalinks when clicked within the chat log, shouldn't really do anything. you see that message, you click on it, you open it, but it's in front of you anyway, so just highlight it and that's it.
> 4. permalinks: click to copy and open... uhm, what, click to copy? click is open, not copy. right click copy, or on phone hold and copy, is how you copy. cick to copy is nonsense.
> 5. links in sidebar don't include server permalink. screen other places where server permalink missing.

Items 2-4 = permalink-UX work (highlight on arrival, no-op on in-view, no "click to copy" semantic). Item 5 = audit pass for missing `?server=` queries.
