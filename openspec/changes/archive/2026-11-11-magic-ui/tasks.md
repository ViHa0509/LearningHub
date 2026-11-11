## 1. Setup

- [x] 1.1 Tailwind v4 (no preflight, layered utilities, theme tokens mapped), motion, clsx, tailwind-merge, `cn()`; build and existing tests unchanged

## 2. Components

- [x] 2.1 Copy DotPattern or AnimatedGridPattern, ShimmerButton, MagicCard, BorderBeam, NumberTicker, BlurFade, Marquee, AnimatedShinyText into `src/components/magicui/` with reduced-motion support; Vitest
- [x] 2.2 Apply them: auth pages, home cards and counts, news items and sources, agent "Thinking…"; Vitest that names, roles and labels are unchanged

## 3. E2E

- [x] 3.1 qc-e2e: existing suite passes; `visual-polish.e2e.ts` (reduced motion, light and dark screenshots of login, home, news, thinking); review every screenshot
