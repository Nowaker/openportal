---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T04:24:57-05:00
legacy_number: 31
commits:
  attributed:
    - f2a9f1fda1a5
  on_main:
    - f2a9f1fda1a5
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# systemctl --user env vars (DBUS_SESSION_BUS_ADDRESS + XDG_RUNTIME_DIR)

User prompt:

> Command failed: systemctl --user restart opencode-serve-tailscale.service
> Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined (consider using --machine=<user>@.host --user to connect to bus of other user)
>
> Enqueue as next todo. Fix the issue.
>
> I also wonder if these vars should be inherited from Systemd somehow?
>
> system messages floating Icon unneeded. It should be in top right hamburger (scoped or affecting current project by default) of bottom left element i

Design notes:
- Root cause: `~/projekty/webapps/portal-runtime/runner.sh` and `runner-dev.sh` both use `exec env -i` to scrub the environment before launching openportal, but didn't propagate `XDG_RUNTIME_DIR` or `DBUS_SESSION_BUS_ADDRESS`. The systemd user manager sets these on every service it spawns; without them, any `systemctl --user <cmd>` shelled out from the openportal process cannot reach the user manager's dbus socket.
- Fix in runner scripts: forward both vars via `env -i` with `/run/user/$(id -u)` defaults for out-of-systemd invocations.
- Defense-in-depth in portal code (commit f2a9f1f): `restartUserService()` in `apps/web/src/server/lib/opencode-service.ts` now composes `process.env` with explicit fallbacks via a `withUserBusEnv()` helper (uses `process.getuid()`). So even an out-of-band launch (`bun run` for testing, dev container, anyone bypassing the systemd unit) still works.
- The system-messages floating icon directive in this prompt is handled in entry #32 below — listed there with the more complete refined directive.
