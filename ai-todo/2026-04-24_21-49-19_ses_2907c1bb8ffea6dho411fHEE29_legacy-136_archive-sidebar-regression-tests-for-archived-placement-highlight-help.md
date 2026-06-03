---
status: PENDING
commit: 
session: ses_2907c1bb8ffea6dho411fHEE29
queued_at: 2026-04-24T21:49:19-05:00
legacy_number: 136
---

# Archive sidebar regression tests for archived placement + highlight helper logic

User prompt (verbatim):

> Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.

Design notes:

- Optional hardening follow-up after shipping #133/#134: extract archive-visibility decisions into a tiny pure helper module and cover it with bun tests.
- Validate conditions for archived subsection auto-expand and archived-row current-session highlighting without needing brittle browser automation.
- Files:
  - `apps/web/src/lib/sidebar-archive-visibility.ts`
  - `apps/web/src/lib/sidebar-archive-visibility.test.ts`
  - `apps/web/src/components/app-sidebar.tsx` (wire helper usage)
