---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T01:23:51-05:00
legacy_number: 22
commits:
  attributed:
    - 1a78d8b42227
  on_main:
    - 1a78d8b42227
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# File browser language detection bug (sh / rc / dotfile + txt false-positives)

User prompt:

> when i clicked https://portal.desktop.ts.nowaker.net:8443/files?path=%2Fhome%2Fnowaker%2Fprojekty%2Fai-workspace%2Fadd-replacement-disk-to-raid.sh it opened the file but highlighting was set to inexistent "bash". i had to switch it to shell. then look at ~/projekty/dotfiles/dotfiles - all these files get it wrong: gitconfig bashrc gitignore rvmrc xsessionrc zshrc. even a simple _brew-priority-casks.txt gets interpreted as... lua? wtf. content detection must be fixed. use extensons. use *rc (they are often scripts). screen this area of the system for any bugs, fix.

Design notes:
- `.sh` -> shell (NOT inexistent "bash" id). Map common shebang-style extensions through actual shiki / flourite language ids the highlighter supports.
- Dotfiles + `*rc` (bashrc, zshrc, gitconfig, gitignore, rvmrc, xsessionrc, etc.): default to shell highlighting unless content disproves. `*rc` files are usually scripts.
- `.txt` should default to plain text, NOT be probed into lua / other heuristics producing nonsense matches (`_brew-priority-casks.txt -> lua` is the user-supplied example).
- Screen the language-detection area for related bugs and fix all in one pass.
- Extension-driven match takes priority over content sniffing. Only fall through to content detection when the extension yields no answer AND the filename has no recognizable pattern (no `*rc`, no leading-dot dotfile match).
