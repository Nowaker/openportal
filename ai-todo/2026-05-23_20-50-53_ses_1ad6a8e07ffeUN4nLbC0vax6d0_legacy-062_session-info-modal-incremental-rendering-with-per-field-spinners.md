---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T20:50:53-05:00
legacy_number: 62
commits:
  attributed:
    - d7a7d9f1dcb0
  on_main:
    - d7a7d9f1dcb0
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Session info modal: incremental rendering with per-field spinners

User prompt:

> Session info modal: instead of having to wait for any info to show, show immediately all that is already known, and each value that needs an update from server, an individual spinner as a value, before it populated.

Design notes (d7a7d9f, DONE):
- Replaced the all-or-nothing `isLoading` gate that blocked the entire body behind a single "Loading session info..." spinner with three independent per-source loading flags:
    sessionPending  : sessionsLoading && !sessions
    messagesPending : messagesLoading && (!messages || messages.length === 0)
    modelPending    : messagesPending || (providersLoading && !providersData)
- `Field` component extended with optional `loading?: boolean` prop. When loading and no value yet, renders a small inline `<Loader className="size-3" />` instead of the value. Each field's loader clears independently as its source lands.
- Field <-> source mapping:
    Title / Session Created / Last Activity     -> sessionPending
    Provider / Model / Context Limit            -> modelPending
    Messages / *Tokens / Usage / Cost / Cache /
        User+Assistant counts                   -> messagesPending
    Session ID                                  -> never loading (route param)
    McpSection / ExportSection                  -> own internal loading
- Combined with the sessions-cache fast-path (commit ef5fe93), most fields are already populated from cache when the modal opens, so even the spinners are typically short-lived blips.
