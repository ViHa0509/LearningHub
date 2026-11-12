## Context

See proposal.md for the motivation. What the code looks like today (read 2026-11-12):

- **Shell:** `AppShell.tsx` sets the grid columns inline: `minmax(240px, 22%)` or `44px`, `1fr`, `minmax(300px, 30%)` or `44px`. `leftOpen` and `rightOpen` are `useState(true)`. Both open need 540 px before the center gets anything.
- **Panels:** a collapsed left panel unmounts its content; the chat stays mounted with `hidden`, so its draft survives. `askAgent` forces the right panel open.
- **CSS:** `src/index.css` is hand-written; its only media queries are color scheme, reduced motion and print. `.app-frame` is `height: 100vh`. Tailwind is loaded only for the Magic UI components.
- **Top bar:** brand with title, News link, a three-button labelled theme switch, account button with the name; no wrapping.
- **Fixed-size spots:** `.domain-tabs` and `.settings-nav` (no wrap, no scroll), `.users-table` (six columns, no wrapper), `.provider-cards` `minmax(300px,1fr)`, `.domain-cards` `minmax(240px,1fr)`, `.news-search input` `min-width: 200px`, `.agent-menu-list` (absolute, 280 px wide at `left: 48px`), `.roadmap-node` 190x46 with `defaultViewport {x:32, y:24, zoom:0.9}`.
- **Touch:** the note More button is `opacity: 0` until hover or focus; several controls are 22 to 32 px tall.
- **Already fluid:** page paddings use `clamp()`, dialogs use `min(..., calc(100vw - 32px))`, and `index.html` has the viewport meta tag.
- **E2E:** one viewport, 1440x900, Edge; screenshots in `frontend/e2e-results/screens/`.

## Goals / Non-Goals

**Goals:**
- One source for the screen class, used by both the React layout and the CSS, with the same three numbers.
- Desktop pixels unchanged: existing tests, e2e and screenshots at 1440x900 keep passing without edits.
- Layout by CSS where CSS can do it; JavaScript only where structure changes (drawers, panel defaults, theme button).

**Non-Goals:**
- Remembering panel state between visits.
- A separate mobile navigation or bottom tab bar.
- Changing imported note pages, the print layout, or the Magic UI decoration.
- Moving the hand-written CSS to Tailwind breakpoints.

## Decisions

### Screen class: `useScreenClass()`
- `src/lib/useScreenClass.ts` returns `'phone' | 'tablet' | 'desktop'` from two `matchMedia` queries (`(max-width: 639.98px)`, `(max-width: 1099.98px)`), subscribed with `useSyncExternalStore`. Where `matchMedia` is missing (jsdom without a stub) it answers `'desktop'`, so existing component tests are unaffected.
- CSS uses the same two limits in `@media` rules. Custom properties cannot be used inside media queries, so the two numbers are written in both places with a comment in each pointing at the other.
- **Why these numbers:** 1100 px is where both panels at their minimum widths (540 px) still leave a center of about 560 px. 640 px separates phones (all under 480 px in portrait) from small tablets and is the usual small breakpoint.
- **Alternative considered:** container queries on the shell. They would size the center well but cannot change which panels are mounted or their default state.

### Shell per screen class
- **Desktop:** today's inline columns, untouched.
- **Tablet:** the same grid; `AppShell` enforces "at most one open". Defaults on entering the tablet class: left open, right collapsed. Opening one sets the other to collapsed. Minimum widths stay 240 px and 300 px, which at 640 px leave a 296 px center with the list open; from 768 px the center has more than half.
- **Phone:** the grid is one column (`1fr`); the collapsed 44 px rails are not rendered. Each panel is rendered as a drawer: `position: fixed`, top below the top bar, full height, width `min(88vw, 360px)`, left or right edge, with a scrim over the page. Drawers are closed on entering the phone class.
- **State:** `leftOpen` and `rightOpen` stay in `AppShell`. A small effect resets them to the class defaults when the class changes (desktop: both open; tablet: left only; phone: none). Within a class the user's choice stands.
- **Chat draft:** the agent drawer keeps the chat mounted while closed (as the collapsed panel does today), so typed text survives closing and rotation.
- **`askAgent`:** opens the right panel in every class; on tablet and phone that closes the left one through the same rule.
- **Navigation closes the list drawer:** on a phone, choosing a note or a node from the learned list closes the drawer after the route changes.

