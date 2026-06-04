---
status: DONE
session: ses_17afe7fc2ffemjVUEGe4taO7ZT
queued_at: 2026-06-01T16:05:38-05:00
legacy_number: 156
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Fix runtime crash `Cannot read properties of undefined (reading 'toLocaleString')`

User prompt (verbatim):

> Something went wrong!
> Cannot read properties of undefined (reading 'toLocaleString')
>
> TypeError: Cannot read properties of undefined (reading 'toLocaleString')
>     at Pr (https://portal.desktop.ts.nowaker.net:8443/assets/_id-B11Y8V-S.js:16:28475)
>     at bo (https://portal.desktop.ts.nowaker.net:8443/assets/index-aoXZegCN.js:9:47538)
>     at pc (https://portal.desktop.ts.nowaker.net:8443/assets/index-aoXZegCN.js:9:70092)
>     at Ac (https://portal.desktop.ts.nowaker.net:8443/assets/index-aoXZegCN.js:9:80365)
>     at Fu (https://portal.desktop.ts.nowaker.net:8443/assets/index-aoXZegCN.js:9:115868)
>     at Mu (https://portal.desktop.ts.nowaker.net:8443/assets/index-aoXZegCN.js:9:114929)
>     at ju (https://portal.desktop.ts.nowaker.net:8443/assets/index-aoXZegCN.js:9:114765)
>     at yu (https://portal.desktop.ts.nowaker.net:8443/assets/index-aoXZegCN.js:9:111613)
>     at pd (https://portal.desktop.ts.nowaker.net:8443/assets/index-aoXZegCN.js:9:123326)
>     at cd (https://portal.desktop.ts.nowaker.net:8443/assets/index-aoXZegCN.js:9:121882)
>
>
> something broke openportal. fix it asap.

Design notes:

- Reproduce on current prod/dev build and map the minified stack to source using current code search around `toLocaleString` callsites.
- Patch the failing render path so undefined values never call `.toLocaleString` (use explicit null-safe fallback and preserve existing date/time formatting settings).
- Verify manually in browser (no console crash) and run diagnostics/build gates.
- Land via worktree branch, merge into `main-nowaker`, deploy with `scripts/deploy.sh`, and push to both remotes.
