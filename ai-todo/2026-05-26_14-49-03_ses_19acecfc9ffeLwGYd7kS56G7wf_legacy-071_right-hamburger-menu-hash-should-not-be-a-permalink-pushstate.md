---
status: DONE
session: ses_19acecfc9ffeLwGYd7kS56G7wf
queued_at: 2026-05-26T14:49:03-05:00
legacy_number: 71
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Right hamburger #menu hash should NOT be a permalink/pushState

User prompt (verbatim):

> enqueue at the end: #menu for right hamburger being opened should not be a permalink / pushState entry. this is because when i go to burger > prompt history, then go back, i want to go back to my current session, and not to open the burger.

Design notes:
- The "everything is a permalink" rule has an exception for transient UI surfaces that are NOT shareable state: hamburger menus, dropdown popovers, mode toggles. These should NOT pollute browser history because back-button semantics expect to return to the previously meaningful URL, not to a transient toggle.
- Find the right-hamburger menu open/close handler. If it currently uses `useHashOpen("menu")` or otherwise pushes `#menu` to history, swap to a pure-React-state toggle (`useState` or a zustand store). Verify back-button on `/session/<id>?...` ← `/prompts` round trip ignores the menu state.
- Update portal AGENTS.md `Everything is a permalink` section to call out this exception list explicitly so future agents don't try to re-add `#menu` permalink.
