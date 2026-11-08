## Context

The note page is untrusted HTML. It must stay in `<iframe sandbox="allow-scripts">` with no `allow-same-origin`, so the app cannot reach into the frame's DOM. The only channel between them is `postMessage`.

## Decisions

- **Parse in the app, edit in the frame.**
  - The app fetches the stored source and parses it with `DOMParser`, which never runs scripts.
  - It marks editable blocks with `data-lh-edit="<n>"`: the outermost element that is a text block (p, li, h1-h6, td, th, dt, dd, blockquote, figcaption, summary, caption, label, pre) or has its own non-blank text. It skips script, style, template, noscript, svg, button, textarea, select, iframe and their contents.
  - It builds the frame copy: a clone with a small editor script and style added. This copy is loaded as `srcdoc` in the same sandbox.
  - The marks travel with the elements, so the indexes stay right even when the page's scripts add elements.
- **Editor script in the frame:**
  - Sets `contenteditable` on every `[data-lh-edit]` and marks a block as changed on `input`.
  - Inserts pasted text as plain text.
  - Reports `{type: 'lh-dirty', count}` and forwards Ctrl/Cmd+S as `{type: 'lh-save'}`, because keystrokes in the frame do not reach the app.
  - Answers `{type: 'lh-collect'}` with `{type: 'lh-edits', edits: {n: innerHTML}}` for changed blocks only.
  - It never reads app data, and the app posts it nothing secret.
- **The app trusts only its own frame:** it accepts a message only when `event.source` is that frame's `contentWindow` and the data has the expected shape.
- **Saving:**
  - The app sets `innerHTML` of each changed block in its parsed source copy.
  - It removes every `data-lh-edit` mark and serializes the copy (doctype + `documentElement.outerHTML`).
  - It saves through the existing `PUT /content` with `base_sha256`.
  - The edited HTML comes from the same untrusted page and is shown only in the same sandbox, so isolation is unchanged.
  - Because the app saves its own copy, changes the page's scripts made while it ran are never saved: only the changed blocks' content is.

## Risks / Trade-offs

- Serializing a parsed document normalizes markup (quoting, entities) across the whole file. The content is equivalent.
- If a script rewrites the content of a block the user also edited, the rewritten content is what gets saved for that block. This is rare.
