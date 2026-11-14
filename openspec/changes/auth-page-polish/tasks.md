# Tasks

## 1. Sign-in pages

- [x] 1.1 `AuthPages.tsx` and `index.css`: only configured providers, with logos; divider only when one is offered; first-visit note; Sign up / Log in button at the top right of the page; verify with Vitest in `Auth.test.tsx` for every scenario changed or added, `npm run lint`, `npm run build`

## 2. E2E and integration

- [x] 2.1 Update `e2e/auth.e2e.ts`, `e2e/owner.setup.ts`, `e2e/signin-settings.e2e.ts` (a provider that is not configured is absent, not disabled); screenshots of the login and Sign up pages, light and dark; rerun until `npm run e2e` passes
- [ ] 2.2 Every check in `CLAUDE.md` passes and `openspec validate auth-page-polish --strict` passes; verifier report (`ai-sdlc-kit:verifier`) on the change
