/** Spec: learning-views - Edit a note's page (preparing and applying in-place edits). */
import { describe, expect, it } from 'vitest'
import { apply, isEditorMessage, MARK, prepare } from './inlineEdit'

const PAGE = `<!DOCTYPE html><html><head><title>Redis</title><script>window.x = 1</script></head><body>
<h1>Redis TTL</h1>
<div class="card"><p>Old <b>text</b></p><ul><li>one</li><li><p>two</p></li></ul></div>
<div>Own text <span>inside</span></div>
<button>Show answer</button>
<div class="answer" hidden><p>Hidden answer</p></div>
<script>document.body.append('added')</script>
</body></html>`

describe('inline edit', () => {
  it('marks the outermost text blocks and skips scripts and buttons', () => {
    const session = prepare(PAGE)
    const marked = Array.from(session.doc.querySelectorAll(`[${MARK}]`)).map((el) => el.textContent?.trim())
    expect(marked).toEqual(['Redis TTL', 'Old text', 'one', 'two', 'Own text inside', 'Hidden answer'])
    expect(session.blocks).toBe(6)
  })

  it('loads a copy with the editor script and keeps the page scripts', () => {
    const { frameHtml, doc } = prepare(PAGE)
    expect(frameHtml.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(frameHtml).toContain("'lh-collect'")
    expect(frameHtml).toContain('window.x = 1')
    // The editor script is only in the frame copy, never in the copy that gets saved.
    expect(doc.documentElement.outerHTML).not.toContain('lh-collect')
  })

  it('writes only the changed blocks back and removes the marks', () => {
    const session = prepare(PAGE)
    const html = apply(session, { '1': 'New <i>text</i>', '5': 'Revealed and edited' })
    expect(html).toContain('<p>New <i>text</i></p>')
    expect(html).toContain('<p>Revealed and edited</p>')
    expect(html).toContain('<h1>Redis TTL</h1>')
    expect(html).toContain('<script>window.x = 1</script>')
    expect(html).not.toContain(MARK)
    expect(html).not.toContain('lh-collect')
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
  })

  it('ignores an unknown block index', () => {
    const session = prepare(PAGE)
    expect(apply(session, { '99': 'x' })).not.toContain('>x<')
  })

  it('accepts only well-formed editor messages', () => {
    expect(isEditorMessage({ type: 'lh-dirty', count: 2 })).toBe(true)
    expect(isEditorMessage({ type: 'lh-edits', edits: { '1': 'a' } })).toBe(true)
    expect(isEditorMessage({ type: 'lh-edits', edits: { '1': 3 } })).toBe(false)
    expect(isEditorMessage({ type: 'lh-dirty' })).toBe(false)
    expect(isEditorMessage('lh-save')).toBe(false)
    expect(isEditorMessage({ type: 'other' })).toBe(false)
  })
})
