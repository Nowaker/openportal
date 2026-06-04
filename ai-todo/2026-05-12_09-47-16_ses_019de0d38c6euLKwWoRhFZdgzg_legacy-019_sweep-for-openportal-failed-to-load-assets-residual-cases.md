---
status: DONE
session: ses_019de0d38c6euLKwWoRhFZdgzg
queued_at: 2026-05-12T09:47:16-05:00
legacy_number: 19
commits:
  attributed:
    - 24d31165ebb3
  on_main:
    - 24d31165ebb3
  reverted: false
verdict: present
verdict_reason: "Commit 24d3116 on main: 'build,assets: stale-asset 500s are now structurally impossible'. Shim header at apps/web/src/middleware/asset-fallback.ts:89"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Sweep for "OpenPortal failed to load assets" residual cases

User prompts:

> "OpenPortal failed to load assets after 3 attempts.

> localStorage.removeItem("openportal-asset-reload-count") did nothing

The 3-layer asset-fallback architecture should make this impossible by construction. If user reports it again, the structure must have a hole. Add a smoke-test verifying the layers (already documented in portal AGENTS.md "Stale asset 500s are impossible by construction" — verify the curl-based test still passes):

```bash
curl -sS -D - -o /dev/null http://100.105.229.19:5000/assets/index-FAKEHASH.js | grep -i x-openportal-asset-source
# expect: X-OpenPortal-Asset-Source: shim
```
