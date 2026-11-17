# Lesson page: import an HTML page into the lesson editor

## Why

The owner tried to upload `event_driven_architecture_senior_backend.html` (38 KB, a Claude-generated page) on the lesson page and it failed (2026-11-17). The lesson page offers only **Import PDF**: `POST /api/lessons/extract-pdf` refuses every file that is not a readable PDF. The same file attached in the agent chat worked, because the chat reads an HTML file as text and the lesson writer wrote the lesson. The research this app keeps is mostly HTML pages, so the lesson editor should take them directly, without a model.

## What Changes

- The lesson page's import button takes a PDF **or an HTML page** and is renamed **Import PDF or HTML**.
- An HTML page is converted to Markdown on the server (headings, paragraphs, lists, tables, code, bold/italic, links) and opened in the lesson editor without saving, exactly like a PDF today: nothing changes until Save, and the app asks before replacing existing text.
- New route `POST /api/lessons/extract-file`; `POST /api/lessons/extract-pdf` stays as it is.

## Capabilities

### Modified Capabilities

- `lesson-pages`: "Import a PDF into the lesson editor" (button name; the refusal scenario), plus a new requirement "Import an HTML page into the lesson editor".

## Impact

- Backend: new `app/lesson_html.py`, `app/routes/lessons.py`; tests. No migration, no new dependency (BeautifulSoup and lxml are already used by the note import).
- Frontend: `LessonPage.tsx`, `api.ts`, `test/fakeApi.ts`, tests; e2e `lesson-pdf.e2e.ts` (button name) and a new HTML import test.
- Security: the HTML is untrusted input. Only Markdown text leaves the converter; scripts, styles and embedded content are dropped, links keep only `http`, `https` and `mailto` targets, and the lesson renderer already shows no raw HTML.
