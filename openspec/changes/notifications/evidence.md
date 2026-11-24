# Evidence: notifications

qc-e2e (2026-11-24): every desktop notification scenario passed on the first run; the bell made the phone top bar 10-40 px too wide (major). Fixed: the bell uses the compact icon-button size, and under 640 px the A2UI Lab link moves from the top bar into the avatar menu (new requirement "Bell on a phone", design 9). Rerun of `owner.setup`, `auth`, `notifications`, `responsive`, `a2ui-lab` e2e: 94 passed.

qc-ui (2026-11-24): pass, no blocker, major or minor defect (30 screenshots, light, dark and phone).

## Accepted cosmetic

- The `notifications-load-more` screenshot does not show Load more (the popover scrolls; the button is below the fold in the shot).
- Unread items are indented about 3 px more than read ones (the accent bar).
- Chat quick-reply chips are mid-fade in a few dark screenshots (capture timing).
- On the phone top bar the News icon has no button border (older than this change).
- Not covered by a screenshot: the phone avatar menu with the A2UI Lab item (asserted in `responsive.e2e.ts`).
