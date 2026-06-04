---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T13:12:24-05:00
legacy_number: 50
commits:
  attributed:
    - c3a1eeb0eee7
  on_main:
    - c3a1eeb0eee7
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# File browser: dir listing size + last-modified age columns

User prompt:

> file browser: bookmarks are listed in top bar, but there's no way to bookmark/unbookmark file. also, files size size on the right in dirlistings, also include 2d, 5m <- last modification time, very briefly, strive for short numbers; bump units higher aggressively; precision isn't needed, short value is. icon filename                              size age

Design notes:
- `browse.get.ts` server `Entry` interface: new optional `mtimeMs?: number`. lstat now runs for ALL entries (was: files-only), populating mtimeMs. Tiny cost; lstat was already happening for files.
- `files.tsx` client `BrowseEntry` interface mirrors. New `formatAge(mtimeMs)` utility produces glanceable 2-3-char strings: `Ns / Nm / Nh / Nd / Nw / Nmo / Ny`. Boundaries match human intuition: 60s→1m, 24h→1d, 7d→1w, 30d→1mo, 365d→1y.
- Dir-row layout: `icon | name | size (14ch right) | age (10ch right)`. Directories show empty 14ch size slot to keep age column aligned across rows. `tabular-nums` + fixed widths means columns stay vertically aligned regardless of content. Exact full timestamp on hover via `title=`.
- Bookmark/unbookmark requirement was ALREADY shipped — `BookmarkButton` in the file view header (line 1356 of `files.tsx`) renders when viewing a file, star icon toggles. No additional work needed.