### Drawer behavior
- A drawer is a `role="dialog"` with `aria-modal="true"` and a label ("Learned" / "Agent"), only on a phone; on tablet and desktop the panels keep their `aside` role.
- Open: focus moves to the drawer's close button. Close (button, Escape, scrim tap): focus returns to the top-bar button that opened it. Tab stays inside the open drawer.
- The page behind does not scroll while a drawer is open (`overflow: hidden` on the center pane).
- Slide animation of 150 ms, off under `prefers-reduced-motion`.
- Existing outside-click handlers use `mousedown`; the scrim uses `click`, which touch browsers also fire, so no pointer-event rewrite is needed.

### Top bar
- **Tablet:** `.theme-switch` labels become visually hidden (kept for assistive tech); nothing else changes.
- **Phone:**
  - brand: the mark only, the title visually hidden;
  - News: icon with a visually hidden label;
  - theme: one button that steps System, Light, Dark; accessible name "Theme: Light. Change theme". The three-button radiogroup is not rendered on a phone;
  - two drawer buttons with `aria-expanded` and `aria-controls`: Learned at the left of the bar, Agent before the avatar;
  - the avatar without the name.
- Budget at 360 px: mark 28, five 40 px controls, the avatar 36, gaps and padding about 64: about 330 px.

### Height
- `.app-frame { height: 100vh; height: 100dvh; }`: browsers without `dvh` keep today's behavior.
- `body { background-attachment: fixed }` becomes `scroll` on phone and tablet, where fixed backgrounds repaint badly.

### Pages
- `.domain-tabs`, `.settings-nav`: `overflow-x: auto`, no wrapping, the active tab scrolled into view on load.
- `.users-table`: wrapped in a `div` with `overflow-x: auto`.
- `.provider-cards`, `.domain-cards`: `minmax(min(300px, 100%), 1fr)` and `minmax(min(240px, 100%), 1fr)`.
- `.news-search input`: `min-width: 0` with `flex: 1 1 160px`.
- `.agent-menu-list`: on a phone `left: 8px; right: 8px; width: auto`.
- `.note-editor-bar`: allowed to wrap.
- `.auth-card`, `.outage-card`: padding `clamp(16px, 5vw, 32px)`.

### Roadmap map
- On phone and tablet the initial viewport is computed instead of the fixed `{x:32, y:24, zoom:0.9}`: zoom 0.85, and `x` set so the first node is centered horizontally in the pane. No `fitView`, which would shrink a tall roadmap until labels are unreadable.
- Pan by drag and pinch zoom are React Flow's defaults and stay on; `panOnScroll` stays for trackpads.

### Touch
- `@media (hover: none)`: the note More button has `opacity: 1`.
- `@media (pointer: coarse)` together with the phone and tablet widths: `min-height: 40px` on top-bar controls, `button.icon`, `.note-select` rows, agent header buttons, the effort buttons and Send. Desktop with a mouse is unchanged.
- **Why 40 px and not 44 px:** 44 px is the stricter guideline, but the top bar must hold six controls on a 360 px screen; 40 px meets WCAG 2.2 AA (24 px) with room to spare.

### Tests
- **Vitest:** a `matchMedia` stub helper in `src/test/` sets the screen class per test. Tests for `useScreenClass`, the shell (defaults per class, one panel at a time, drawer open/close/focus/Escape, draft kept, list drawer closes on navigation), and the top bar (theme button steps, accessible names).
- **E2E:** `playwright.config.ts` gets two projects, `phone` (390x844, touch) and `tablet` (820x1180, touch), that run only `responsive.e2e.ts`; the existing `app` project keeps 1440x900 and ignores that file. The spec checks `scrollWidth <= clientWidth` on every page, the drawers, the theme button, the Users table scroll area and control heights, and writes `responsive-<page>-<class>.png` screenshots in light and dark for `qc-ui`. A 360 px check runs inside the phone project with `setViewportSize`.

## Risks / Trade-offs

- **Two places hold the breakpoint numbers** (hook and CSS) → a comment in each, and the e2e checks at 639/640 and 1099/1100 px catch a drift.
- **Class change resets panel state** (rotating a tablet across 1100 px reopens panels) → accepted; typed chat text and the current page are kept, which is what the spec requires.
- **Focus handling in drawers is new code** → kept small (one hook), covered by Vitest and by keyboard steps in e2e.
- **The e2e run gets longer** (two more projects) → they run one spec file only.
- **`settings-tabs` describes a select on narrow screens** → that change is not built; its proposal should be updated to the scroll row and these screen classes before it is applied.
- **Imported note pages can still be wider than a phone** → they scroll inside their frame; stated as out of scope.
