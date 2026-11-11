## Context

- **Frontend:** React 19, Vite 8, TypeScript 7 and plain CSS in `src/index.css`, with theme tokens on `:root` and `[data-theme=dark]`.
- **No Tailwind** and no animation library yet.
- **Magic UI components** are TSX files that use Tailwind classes and `motion/react`. They are added by copying their source, normally through the shadcn CLI.

## Decisions

### Tooling
- **Versions** (each published at least two weeks ago):
  - `tailwindcss@4.3.3`, `@tailwindcss/vite@4.3.3`
  - `motion@14.6.0`
  - `clsx@2.1.1`, `tailwind-merge@3.7.0`
  - all pinned exactly in `package.json`.
- **`src/styles/tailwind.css`:**
  - `@layer theme, base, components, utilities;`, then `@import "tailwindcss/theme.css" layer(theme);` and `@import "tailwindcss/utilities.css" layer(utilities);`. There is **no preflight**, so existing elements keep their styles.
  - `@theme inline` maps the app's tokens: `--color-accent: var(--accent)`, `--color-surface: var(--surface)`, `--color-fg: var(--text)` and so on, so Magic UI colors follow light and dark.
  - The `@keyframes` the copied components need are defined here, for example shimmer, shiny-text, border-beam and marquee.
- **Import order:** `main.tsx` imports `styles/tailwind.css` before `index.css`. The app's unlayered CSS wins over the layered utilities on conflicts.
- **`src/lib/cn.ts`:** `cn(...inputs) = twMerge(clsx(inputs))`.
- **Copying:** the components are written by hand from the Magic UI source (MIT), with a header comment naming the source URL and license. The shadcn CLI is not used, since it would want `components.json`, path aliases and a preflight.
- **Reduced motion:**
  - each component checks `useReducedMotion()` from `motion/react`, or uses `motion-safe:` Tailwind variants;
  - a global rule `@media (prefers-reduced-motion: reduce)` also sets `animation: none` for the `.mu-*` classes.

### Components and where they go

| Component | File | Used in |
|---|---|---|
| DotPattern (animated glow) or AnimatedGridPattern | `magicui/dot-pattern.tsx` or `animated-grid-pattern.tsx` | `AuthPages` wrapper behind the card (`aria-hidden`, `pointer-events:none`, absolute, z-index under the card) |
| ShimmerButton | `magicui/shimmer-button.tsx` | the main submit button of login, create-admin and invite. It wraps the existing `<button>` styling and keeps `type`, `disabled` and the accessible name |
| MagicCard (spotlight following the pointer) | `magicui/magic-card.tsx` | each home role card (keeps the existing link and its name) |
| BorderBeam | `magicui/border-beam.tsx` | a home role card on hover or focus-visible |
| NumberTicker | `magicui/number-ticker.tsx` | the note count on each home card, and the news item count. `aria-label` holds the final number; with reduced motion it renders the final value at once |
| BlurFade | `magicui/blur-fade.tsx` | each news item, with a delay of up to 10 items × 40 ms, then none |
| Marquee | `magicui/marquee.tsx` | the news sources row (pauses on hover; static under reduced motion) |
| AnimatedShinyText | `magicui/animated-shiny-text.tsx` | the agent panel's pending row "Thinking…", which replaces the current pending indicator and keeps any existing `role` or status text |

Where an exact element (for example the current pending indicator or the count element) is not obvious, the implementer keeps the existing accessible structure and only adds the decoration around it.

### Testing
- **Vitest:**
  - each component renders with `aria-hidden` decoration;
  - under a mocked reduced-motion media query, NumberTicker shows the final value immediately;
  - ShimmerButton keeps the name and `disabled`;
  - AuthPages still exposes the same buttons and labels.
- **E2E:** the existing suite unchanged. A new `visual-polish.e2e.ts`:
  - with `page.emulateMedia({ reducedMotion: 'reduce' })`, the home counts show final values and computed `animation-name` is `none` on `.mu-*` elements;
  - screenshots of login, home, news and agent "Thinking…" in light and dark.
- **Build:** the size of the main JS chunk is reported before and after.

## Risks

- **Tailwind utilities could collide with existing class names** (for example `.hidden` or `.flex`). Mitigation: utilities are layered below the unlayered app CSS. Search `index.css` for colliding class names, and rename the app's own if needed.
- **Animation cost on low-end machines:** everything pauses under reduced motion, and backgrounds use CSS animations where possible.
