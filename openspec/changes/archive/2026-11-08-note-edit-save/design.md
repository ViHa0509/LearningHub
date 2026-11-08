## Context

A note is an imported, untrusted HTML page. It is stored content-addressed (`blobs/<sha[:2]>/<sha>.html`) and has a unique `content_sha256`. It is shown only in `<iframe sandbox="allow-scripts">` with no `allow-same-origin`.

## Decisions

- **Source editor, not WYSIWYG.** Editing in place would mean running the untrusted page in the app's origin (`contenteditable`), or serializing a DOM the page's own scripts have already changed (revealed answers, progress bars). Neither is safe or faithful. The user edits the HTML source in a monospace textarea. Next to it, a preview `<iframe sandbox="allow-scripts" srcdoc=…>` refreshes 400 ms after typing stops. `srcdoc` with the sandbox attribute and no `allow-same-origin` gives the same opaque origin as the served page. The CSP header does not apply to `srcdoc`, but the sandbox attribute is what isolates the frame.
- **Loading the source:** `fetch('/api/notes/{id}/original')` as text. The sandbox CSP header affects documents only, not a fetch.
- **Saving:** `PUT /api/notes/{id}/content` with body `{html, base_sha256}`. Its rules:
  - `html` is stripped. When it is empty, or longer than `max_upload_bytes` once encoded as UTF-8, the answer is 422.
  - When `base_sha256` is given and differs from the note's current sha, the answer is 409 "the page changed since you opened it".
  - When the new sha equals the current sha, nothing changes and the note is returned.
  - When another note already has the new sha, the answer is 409 "another note already has this exact page".
  - Otherwise: put the new blob, update `content_sha256`, `storage_key`, `size_bytes` and `body_text` (re-extracted), commit, then delete the old blob when no note points to it. `title`, `node_id`, `archived_at` and `original_name` stay as they are.
- **`NoteDetail` gains `content_sha256`** so the editor can send it as `base_sha256`.
- **Save rule in the UI:** Save is a visible button, disabled while there is nothing to save. Enter saves single-line fields. Escape or Cancel discards. Blur never saves. The editor also handles Ctrl/Cmd+S. A dirty editor blocks leaving the note through `onClose` (confirm) and through `beforeunload`.
- **List rename:** a small form (input + Save + Cancel) replaces the title button. Focus leaving the input no longer cancels, so clicking Save works.

## Risks / Trade-offs

- A raw HTML textarea is plain, but it is safe and exact. A syntax-highlighting editor can come later without changing the API.
- Changing the page changes its sha, so a later import of the original file creates a new note instead of reporting a duplicate. This is acceptable: the user chose to diverge from the original.
