---
status: DONE
session: ses_199327545ffeiH2jGHf2inNjA1
queued_at: 2026-05-26T19:20:08-05:00
legacy_number: 76
commits:
  attributed:
    - d2b4eec42a7e
  on_main:
    - d2b4eec42a7e
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# File browser: stop hiding dotfiles by default + cog popover with quick settings + Ctrl+Shift+L address-bar focus

User prompt (verbatim):

> file browser: "hidden" files and directories are currently hidden. do not hide. them. or ebetetr yet, to the left of X button, introduce a cog icon with quick on/off settings for the file browser. include a setting for:
> - show hidden files (default on)
> - mod date (default on)
> - file size (default on)
> - directory size (may be slow) (default off)
>
> whatever is there, it should also be in left nav > settings > somewhere where it makes sense.
>
> also introduce ctrl+shift+l shortcut to mimic ctrl+l wchich in browser go to address bar. here: focus the file browser address bar.

Design notes:
- Hidden-files filter is current behavior in `apps/web/src/server/fs/browse.get.ts` (line 96-101): comment "Hidden entries excluded by default to avoid drowning the tree in .git, .vscode, etc.; show_hidden=1 query param flips that." Not a regression, intentional design choice that the user now wants flipped.
- New zustand+persist store `apps/web/src/stores/file-browser-settings-store.ts` with four booleans: `showHidden=true`, `showModDate=true`, `showFileSize=true`, `showDirSize=false`. localStorage key `openportal-file-browser-settings` (matches composer/font-size pattern - localStorage, per-tab). Persists across reloads + survives cross-tab if user reopens.
- Server `browse.get.ts` accepts new `with_dir_size=1` query param that triggers recursive readdir+lstat per directory entry to sum file bytes. Safety: symlinks not followed (lstat naturally), 50k-entry global counter to abort runaway traversals (returns whatever's accumulated). When enabled, dir entries get `size` field populated. Client toggle defaults OFF for that reason ("may be slow").
- Client `files.tsx` always sends `show_hidden=<0|1>` reading from store - server's existing default-false behavior is harmless because the store default is true so clients always send `show_hidden=1` by default.
- Cog popover sits immediately left of the X button in the file-browser TopBar. Uses the same click-outside-to-close pattern as the existing `HistoryDropdown` component (no react-aria popover dependency needed). Body is a stack of 4 react-aria `Checkbox` controls, one per toggle.
- Keyboard shortcut Ctrl+Shift+L (and Cmd+Shift+L on Mac): registered TWICE - once inside `FilesPage` to handle focus inside the iframe AND the standalone `/files` route, once inside `FileBrowserPanel` to catch keystrokes while focus is in the parent chat (posts `{type:"fb-focus-address"}` to iframe, which the iframe listens for and focuses+selectAll the PathInput via ref). preventDefault so it does NOT bubble to any browser default; Ctrl+Shift+L is not a default browser shortcut so there's no conflict.
- Settings UI: new "Files" tab between "Chat" and "Tools" in `routes/_app/settings.tsx`. Renders the same four toggles wired to the same store + documents the keyboard shortcut. Tab id `files`, FolderIcon, hash-routable like every other tab (registered in both `useState(()=>...)` and `hashchange` handler validators).
- No new dependencies. Tab order in source IS visible order. Heading hierarchy: `<h2>Files</h2>` panel-level, no `<h3>` subsections since the toggles are a single conceptual group.
- Deploy via `scripts/deploy.sh` (dev-first → prod) per repo convention.
