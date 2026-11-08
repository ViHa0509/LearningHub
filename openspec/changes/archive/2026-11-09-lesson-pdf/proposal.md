## Why

The user wants lessons to leave the app as PDF (to keep, print or share) and wants existing PDF material to become a lesson without retyping it.

## What Changes

- **Export PDF:** the lesson page gets an "Export PDF" button.
  - It opens the browser's print dialog on a print layout that holds only the lesson: breadcrumb, title, description, the rendered lesson, and the References list when there is one, as plain URLs.
  - The suggested file name is the lesson title.
  - The browser renders the PDF ("Save as PDF"), so fonts, Vietnamese text and formatting match the screen. There is no new frontend dependency.
  - It is disabled when the lesson is empty.
- **Import PDF:** an "Import PDF" button on the lesson page uploads one PDF to `POST /api/lessons/extract-pdf`, which needs `X-LearningHub: 1`.
  - The backend extracts the text with `pypdf` and returns `{markdown, pages, truncated, warning}`:
    - lines joined into paragraphs, and bullet characters turned into Markdown list items
    - at most 10 MB, 200 pages and 100 000 characters
    - a clear error for a file that is not a PDF or is encrypted, and a warning when there is no text layer (scanned images)
  - The text opens in the lesson editor and is not saved. The user reviews it and clicks Save (the Save rule). If the lesson already has text, the import asks first whether to replace the editor's text.
  - Nothing is stored on the server: the PDF is read in memory and dropped.
- PDF text is the user's own content placed in their lesson. It is not given to the agent as instructions; the agent reads lessons as data as today.

## Capabilities

### New Capabilities

### Modified Capabilities
- `lesson-pages`: new requirements "Export a lesson as PDF" and "Import a PDF into the lesson editor".

## Impact

- Backend: new dependency `pypdf==6.21.4`; `app/lesson_pdf.py` (extraction); a route in `app/routes/lessons.py`; tests with small PDFs built in the tests (no binary fixtures from outside).
- Frontend: `LessonPage.tsx` (buttons, print layout, editor prefill), `api.ts`, the fake API, print CSS (`@media print`, tokens), Vitest.
- E2E: import a generated PDF, review and save; Export opens the print flow (the `window.print` call is observed).
