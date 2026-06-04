---
status: DONE
session: ses_174264400ffeZsZvr9TwhrFHGw
queued_at: 2026-06-03T00:01:04-05:00
legacy_number: 173
commits:
  attributed:
    - f8fad16cf5a8
    - 97b4c9a34f41
  on_main:
    - f8fad16cf5a8
    - 97b4c9a34f41
  reverted: false
verdict: present
verdict_reason: "Commits f8fad16 + 97b4c9a on main: 'model-select: drop dead useFilter/useMediaQuery calls + ship hidden sourcemaps' + 'sourcemap: hidden -> true so DevTools auto-associates maps'. apps/web/vite.config.ts:31 has build.sourcemap: true"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Fix `useFilter is not defined` in ModelSelect + ship prod sourcemaps

User prompt (verbatim):

> H: Something went wrong!
> useFilter is not defined
>
> ReferenceError: useFilter is not defined
>     at Z (https://portal.desktop.ts.nowaker.net:8443/assets/use-composer-max-height-Df2iaAbi.js:1:6803)
>     ... (browser stack) ... on /sessions/sesid. fix it, on a worktree, integrate when done. also - is it possible to make the stacktrace more useful? could the app be compiled (if it is compiled, i don't know) with sourcemaps enabled? if so, do it also.

Design notes:
- Root cause: commit 12ac206 (model-auto-switch refactor) extracted
  the dropdown body into `model-picker-content.tsx` and moved the
  `useFilter` / `useMediaQuery` imports with it, but left the
  `const { contains } = useFilter({ sensitivity: "base" })` and
  `const { isMobile } = useMediaQuery()` calls behind in
  `model-select.tsx`. Both destructured values are unused after the
  refactor — pure dead code. The session route renders <ModelSelect/>
  on mount, hits the undefined `useFilter`, throws, and the
  error-boundary banner fires.
- Fix in `model-select.tsx`: delete the two dead destructure lines.
  Smallest correct change — no need for a direct `react-aria` dep,
  no need to retool the model-picker-content import (its own
  `useFilter` from `react-aria-components` works fine because that
  call only runs when the dropdown is open).
- Sourcemaps: `vite.config.ts` now sets `build.sourcemap: "hidden"`.
  Maps ship to `.output/public/assets/*.js.map` so DevTools can opt
  in for stack-trace de-minification; the `//# sourceMappingURL`
  comment is omitted so browsers don't auto-fetch them on every
  page load. Production bundle size is unchanged.
- Verification: `bash scripts/build.sh` in the worktree, then
  `grep -c "useFilter" .output/public/assets/use-composer-max-height-*.js`
  returns 0 (the failing chunk no longer references it).
  733 `.map` files generated alongside the JS chunks.
