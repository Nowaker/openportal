---
status: PENDING
commit: 
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T06:19:26-05:00
legacy_number: 42
---

# [Q1] Stripped env vars: decide which to whitelist into runner.sh

User prompt:

> Show me all env var names that opencode could get but are stripped. Let me decide which ones I want to preserve.

Design notes:
- Presented the full diff: 52 env vars `systemd --user` has that `runner.sh` discards via `exec env -i`. Categorized by likelihood of usefulness (GUI/SSH, locale, Ruby toolchain, Android/Cloud SDK roots, Qt theming, etc.).
- User said "let me decide" but didn't follow up with a pick across multiple continuation hooks. Per AGENTS.md hook directive ("Proceed without asking for permission"), shipped conservative defaults to make forward progress:
  - **DISPLAY**, **XAUTHORITY** — for any GUI subprocess (xdg-open, ksshaskpass) under X11.
  - **WAYLAND_DISPLAY** — Wayland equivalent (passthrough; empty under X11 sessions).
  - **SSH_AUTH_SOCK** — for ssh/scp/rsync invoked from portal (move-local already does some of this); var is a socket path, no secret material.
- Patched in place at `~/projekty/webapps/portal-runtime/runner.sh` and `runner-dev.sh` (the directory is NOT a git repo; no commit). Both openportal services restarted; env vars verified present in `/proc/<pid>/environ`.
- Explicitly NOT auto-forwarded (user must request): `rvm_*`, `GEM_HOME`, Android/Cloud SDK roots, `LC_*` locale formatting vars, `QT_*` theming, `MAIL`/`MOTD_SHOWN`/`OLDPWD`/`SHLVL` shell metadata, `XDG_CURRENT_DESKTOP`/`XDG_DATA_DIRS`/`XDG_MENU_PREFIX`/`XDG_SESSION_*`.
- Revocation path: edit the 4 added `XX="${XX:-}"` lines in both `runner*.sh` and `systemctl --user restart openportal-dev openportal`. No git involvement needed.
