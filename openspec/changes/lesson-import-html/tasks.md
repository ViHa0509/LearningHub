# Tasks

Contract: `design.md`. Backend 1.1 and frontend 2.1 can run side by side (never two backend pytest runs at once).

## 1. Backend

- [x] 1.1 `app/lesson_html.py` (design 1-6) and `POST /api/lessons/extract-file` (design 7, API contract); `HTML_SUFFIXES` in `app/extract.py`; verify with new `tests/test_lesson_html.py`: converter unit tests for every mapping and escaping rule of design 3-5 and the limits of design 6, and route tests for every scenario of "Import an HTML page into the lesson editor" (server side: convert, code, script/style/javascript link left out, text stays text, no text, undecodable, long page), a PDF through the new route, a non-PDF non-HTML file refused, the upload limit, the app header and the session; ruff, mypy

## 2. Frontend

- [x] 2.1 `api.ts` `extractLessonFile`, `fakeApi.ts`, `LessonPage.tsx` (design 8): the button "Import PDF or HTML", the input's accept list and label; update `LessonPdf.test.tsx` for the new names without dropping a check, and add Vitest tests for "Import an HTML page and save", "Ask before replacing with an HTML page", "HTML page without text" and a refused file's error line; `npm run lint`, `npm run build`

## 3. E2E and verification

- [x] 3.1 qc-e2e: `e2e/lesson-pdf.e2e.ts` follows the renamed button; new tests from the spec scenarios with real HTML fixtures (headings, list, table, `pre`, a script, a `javascript:` link, the literal-text paragraph): the editor's text, Save, the rendered lesson (table and code block shown, no script text, the link is plain text, `*not bold*` literal), decline the replace question, a page without text; screenshots `lesson-import-html` light and dark; `npm run e2e` passes
- [x] 3.2 Every check in `CLAUDE.md` passes and `openspec validate lesson-import-html --strict` passes; verifier report
