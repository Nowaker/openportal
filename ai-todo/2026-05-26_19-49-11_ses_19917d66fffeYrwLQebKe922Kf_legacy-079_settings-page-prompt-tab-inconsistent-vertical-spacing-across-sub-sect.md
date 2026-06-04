---
status: DONE
session: ses_19917d66fffeYrwLQebKe922Kf
queued_at: 2026-05-26T19:49:11-05:00
legacy_number: 79
commits:
  attributed:
    - 5809ad87f483
  on_main:
    - 5809ad87f483
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Settings page Prompt tab: inconsistent vertical spacing across sub-sections

User prompt (verbatim):

> https://portal.desktop.ts.nowaker.net:8443/settings?server=srv-2dy1srwz#prompt  <- fix alignment in this settings page. read agents.md, update ai todos. work on a worktree. merge to main branch when done. push all.continue

Design notes:
- Visible inconsistency in `apps/web/src/routes/_app/settings.tsx` TabPanel id="prompt":
  - "Default model" section uses `<section className="space-y-6">` with a redundant nested `<div className="space-y-2">` wrapper around the Select. Renders as ~24px gap between description text and dropdown.
  - "Default thinking effort" section uses `<section className="space-y-2">` directly. Renders as ~8px gap. Matches the AGENTS.md canonical pattern documented under "Settings UI structure".
  - The mismatch is the most obvious visual alignment defect on the page since the two sections sit adjacent to each other.
- The sub-components rendered inside the remaining `<section>` wrappers each picked their own arbitrary outer spacing:
  - `AgentSettings()` outer container is `space-y-6` (was matching the inner inter-control gap, not the canonical heading-to-content gap).
  - `VoiceInputSetting()` outer container is `space-y-6`.
  - `NotificationSoundSetting()` outer container is `space-y-4`.
  - `TtsSetting()` outer container is `space-y-3`.
  Each renders the heading-bundle (`<h3>` + `<p class="text-xs">`) and then directly siblings the control(s) with whatever the outer class says. Four different gaps = four different visual rhythms within one tab.
- Fix: normalise every section to the AGENTS.md canonical pattern - `space-y-2` between the heading-bundle and the controls. For multi-control sections (AgentSettings, VoiceInputSetting, NotificationSoundSetting, TtsSetting) wrap the controls in an additional inner div whose `space-y-N` controls inter-control spacing so the tight heading-to-first-control rhythm is preserved.
  - AgentSettings: outer `space-y-2`, inner controls wrapper `space-y-4`.
  - VoiceInputSetting: outer `space-y-2`, inner controls wrapper `space-y-4`.
  - NotificationSoundSetting: outer `space-y-2`, inner controls wrapper `space-y-3` (volume slider + the bordered category rows belong tightly together).
  - TtsSetting: outer `space-y-2`, the `Checkbox` + inner conditional `space-y-3` block stay siblings (preserved).
- "Default model" section in the TabPanel itself: `<section>` -> `space-y-2`, drop the `<div className="space-y-2">` wrapper around the Select so the dropdown is a direct sibling of the heading-div like every other section.
- Worktree: `~/projekty/webapps/portal-settings-prompt-alignment`, branch `settings-prompt-alignment` off `main-nowaker`. Built + visually verified on `bash scripts/run-worktree.sh` before merging.
- Deploy via `scripts/deploy.sh` (dev-first -> prod) after merge to `main-nowaker`. Push both `origin` (gitlab) and `github`.

---
