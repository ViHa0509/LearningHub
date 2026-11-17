# Design

## Context

- `LessonPage.tsx` has a hidden file input (`accept="application/pdf,.pdf"`, label "PDF file") behind the button **Import PDF**; `importPdf` calls `api.extractPdf` -> `POST /api/lessons/extract-pdf` -> `app/lesson_pdf.py::extract_pdf`, which answers `{markdown, pages, truncated, warning}` or 422 with a reason. The text opens in the editor; nothing is saved.
- A phone's file picker does not always honour `accept`, so an HTML file can be picked today and is refused as "not a readable PDF".
- `app/extract.py` already has `decode_html` (UTF-8, else the declared charset, else `UndecodableError`) and `HTML_SUFFIXES` lives in `routes/notes.py`.
- Lessons render with `react-markdown` + `remark-gfm` and no raw HTML (`LessonBody.tsx`).

## API contract

`POST /api/lessons/extract-file` (multipart field `file`, needs the session and the `X-LearningHub: 1` header, same as `extract-pdf`)

- 200 `{"markdown": str, "pages": int | null, "truncated": bool, "warning": str | null}`; `pages` is `null` for an HTML page.
- 422 `{"detail": "<reason>"}`:
  - over the upload limit: `the file is larger than N MB`
  - HTML that cannot be decoded: `not decodable as UTF-8 or as its declared charset`
  - a PDF problem: the existing `PdfImportError` messages, unchanged
- Kind of file: a name ending in `.html` or `.htm` (case-insensitive) is HTML; every other file is handled as a PDF, exactly as `extract-pdf` does (so a `.txt` is still refused as not a readable PDF).
- `POST /api/lessons/extract-pdf` is not changed (its tests stay as they are).

## Decisions

1. **Converter `app/lesson_html.py`**: `extract_html(html: str) -> ExtractedHtml(markdown, truncated, warning)`, built on BeautifulSoup with the `lxml` parser. No new dependency; a hand-written walker keeps full control over what an untrusted page can put into a lesson.
2. **Dropped entirely** (with their content): `script`, `style`, `noscript`, `template`, `svg`, `head`, `nav`, `iframe`, `object`, `embed`, `form`, `button`, `input`, `select`, `textarea`, `audio`, `video`, `canvas`, `img`, and HTML comments. Images are dropped because a lesson has no place to store them.
3. **Mapping** (blocks separated by one blank line):
   - `h1`..`h6` -> `#`..`######` with the heading's inline text on one line.
   - `p` -> a paragraph; inner whitespace collapsed to single spaces; `br` -> a line break (two trailing spaces + newline).
   - `ul` / `ol` -> `- item` / `1. item` (numbers count up); a nested list is indented by 2 spaces under `-` and 3 under `1.`; an item's inline text first, its nested lists after.
   - `pre` -> a fenced code block with the text verbatim (no escaping). The fence is longer than the longest run of backticks in the text. A language from a `language-xxx` class on the `pre` or its `code` child is put after the fence when it matches `[A-Za-z0-9_+-]{1,20}`.
   - `blockquote` -> its blocks prefixed with `> `.
   - `hr` -> `---`.
   - `table` -> a GFM table: the first row is the header (`th` or `td`), then the `---` row, then the rows; cells are inline text on one line with `|` escaped as `\|`; short rows are padded with empty cells. A table with no rows is skipped.
   - Other containers (`div`, `section`, `article`, `main`, `header`, `footer`, `figure`, `details`, unknown tags, ...) -> their children in order; a run of inline content directly inside a container becomes a paragraph.
   - **Preformatted text outside `pre`**: a container other than `p`, `li`, `td`, `th` and headings that has no element children and whose text has at least two non-empty lines is emitted as a fenced code block with the text verbatim (Claude pages draw ASCII diagrams in a `div` styled `white-space: pre`; the style sheet is not read).
4. **Inline**: `strong`/`b` -> `**text**`; `em`/`i` -> `*text*`; `code` -> a code span (delimiter longer than any backtick run inside, padded with a space when the text starts or ends with a backtick); `a` -> `[text](href)` only when `href` starts with `http://`, `https://` or `mailto:` (case-insensitive, after trimming) and holds no whitespace, `(`, `)` or `<`/`>`; otherwise only the text (in-page `#anchors`, `javascript:` and `data:` links become plain text). Empty emphasis or links emit nothing but their text.
5. **Escaping of text nodes** (outside code): backslash-escape `\`, `` ` ``, `*`, `_`, `[`, `]`, `<`, `>` and `|` inside table cells; at the start of a paragraph line also `#`, `+`, `-`, `=` and a number followed by `.` or `)`, so page text never turns into Markdown structure it did not have.
   Added while building (same aim): `~` and `&` are escaped everywhere (no strikethrough, no entity decoding of page text); `~` and `|` also count as line-start characters; a heading's trailing `#` is escaped; a link target with a backslash or a control character is plain text; a nested list is indented by the width of its parent's marker (`10. ` gives 4); a table `caption` is a paragraph before the table.
6. **Limits and messages**, mirroring the PDF import: the Markdown is cut at `MAX_CHARS` (100 000, imported from `lesson_pdf`) on a line boundary with `truncated = true` and the warning `only the first part was imported (at most 100,000 characters)`. A page with no text gives `markdown = ""` and the warning `the page has no text to import`. The upload limit is the app's `max_upload_bytes`.
7. **Route** `extract_lesson_file` in `routes/lessons.py` as in the contract. `HTML_SUFFIXES` moves to `app/extract.py` (re-imported by `routes/notes.py`) so both routes share it. Nothing is stored and nothing is logged about the content.
8. **Frontend**: `api.extractLessonFile(file)` calls the new route; `LessonPage` uses it for every picked file. The input becomes `accept="application/pdf,.pdf,text/html,.html,.htm"` with the label `PDF or HTML file`; the button reads **Import PDF or HTML**. The empty-result fallback text becomes `The file has no text to import.`; everything else (confirm before replacing, warning line, error line `Could not import <name>: <reason>`, the too-large check before sending) is unchanged. `fakeApi.ts` gains the route; `api.extractPdf` is removed if nothing else uses it.
9. **No silent save**: unchanged; the editor opens with the text and Save stays the only way to change the lesson.

## Risks

- Lesson text is treated as the user's own writing (the agent reads it without the untrusted wrapper). An imported page's text enters a lesson only after the user sees it in the editor and clicks Save, the same as an imported PDF today.
- The converter is a best effort: layout (cards, columns, colours) is lost; the text and structure stay.
- Deep nesting: the walker is recursive; pages nested deeper than 200 levels stop descending and take the remaining text as a paragraph.
