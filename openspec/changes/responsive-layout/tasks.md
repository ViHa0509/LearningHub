# Tasks

## 1. Screen class

- [x] 1.1 `src/lib/useScreenClass.ts` (two `matchMedia` queries, `useSyncExternalStore`, `'desktop'` without `matchMedia`) and a `matchMedia` stub helper in `src/test/`; verify with Vitest for the three classes, a change of class, and the fallback

## 2. Shell and drawers

- [x] 2.1 `AppShell`: columns and panel defaults per class, at most one open panel on tablet and phone, reset on class change, `askAgent` through the same rule; verify with Vitest (defaults per class, opening one collapses the other, desktop unchanged, typed chat text kept across a class change)
- [x] 2.2 Phone drawers for the learned list and the agent chat (dialog role, scrim, close button, Escape, focus in and back, focus kept inside, page behind not scrolling, list drawer closes on navigation, chat stays mounted); CSS with reduced-motion; verify with Vitest for each scenario of "Side panels as drawers on a phone"
- [x] 2.3 `.app-frame` height with `dvh` fallback and scrolling background on phone and tablet; verify the CSS rule in a Vitest CSS test or by the e2e composer check in 5.2

## 3. Top bar

- [x] 3.1 `TopBar`: tablet icons-only theme switch; phone form (mark only, News icon, one theme button stepping System, Light, Dark, drawer buttons with `aria-expanded`, avatar without name), all with accessible names; verify with Vitest (theme steps and names, drawer buttons toggle, desktop markup unchanged)

## 4. Pages and touch

- [x] 4.1 Scroll areas and grids: domain tabs, settings tabs (active tab in view), Users table wrapper, provider and domain card grids, news search, agent menu position, note editor bar, auth and outage card padding; verify with `npm test`, `npm run lint`, `npm run build` and the overflow checks in 5.2
- [x] 4.2 Roadmap map start view on phone and tablet (first node centered, zoom 0.85, no `fitView`); verify with Vitest on the computed viewport
- [x] 4.3 Touch rules: hover-only controls shown under `hover: none`; 40 px minimum height under `pointer: coarse` at phone and tablet widths; verify with the height and visibility checks in 5.2

## 5. E2E and documentation

- [x] 5.1 `playwright.config.ts`: `phone` (390x844) and `tablet` (820x1180) projects running only `responsive.e2e.ts`; the `app` project ignores it; CLAUDE.md UI section lists the three viewports; verify `npm run e2e` still runs the existing suite at 1440x900 unchanged
- [x] 5.2 `qc-e2e` writes `responsive.e2e.ts` from the specs (no sideways scroll on every page at 360, 390 and 820 px, drawers, theme button, Users table, composer visible, control heights, roadmap first node, boundaries 639/640 and 1099/1100) with light and dark screenshots; loop with the frontend developer until the suite passes
- [x] 5.3 `qc-ui` inspects the phone and tablet screenshots; fix what it reports; verify its report has no open defect
- [x] 5.4 Every check in CLAUDE.md passes; verifier report (`ai-sdlc-kit:verifier`) on the change

## Workflow follow-up

- Update the `settings-tabs` proposal to the scroll row and these screen classes before it is applied.
- Archive `responsive-layout` after the verifier report.
