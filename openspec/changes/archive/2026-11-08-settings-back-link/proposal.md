## Why

The Settings page has no way back to where the user came from; they have to find the app title or the browser's back button.

## What Changes

- Settings gets a "← Back" link at the top. It returns to the last page the user opened outside Settings (home, a roadmap, a lesson or a note), also after visiting a provider page in between. Without such a page (Settings opened directly), it goes home.
- The app remembers that page in memory only (no storage).

## Capabilities

### New Capabilities

### Modified Capabilities
- `learning-views`: new requirement "Back from Settings".

## Impact

- Frontend: `lib/route.ts` (remember the last page outside Settings), `SettingsPage.tsx`, tests. No backend change.
