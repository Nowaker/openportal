---
status: PENDING
session: ses_17ad702d4ffeM1JhOURJen44xa
queued_at: 2026-06-01T16:48:46-05:00
legacy_number: 160
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# OMO wrapper unwrapping: show embedded user message outside `<system-reminder>` boilerplate (DONE - this commit) [loser-bump: originally #157 → #158 → #159 → #160; bumped four times because unknown-finish auto-revive, auto-approve reconcile, and sticky-user-prompt landed concurrently on main-nowaker while this work was being integrated]

User prompt (verbatim):

> omo wrappers. we wrap them to hide boilerplate from user's view.
> all of them so far were great. but now, i started using hephasteus deep agent omo agent for gpt/codex models.
> and this one in particular seems to like this:
>
> ```
> <system-reminder>
> The user sent the following message:
> other agent reported: I also hit a pre-existing crash only on the hash-permalink route (#msg-...): Cannot read properties of undefined (reading 'toLocaleString'). I worked around it by validating on the same session without hash; this crash is unrelated to this change and remains pre-existing.
>
> Please address this message and continue with your tasks.
> </system-reminder>
> ```
>
> basically, instead of submitting my own message: "other agent reported: I also hit a pre-existing crash only on the hash-permalink route (#msg-...): Cannot read properties of undefined (reading 'toLocaleString'). I worked around it by validating on the same session without hash; this crash is unrelated to this change and remains pre-existing."
>
> it wraps the entire thing in omo section.
>
>
> let's rewrite this wrapper to detect where user content is vs the boilerplate and render as:
>
> [<system-reminder> Please address this message and continue with your tasks:] <- wrapper
> [[[ 
> <system-reminder>
> The user sent the following message:
>                                                                                    <- nothing. empty line. user prompt removed from here.
> Please address this message and continue with your tasks.
> </system-reminder>
> ]]] <- when expanded
>
> other agent reported: I also hit a pre-existing crash only on the hash-permalink route (#msg-...): Cannot read properties of undefined (reading 'toLocaleString'). I worked around it by validating on the same session without hash; this crash is unrelated to this change and remains pre-existing.  <- actual user query. not wrapped.
>
>
> i know there's more than just one type of <system-reminder> so be careful. only handle this particular one specially.
> inspect omo source ~/projekty/webapps/oh-my-openagent for full understanding. maybe there are some other omo statements where user prompt is wrapped inside, effectively making the user prompt not visible unless omo wrapper is expanded. (not desired) implement all.

Design notes:

- Locate wrapper parsing + rendering path in portal for `<system-reminder>` and other OMO wrappers.
- Inspect `~/projekty/webapps/oh-my-openagent` reminder emitters to identify exact boilerplate variants that embed user text.
- Add targeted extraction: move embedded user message out of wrapper body into normal visible message text, while preserving condensed wrapper summary + expandable sanitized boilerplate body.
- Keep behavior narrow to specific boilerplate forms (do not alter unrelated `<system-reminder>` payloads).
- Validate with manual QA on chat surface and ensure no regression for existing wrapper collapse behavior.
