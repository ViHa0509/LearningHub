/**
 * In-place text editing of an untrusted note page.
 *
 * The app parses the stored source (DOMParser never runs scripts), marks the editable text
 * blocks, and loads a copy with a small editor script into the sandboxed frame. The frame only
 * reports the changed blocks over postMessage; the app writes them into its own parsed copy,
 * so changes the page's scripts make while it runs are never saved.
 */

export const MARK = 'data-lh-edit'

const BLOCKS = new Set([
  'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'DT', 'DD',
  'BLOCKQUOTE', 'FIGCAPTION', 'SUMMARY', 'CAPTION', 'LABEL', 'PRE',
])
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'BUTTON', 'TEXTAREA', 'SELECT', 'IFRAME'])

const hasOwnText = (el: Element) =>
  Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '')

/** Marks the outermost text blocks with `data-lh-edit="<n>"` and returns how many were marked. */
function markBlocks(doc: Document): number {
  let count = 0
  const visit = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (SKIP.has(child.tagName.toUpperCase())) continue
      if (BLOCKS.has(child.tagName.toUpperCase()) || hasOwnText(child)) {
        child.setAttribute(MARK, String(count))
        count += 1
      } else {
        visit(child)
      }
    }
  }
  if (doc.body) visit(doc.body)
  return count
}

// Runs inside the sandboxed frame. It must not contain a closing script tag.
const EDITOR_SCRIPT = `(() => {
  const changed = new Set();
  const post = (data) => parent.postMessage(data, '*');
  for (const el of document.querySelectorAll('[${MARK}]')) {
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
  }
  document.addEventListener('input', (e) => {
    const block = e.target instanceof Element ? e.target.closest('[${MARK}]') : null;
    if (!block) return;
    changed.add(block);
    post({ type: 'lh-dirty', count: changed.size });
  }, true);
  document.addEventListener('paste', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('[${MARK}]')) return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData ? e.clipboardData.getData('text/plain') : '');
  }, true);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      post({ type: 'lh-save' });
    }
  }, true);
  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || e.data.type !== 'lh-collect') return;
    const edits = {};
    for (const el of changed) edits[el.getAttribute('${MARK}')] = el.innerHTML;
    post({ type: 'lh-edits', edits });
  });
  post({ type: 'lh-ready' });
})();`

const EDITOR_STYLE = `
[${MARK}] { outline: 1px dashed transparent; outline-offset: 2px; border-radius: 2px; cursor: text; }
[${MARK}]:hover { outline-color: rgba(34, 211, 238, 0.7); }
[${MARK}]:focus { outline: 2px solid #22d3ee; background: rgba(34, 211, 238, 0.08); }
`

export interface EditSession {
  /** The parsed source with marks; edits are applied to it. */
  doc: Document
  /** The page loaded into the frame: the marked source plus the editor script. */
  frameHtml: string
  blocks: number
}

function serialize(doc: Document): string {
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : ''
  return doctype + doc.documentElement.outerHTML
}

export function prepare(source: string): EditSession {
  const doc = new DOMParser().parseFromString(source, 'text/html')
  const blocks = markBlocks(doc)
  const copy = doc.cloneNode(true) as Document
  const style = copy.createElement('style')
  style.textContent = EDITOR_STYLE
  copy.head.appendChild(style)
  const script = copy.createElement('script')
  script.textContent = EDITOR_SCRIPT
  copy.body.appendChild(script)
  return { doc, frameHtml: serialize(copy), blocks }
}

/** Writes the changed blocks into the parsed source and returns it as HTML, without marks. */
export function apply(session: EditSession, edits: Record<string, string>): string {
  const doc = session.doc.cloneNode(true) as Document
  for (const [index, html] of Object.entries(edits)) {
    const el = doc.querySelector(`[${MARK}="${CSS.escape(index)}"]`)
    if (el) el.innerHTML = html
  }
  for (const el of Array.from(doc.querySelectorAll(`[${MARK}]`))) el.removeAttribute(MARK)
  return serialize(doc)
}

export function isEditorMessage(data: unknown): data is
  | { type: 'lh-ready' }
  | { type: 'lh-save' }
  | { type: 'lh-dirty'; count: number }
  | { type: 'lh-edits'; edits: Record<string, string> } {
  if (typeof data !== 'object' || data === null) return false
  const d = data as { type?: unknown; count?: unknown; edits?: unknown }
  if (d.type === 'lh-ready' || d.type === 'lh-save') return true
  if (d.type === 'lh-dirty') return typeof d.count === 'number'
  if (d.type === 'lh-edits') {
    return (
      typeof d.edits === 'object' &&
      d.edits !== null &&
      Object.values(d.edits).every((v) => typeof v === 'string')
    )
  }
  return false
}
