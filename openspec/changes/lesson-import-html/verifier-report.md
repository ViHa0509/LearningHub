# Verifier report: pass

Change `lesson-import-html`, checked 2026-11-17 by `ai-sdlc-kit:verifier` on the uncommitted working tree (one run for this change and `phone-import-closes-drawer`). The verifier's own e2e run failed on one unrelated test; a second full run by the main session passed (Notes).

## Checks

| Command | Exit | Result |
|---|---|---|
| `cd backend && .venv/Scripts/python -m pytest` | 0 | pass: 1071 passed |
| `cd backend && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .` | 0 | pass: all checks passed, 172 files already formatted |
| `cd backend && .venv/Scripts/mypy app` | 0 | pass: no issues in 85 source files |
| `cd frontend && npm test` | 0 | pass: 38 files, 528 tests (first run) |
| `cd frontend && npm run lint` | 0 | pass: oxlint reported nothing |
| `cd frontend && npm run build` | 0 | pass: built (chunk-size warning only, not new) |
| `cd frontend && npm run e2e` (verifier) | 1 | fail: 278 passed, 1 failed, 32 skipped, 4 did not run; `vercel-deploy.e2e.ts:203`, `read ECONNRESET` |
| `cd frontend && npm run e2e` (second run, main session) | 0 | pass: 283 passed, 32 skipped, 16.5 min |
| `openspec validate lesson-import-html --strict` | 0 | pass: change is valid |

## Task evidence

| Task | Status | Evidence |
|---|---|---|
| 1.1 | evidence found | `backend/app/lesson_html.py` (`extract_html`), `POST /api/lessons/extract-file` in `routes/lessons.py`, `HTML_SUFFIXES` in `app/extract.py`; `tests/test_lesson_html.py` (105 tests: converter and route) |
| 2.1 | evidence found | `LessonPage.tsx`, `api.ts` (`extractLessonFile`), `fakeApi.ts`; `LessonPdf.test.tsx` renamed without a dropped check; `LessonHtmlImport.test.tsx` (6 tests) |
| 3.1 | evidence found | `e2e/lesson-html.e2e.ts` (6 tests), `e2e/lesson-pdf.e2e.ts` updated; screenshots `lesson-import-html` light and dark |
| 3.2 | this report | every check passes with the second e2e run |

## Scenario to test

| Scenario | Tests |
|---|---|
| Import and save (PDF) | e2e `lesson-pdf.e2e.ts:85`; Vitest `LessonPdf.test.tsx:42` |
| Ask before replacing (PDF) | e2e `lesson-pdf.e2e.ts:121`; Vitest `LessonPdf.test.tsx:91` |
| Not a PDF | e2e `lesson-pdf.e2e.ts:160`, `lesson-html.e2e.ts:175`; Vitest `LessonPdf.test.tsx:145`, `:162`, `LessonHtmlImport.test.tsx:86`; pytest `test_lesson_html.py:461` |
| Scanned PDF | e2e `lesson-pdf.e2e.ts:193`; Vitest `LessonPdf.test.tsx:173` |
| Import an HTML page and save | e2e `lesson-html.e2e.ts:66`; Vitest `LessonHtmlImport.test.tsx:33`; pytest `test_lesson_html.py:388` |
| Ask before replacing with an HTML page | e2e `lesson-html.e2e.ts:127`; Vitest `LessonHtmlImport.test.tsx:53` |
| HTML page without text | e2e `lesson-html.e2e.ts:145`; Vitest `LessonHtmlImport.test.tsx:67`, `:77`; pytest `test_lesson_html.py:338`, `:423` |
| Undecodable HTML | e2e `lesson-html.e2e.ts:162`; pytest `test_lesson_html.py:430` |
| Long page | e2e `lesson-html.e2e.ts:193`; pytest `test_lesson_html.py:351`, `:444` |
| Code and diagrams | e2e `lesson-html.e2e.ts:66`; pytest `test_lesson_html.py:62`, `:121`, `:145` |
| Script and style are left out | e2e `lesson-html.e2e.ts:66`; pytest `test_lesson_html.py:271`, `:302`, `:412` |
| Page text stays text | e2e `lesson-html.e2e.ts:66`; pytest `test_lesson_html.py:214`, `:237` |

Uncovered scenarios: none. Deviations from design.md: none (the extra escapes added while building are recorded in design 5).

## Security checks

- Link targets: `_href` in `lesson_html.py` keeps a target only when it starts with `http://`, `https://` or `mailto:` and holds no whitespace, parentheses, `<`, `>`, backslash or control character; anything else is plain text (pytest `:166`, `:188`). No fuzz run was made.
- Script and style: dropped with their content (pytest `:271`, `:302`, `:412`; the e2e checks the script's text is in neither the editor nor the lesson).
- The route has `Depends(require_app_header)` (pytest `:484`); a request without a session is refused by the app-wide session guard (pytest `:493`).
- `lesson_html.py` and `routes/lessons.py` have no logging call; nothing is stored.
- `POST /api/lessons/extract-pdf` is unchanged (pytest `:503`).

## Notes

- The verifier's e2e run failed in `vercel-deploy.e2e.ts:203` ("a backup larger than 4 MB is sent in parts…") with `apiRequestContext.get: read ECONNRESET` at `:33`: a dropped connection to the e2e backend, not an assertion. No file of this change is involved. The full suite passed before it (qc-e2e, 283 passed) and after it (main session, 283 passed).
- The backend count of 1071 was read from the progress dots of a `-q` run (no failure marks).
- Known cosmetic limits of the converter: inline elements separated only by CSS spacing join without a space, and a card's bold title becomes its own paragraph.
