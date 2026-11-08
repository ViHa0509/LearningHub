## 1. Backend

- [x] 1.1 `pypdf==6.21.4` in requirements; `app/lesson_pdf.py`: extract text (limits, paragraphs, bullets, encrypted and non-PDF errors, no-text warning)
- [x] 1.2 `POST /api/lessons/extract-pdf` (header guard, multipart, size limit); tests with PDFs generated in the tests

## 1b. Notes (backend)

- [x] 1.3 Import accepts `.pdf`: extracted text to an escaped HTML page (paragraphs, lists), title from the first line or file name, stored as a note; scanned or unreadable PDFs rejected per file; tests
- [x] 1.4 `GET /api/notes/{id}/print`: the note's page with CSP `sandbox allow-scripts allow-modals` and a print call appended; tests for the headers and that the app API is unreachable (no same-origin)

## 2. Frontend

- [x] 2.1 Import PDF: file picker, call, confirm before replacing, prefill the editor (unsaved), errors and warnings
- [x] 2.2 Export PDF: print layout (`@media print`), document title during print, disabled when empty
- [x] 2.3 Vitest for every scenario
- [x] 2.4 Note page: Export PDF opens the print view in a new tab (noopener); Import dialog accepts PDF files; Vitest

## 3. E2E

- [x] 3.1 qc-e2e: import a generated PDF, review, Save; refusal of a non-PDF; Export calls print with the lesson title; loop until the suite passes
