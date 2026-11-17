# Phone: Import closes the learned-list drawer

## Why

On a phone the learned list is a drawer over the page. Tapping **Import** in it opens the import dialog, but the drawer stays open on top of the page, so the dialog shares the screen with the drawer (owner report, 2026-11-17, on the hosted app). Opening a note from the drawer already closes it; Import does not.

## What Changes

- On a phone, an action in the learned-list drawer that opens the import dialog (the **Import** button and the empty list's **Import HTML or PDF files** button) closes the drawer first.
- Tablet and desktop are unchanged: the list is a side panel there and stays open.

## Capabilities

### Modified Capabilities

- `responsive-layout`: one new requirement, "Import from the list drawer".

## Impact

- Frontend only: `frontend/src/components/AppShell.tsx` (the `onImport` handler), its Vitest file, `frontend/e2e/responsive.e2e.ts`.
- No API, database or backup change.
