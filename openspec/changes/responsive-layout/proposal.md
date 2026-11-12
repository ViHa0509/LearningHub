## Why

On a phone the app is wider than the screen and has to be dragged sideways; nothing adapts to phone or tablet widths (owner, 2026-11-12). The frontend has no responsive rule today: the two side panels keep fixed minimum widths (240 px and 300 px) and both start open, the top bar cannot shrink, and several pages hold rows wider than a phone. The hosted copy is meant to be opened away from the desk, so the app has to fit the screen it is on.

## What Changes

- **Three screen classes by viewport width:** phone (under 640 px), tablet (640 to 1099 px), desktop (1100 px and up). Desktop stays as it is today.
- **Phone:** the center page takes the whole width. The learned list and the agent chat become drawers that slide over the page, opened from two buttons in the top bar and closed with their close button, Escape or a tap outside. One drawer at a time.
- **Tablet:** the center plus at most one side panel. The list starts open and the chat starts collapsed; opening one collapses the other.
- **Top bar:** on a phone it shows the logo mark, icon-only News, one theme button that steps through System, Light and Dark, the two drawer buttons and the avatar. On a tablet the theme switch shows icons without labels.
- **No sideways page scroll** at any supported width (360 px and up). Rows that cannot shrink scroll inside their own area: domain tabs, settings tabs, the Users table. Card grids drop to one column.
- **Full height on mobile browsers:** the app uses the visible viewport height, so the chat composer is not hidden behind the browser's bars.
- **Roadmap map:** on a phone it opens with the top of the roadmap in view at a readable size, and moves by drag and pinch.
- **Touch:** actions that only appeared on hover (the note "More actions" button) are always visible on touch screens, and controls in the top bar, the lists and the chat are at least 40 px tall there.
- **Checks:** the e2e run adds a phone (390x844) and a tablet (820x1180) pass with screenshots, next to the 1440x900 one.

Not in this change: imported note pages are other people's desktop HTML and are shown as they are, inside their own scrolling frame; the lesson PDF layout; landscape phones below 360 px tall.

## Capabilities

### New Capabilities
- `responsive-layout`: how the app fits phone, tablet and desktop widths: screen classes, no sideways scroll, drawers, compact top bar, touch use.

### Modified Capabilities
- `learning-views`: the three-pane layout is the desktop layout; on narrower screens the side panels follow `responsive-layout`.

## Impact

- **Frontend only:**
  - `src/components/AppShell.tsx` (columns per screen class, drawer state), `TopBar.tsx` (compact forms, drawer buttons), `AgentPanel.tsx`, `agent/AgentHeader.tsx`, `RoadmapMap.tsx` (start view);
  - a new `src/lib/useScreenClass.ts`;
  - `src/index.css` (media queries, `dvh`, scroll areas, touch sizes);
  - Vitest tests next to the components.
- **E2E:** `playwright.config.ts` gets phone and tablet projects; a new `responsive.e2e.ts`; screenshots in `frontend/e2e-results/screens/`. CLAUDE.md's UI section lists the three viewports.
- **No backend, API or data change.**
- **Other open changes:** `settings-tabs` says its tabs "collapse into a top select on narrow screens"; this change makes the current settings tabs scroll in their row instead, and `settings-tabs` should adopt the same screen classes when it is built.
