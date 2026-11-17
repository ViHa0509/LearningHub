# Design

## Context

`AppShell.tsx` owns `leftOpen`, `importing` and `phone`. `LearnedList` calls `onImport` from two buttons (toolbar **Import**, empty-state **Import HTML or PDF files**). `ImportDialog` is rendered after the shell as a fixed backdrop with `z-index: 10`; the phone drawer is `z-index: 20` inside the shell, so an open drawer covers part of the dialog. `openNoteFromList` already closes the drawer on a phone.

## Decisions

1. **Close in the handler, not with CSS.** `onImport` in `AppShell` becomes a function that sets `importing` and, when `phone`, calls `setLeftOpen(false)`, the same way `openNoteFromList` does. Raising the dialog's `z-index` instead would leave a modal drawer open under a modal dialog (two `aria-modal` dialogs, the drawer's scrim and key handler still active).
2. **Both import buttons** go through the same `onImport`, so one change covers them. `LearnedList` is not changed.
3. **Focus.** The drawer closing moves focus to its top-bar button (`PanelFrame`, existing behaviour, because the tapped button is inside the now hidden drawer). That stays: after the dialog closes, focus is on a visible control. The import dialog's own focus handling is not in scope.
4. **Closing the dialog does not reopen the drawer.** After Cancel or a finished import the user is on the page; the list is one tap away.
5. **Tablet and desktop:** no change (`phone` is false).

## Risks

- None for data. The drawer's content unmounts while closed (`leftOpen && …`), as it already does when a note is opened; list state such as an open rename is dropped the same way.
