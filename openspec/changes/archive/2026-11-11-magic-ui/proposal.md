## Why

The owner asked on 2026-11-10 to apply Magic UI (https://magicui.design) to Learning Hub. Magic UI is a set of animated React components, built on Tailwind CSS and Motion, that are copied into a project. The app today has plain CSS with light and dark themes, and no motion beyond hovers.

## What Changes

- **Tooling:**
  - add Tailwind CSS v4 through `@tailwindcss/vite`, with its preflight (CSS reset) **off** and its utilities in a cascade layer below the app's CSS, so existing screens keep their look;
  - add `motion`, `clsx` and `tailwind-merge`, plus a `cn()` helper;
  - Magic UI components are copied (MIT) into `src/components/magicui/`, and only the ones used.
- **Where:**
  - **Login, create-admin and invitation pages:** an animated Dot or Grid pattern background and a Shimmer button for the main action.
  - **Home role cards:** Magic Card spotlight and a Border Beam on hover or focus.
  - **Counts:** Number Ticker on note counts per roadmap card and on the news count.
  - **News page:** Blur Fade as items appear, and a Marquee of the source names.
  - **Agent panel:** Animated Shiny Text "Thinking…" while an answer is pending.
- **Theme:** the components use the app's tokens (`--accent`, `--surface-*`, `--text`), so light and dark both work.
- **Accessibility:**
  - every animation stops under `prefers-reduced-motion: reduce`;
  - decorative layers are `aria-hidden` and take no pointer events;
  - button names, roles and focus order do not change;
  - number tickers expose the final number to assistive tech at once.
- **Unchanged:** reading and editing areas (note view, lesson editor, forms) get no motion.

## Capabilities

### New Capabilities
- `visual-polish`: animated decoration with Magic UI that respects reduced motion and keeps behavior unchanged.

### Modified Capabilities

## Impact

- **Frontend only:** `package.json`, `vite.config.ts`, a new `src/styles/tailwind.css` imported before `index.css`, `src/components/magicui/*`, `src/lib/cn.ts`, and the auth pages, home page, news page and agent panel.
- **Bundle grows** by Motion and the used components; the build reports the size.
- **E2E:** the existing tests must pass unchanged (same names and roles). Screenshots are reviewed in light and dark, and a reduced-motion check is added.
