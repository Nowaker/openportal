---
status: DONE
session: ses_18417f36bffecB3eISEMAXnoob
queued_at: 2026-05-30T21:41:06-05:00
legacy_number: 144
commits:
  attributed:
    - 9b8c6737a614
  on_main:
    - 9b8c6737a614
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Configurable polling interval in Settings → Performance → Live updates

User prompt (verbatim):

> Settings -> ... -> update policy polling - currently it says 3 seconds.
> make it configurable if polling selected. pre-filled with 3 as placeholder (no saved value but backend will default to it)
> ability to modify to any number of seconds.

Design notes:

- The "Polling" strategy description previously hard-coded "Timer refresh every 3 seconds". Made the 3s base configurable.
- Added `pollingIntervalSec: number | undefined` to `apps/web/src/stores/update-strategy-store.ts` (persist v2, undefined = default).
- `usePollMs()` in `apps/web/src/hooks/use-opencode.ts` scales each call-site's natural interval proportionally to `(customSec / DEFAULT_POLLING_INTERVAL_SEC)`, preserving the relative cadence between callers (messages 3s, pinned 5s, last-viewed 5s, companion 5/15s).
- New `PollingIntervalSetting` component in `apps/web/src/routes/_app/settings.tsx` renders an `<Input type="number">` only when either platform's strategy is "polling". Placeholder shows "3" (DEFAULT_POLLING_INTERVAL_SEC). Empty value = backend default. Commits on blur and Enter. Rejects non-positive numbers.
- Persisted in localStorage (`openportal-update-strategy` v2), per-device — same scope as the existing per-platform strategy.
