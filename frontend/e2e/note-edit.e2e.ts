/**
 * Spec checks for the change note-edit-save: rename in the learned list with Save and Cancel,
 * the note page title with Save and Cancel (never saved on blur); and for note-inline-edit the
 * in-place page editor (Edit page makes the rendered page editable in a sandboxed frame; Save,
 * Ctrl+S inside the page, only typed changes saved, Cancel and leave confirmations, isolation).
 * Data is created through the API with unique titles and removed afterwards.
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const API = 'http://127.0.0.1:8001/api'
const H = { 'X-LearningHub': '1' }
const PREFIX = 'QC-edit'
const DISCARD_PROMPT = /discard/i
let seq = 0

interface ApiNote {
  id: string
  title: string
  node_id: string | null
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

function uniqueTitle(tag: string) {
  seq += 1
  return `${PREFIX} ${tag} ${Date.now().toString(36)}${seq}`
}

function pageHtml(title: string, marker: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p id="marker">${marker}</p></body></html>`
}

/** Import one HTML note through the API, linked to a node. */
async function createNote(
  request: APIRequestContext,
  tag: string,
  node = 'backend/redis',
  custom?: { title: string; html: string },
) {
  const title = custom?.title ?? uniqueTitle(tag)
  const html = custom?.html ?? pageHtml(title, `old content ${title}`)
  const res = await request.post(`${API}/notes/import`, {
    headers: H,
    multipart: { files: { name: `${title.replace(/ /g, '_')}.html`, mimeType: 'text/html', buffer: Buffer.from(html) } },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(body.results[0].outcome).toBe('created')
  let note: ApiNote = body.results[0].note
  const linked = await request.patch(`${API}/notes/${note.id}`, { headers: H, data: { node_id: node } })
  expect(linked.ok()).toBeTruthy()
  note = await linked.json()
  return { note, html }
}

async function listNotes(request: APIRequestContext): Promise<ApiNote[]> {
  const res = await request.get(`${API}/notes`)
  expect(res.ok()).toBeTruthy()
  return res.json()
}

async function original(request: APIRequestContext, id: string) {
  const res = await request.get(`${API}/notes/${id}/original`)
  expect(res.ok()).toBeTruthy()
  return res.text()
}

test.afterEach(async ({ request }) => {
  for (const n of await listNotes(request)) {
    if (n.title.startsWith(PREFIX)) await request.delete(`${API}/notes/${n.id}`, { headers: H })
  }
  const arch = await request.get(`${API}/notes?archived=true`)
  if (arch.ok()) {
    for (const n of (await arch.json()) as ApiNote[]) {
      if (n.title.startsWith(PREFIX)) await request.delete(`${API}/notes/${n.id}`, { headers: H })
    }
  }
})

const listOf = (page: Page) => page.getByRole('complementary', { name: 'Learned items' })

async function openRename(page: Page, title: string) {
  await listOf(page).getByRole('button', { name: `More actions for ${title}` }).click()
  await page.getByRole('menu', { name: 'Note actions' }).getByRole('menuitem', { name: 'Rename' }).click()
  const form = listOf(page).getByRole('form', { name: `Rename ${title}` })
  await expect(form).toBeVisible()
  return form
}

async function openNotePage(page: Page, note: ApiNote) {
  await page.goto(`/#/note/${note.id}`)
  const article = page.getByRole('article', { name: `Note: ${note.title}` })
  await expect(article.getByRole('textbox', { name: 'Note title' })).toHaveValue(note.title)
  return article
}

test('Rename from the list: Save disabled until changed, Cancel and Escape keep the title, Save and Enter rename', async ({
  page,
  request,
}) => {
  const errors = watchErrors(page)
  const { note } = await createNote(request, 'listrename')
  await page.goto('/')
  const list = listOf(page)
  await expect(list.getByRole('button', { name: note.title, exact: true })).toBeVisible()

  // Save needs a change: disabled with the current title and with an empty field.
  let form = await openRename(page, note.title)
  const save = form.getByRole('button', { name: 'Save' })
  const box = form.getByRole('textbox', { name: 'New title' })
  await expect(box).toHaveValue(note.title)
  await expect(save).toBeDisabled()
  await expect(form.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  await box.fill('')
  await expect(save).toBeDisabled()
  await box.fill('   ')
  await expect(save).toBeDisabled()
  await box.fill(`${note.title} changed`)
  await expect(save).toBeEnabled()
  await shot(page, 'note-edit-list-rename')

  // Cancel leaves the title unchanged.
  await form.getByRole('button', { name: 'Cancel' }).click()
  await expect(form).toHaveCount(0)
  await expect(list.getByRole('button', { name: note.title, exact: true })).toBeVisible()

  // Escape leaves the title unchanged.
  form = await openRename(page, note.title)
  await form.getByRole('textbox', { name: 'New title' }).fill(`${note.title} esc`)
  await form.getByRole('textbox', { name: 'New title' }).press('Escape')
  await expect(form).toHaveCount(0)
  await expect(list.getByRole('button', { name: note.title, exact: true })).toBeVisible()
  expect((await listNotes(request)).find((n) => n.id === note.id)?.title).toBe(note.title)

  // Clicking Save renames.
  const saved = `${PREFIX} Redis TTL ${Date.now().toString(36)}`
  form = await openRename(page, note.title)
  await form.getByRole('textbox', { name: 'New title' }).fill(saved)
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(list.getByRole('button', { name: saved, exact: true })).toBeVisible()
  await expect(list.getByRole('button', { name: note.title, exact: true })).toHaveCount(0)
  expect((await listNotes(request)).find((n) => n.id === note.id)?.title).toBe(saved)

  // Enter also saves.
  const entered = `${saved} enter`
  form = await openRename(page, saved)
  await form.getByRole('textbox', { name: 'New title' }).fill(entered)
  await form.getByRole('textbox', { name: 'New title' }).press('Enter')
  await expect(list.getByRole('button', { name: entered, exact: true })).toBeVisible()
  expect((await listNotes(request)).find((n) => n.id === note.id)?.title).toBe(entered)

  await page.reload()
  await expect(listOf(page).getByRole('button', { name: entered, exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('Rename on the note page: Save and Cancel appear on change, blur does not save, Save persists', async ({
  page,
  request,
}) => {
  const errors = watchErrors(page)
  const { note } = await createNote(request, 'pagetitle')
  const article = await openNotePage(page, note)
  const field = article.getByRole('textbox', { name: 'Note title' })

  // No buttons before an edit.
  await expect(article.getByRole('button', { name: 'Save title' })).toHaveCount(0)
  await expect(article.getByRole('button', { name: 'Cancel title change' })).toHaveCount(0)

  // Editing shows them; leaving the field does not save.
  const changed = `${note.title} blurred`
  await field.fill(changed)
  await expect(article.getByRole('button', { name: 'Save title' })).toBeVisible()
  await expect(article.getByRole('button', { name: 'Cancel title change' })).toBeVisible()
  await shot(page, 'note-edit-title-dirty')
  await field.blur()
  await page.getByRole('combobox', { name: 'Roadmap node' }).focus()
  await page.waitForTimeout(500)
  expect((await listNotes(request)).find((n) => n.id === note.id)?.title).toBe(note.title)
  await expect(listOf(page).getByRole('button', { name: note.title, exact: true })).toBeVisible()

  // Cancel restores the saved title and hides the buttons.
  await article.getByRole('button', { name: 'Cancel title change' }).click()
  await expect(field).toHaveValue(note.title)
  await expect(article.getByRole('button', { name: 'Save title' })).toHaveCount(0)

  // Reload after a blurred edit: the title is unchanged.
  await field.fill(changed)
  await field.blur()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(note.title)

  // Save title persists after reload.
  const saved = `${PREFIX} Saved title ${Date.now().toString(36)}`
  await page.getByRole('textbox', { name: 'Note title' }).fill(saved)
  await page.getByRole('button', { name: 'Save title' }).click()
  await expect(page.getByRole('article', { name: `Note: ${saved}` })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save title' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(saved)
  expect((await listNotes(request)).find((n) => n.id === note.id)?.title).toBe(saved)
  expect(errors).toEqual([])
})

const editingSelector = (title: string) => `iframe[title="Editing: ${title}"]`
const editingFrame = (page: Page, title: string) => page.frameLocator(editingSelector(title))
const originalFrame = (page: Page, title: string) => page.frameLocator(`iframe[title="Original page: ${title}"]`)

/** Opens the in-place editor and waits until the page in the editing frame is editable. */
async function openEditor(page: Page, article: Locator, title: string) {
  await article.getByRole('button', { name: 'Edit page' }).click()
  const editor = page.getByRole('region', { name: 'Edit page' })
  await expect(editor).toBeVisible()
  await expect(editingFrame(page, title).locator('h1')).toHaveAttribute('contenteditable', 'true')
  return editor
}

/** Clicks a block inside the editing frame, selects its text and types a replacement. */
async function replaceText(page: Page, title: string, selector: string, text: string) {
  const block = editingFrame(page, title).locator(selector)
  await block.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(text)
  await expect(block).toHaveText(text)
}

/** Stored HTML must never keep the editor's marks or script. */
function expectNoEditorTraces(stored: string) {
  expect(stored).not.toContain('data-lh-edit')
  expect(stored).not.toContain('contenteditable')
  expect(stored).not.toContain('lh-collect')
}

test('Edit page: the page itself becomes editable in a sandboxed frame, Save writes only the changed text', async ({
  page,
  request,
}) => {
  const errors = watchErrors(page)
  const { note } = await createNote(request, 'editsave')
  const article = await openNotePage(page, note)
  await expect(originalFrame(page, note.title).locator('#marker')).toHaveText(`old content ${note.title}`)

  const editor = await openEditor(page, article, note.title)
  // No HTML source and no side preview: the rendered page is the editor.
  await expect(editor.getByRole('textbox', { name: 'Page HTML' })).toHaveCount(0)
  await expect(page.locator('textarea')).toHaveCount(0)
  await expect(page.locator('iframe[title^="Preview:"]')).toHaveCount(0)
  await expect(page.locator(`iframe[title="Original page: ${note.title}"]`)).toHaveCount(0)
  const frameEl = editor.locator(editingSelector(note.title))
  await expect(frameEl).toHaveAttribute('sandbox', 'allow-scripts')
  expect(await frameEl.getAttribute('sandbox')).not.toContain('allow-same-origin')
  const marker = editingFrame(page, note.title).locator('#marker')
  await expect(marker).toHaveText(`old content ${note.title}`)
  await expect(marker).toHaveAttribute('contenteditable', 'true')
  const status = editor.getByRole('status')
  await expect(status).toHaveText('Click any text on the page to edit it')
  const save = editor.getByRole('button', { name: 'Save' })
  await expect(save).toBeDisabled()
  await expect(editor.getByRole('button', { name: 'Cancel' })).toBeEnabled()

  // Click the paragraph, replace its text: one block changed, Save enabled.
  await replaceText(page, note.title, '#marker', 'volatile-lru evicts keys with a TTL')
  await expect(status).toHaveText('1 block changed')
  await expect(save).toBeEnabled()
  await shot(page, 'note-edit-inline')

  await save.click()
  await expect(editor).toHaveCount(0)
  await expect(originalFrame(page, note.title).locator('#marker')).toHaveText('volatile-lru evicts keys with a TTL')
  await expect(originalFrame(page, note.title).locator('h1')).toHaveText(note.title)

  const stored = await original(request, note.id)
  expect(stored).toContain('volatile-lru evicts keys with a TTL')
  expect(stored).not.toContain(`old content ${note.title}`)
  expect(stored).toContain(`<h1>${note.title}</h1>`)
  expect(stored).toContain(`<title>${note.title}</title>`)
  expectNoEditorTraces(stored)

  // Title and link unchanged; content persists after reload.
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(note.title)
  await expect(page.getByRole('combobox', { name: 'Roadmap node' })).toHaveValue('backend/redis')
  await expect(originalFrame(page, note.title).locator('#marker')).toHaveText('volatile-lru evicts keys with a TTL')
  await expect(originalFrame(page, note.title).locator('h1')).toHaveText(note.title)
  await shot(page, 'note-edit-saved')
  expect(errors).toEqual([])
})

test('Edit page: Ctrl+S inside the page saves', async ({ page, request }) => {
  const errors = watchErrors(page)
  const { note } = await createNote(request, 'ctrls')
  const article = await openNotePage(page, note)
  const editor = await openEditor(page, article, note.title)
  await replaceText(page, note.title, '#marker', 'saved with the keyboard')
  await expect(editor.getByRole('status')).toHaveText('1 block changed')
  // Focus is still inside the frame.
  await page.keyboard.press('Control+s')
  await expect(editor).toHaveCount(0)
  await expect(originalFrame(page, note.title).locator('#marker')).toHaveText('saved with the keyboard')
  const stored = await original(request, note.id)
  expect(stored).toContain('saved with the keyboard')
  expectNoEditorTraces(stored)
  expect(errors).toEqual([])
})

test("Edit page: changes made by the page's own scripts are not saved", async ({ page, request }) => {
  const errors = watchErrors(page)
  const title = uniqueTitle('scripted')
  // The generated texts never appear literally in the source.
  const script = [
    "var p = document.createElement('div'); p.id = 'progress';",
    "p.textContent = 'progress ' + 0 + '/' + 3; document.body.appendChild(p);",
    "document.getElementById('status').textContent = 'ready' + '-' + 'by-script';",
  ].join('\n')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p id="marker">old content</p><p id="status">static status</p><script>${script}</script></body></html>`
  const { note } = await createNote(request, 'scripted', 'backend/redis', { title, html })
  const article = await openNotePage(page, note)
  const editor = await openEditor(page, article, note.title)
  const frame = editingFrame(page, note.title)
  await expect(frame.locator('#progress')).toHaveText('progress 0/3')
  await expect(frame.locator('#status')).toHaveText('ready-by-script')

  await replaceText(page, note.title, '#marker', 'edited by the user')
  await expect(editor.getByRole('status')).toHaveText('1 block changed')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor).toHaveCount(0)

  const stored = await original(request, note.id)
  expect(stored).toContain('edited by the user')
  expect(stored).toContain(script)
  expect(stored).toContain('static status')
  expect(stored).not.toContain('progress 0/3')
  expect(stored).not.toContain('ready-by-script')
  expect(stored).not.toContain('id="progress"')
  expectNoEditorTraces(stored)

  // The saved page still runs its script once, as before.
  const orig = originalFrame(page, note.title)
  await expect(orig.locator('#marker')).toHaveText('edited by the user')
  await expect(orig.locator('#progress')).toHaveCount(1)
  await expect(orig.locator('#status')).toHaveText('ready-by-script')
  expect(errors).toEqual([])
})

test('Edit page: the editing frame runs scripts in a sandbox without access to the application', async ({
  page,
  request,
}) => {
  const errors = watchErrors(page)
  const title = uniqueTitle('isolated')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p id="marker">waiting</p><script>
var out; try { out = 'leaked: ' + window.parent.document.title } catch (e) { out = 'isolated' }
try { out += ' storage:' + localStorage.getItem('lh-e2e-probe') } catch (e) { out += ' no-storage' }
document.getElementById('marker').textContent = 'ran ' + out
</script></body></html>`
  const { note } = await createNote(request, 'isolated', 'backend/redis', { title, html })
  const article = await openNotePage(page, note)
  await page.evaluate(() => localStorage.setItem('lh-e2e-probe', 'app-secret'))
  const editor = await openEditor(page, article, note.title)
  const frameEl = editor.locator(editingSelector(note.title))
  await expect(frameEl).toHaveAttribute('sandbox', 'allow-scripts')
  expect(await frameEl.getAttribute('sandbox')).not.toContain('allow-same-origin')
  await expect(editingFrame(page, note.title).locator('#marker')).toHaveText('ran isolated no-storage')
  // The editing frame runs in an opaque origin.
  const frame = page.frames().find((f) => f !== page.mainFrame())
  expect(frame).toBeTruthy()
  expect(await frame!.evaluate('window.origin')).toBe('null')
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect(editor).toHaveCount(0)
  await page.evaluate(() => localStorage.removeItem('lh-e2e-probe'))
  expect(errors).toEqual([])
})

test('Edit page: Cancel without changes closes; with changes it asks, dismiss keeps, accept discards', async ({
  page,
  request,
}) => {
  const errors = watchErrors(page)
  const { note, html } = await createNote(request, 'cancel')
  const article = await openNotePage(page, note)

  // No changes: Cancel closes without asking.
  let dialogs = 0
  const count = () => {
    dialogs += 1
  }
  page.on('dialog', count)
  let editor = await openEditor(page, article, note.title)
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect(editor).toHaveCount(0)
  expect(dialogs).toBe(0)
  page.off('dialog', count)

  // Changes, then dismiss: the editor stays with the draft.
  editor = await openEditor(page, article, note.title)
  await replaceText(page, note.title, '#marker', 'draft that will be dropped')
  await expect(editor.getByRole('status')).toHaveText('1 block changed')
  let message = ''
  page.once('dialog', (d) => {
    message = d.message()
    expect(d.type()).toBe('confirm')
    void d.dismiss()
  })
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => message).toMatch(DISCARD_PROMPT)
  await expect(editor).toBeVisible()
  await expect(editingFrame(page, note.title).locator('#marker')).toHaveText('draft that will be dropped')
  await expect(editor.getByRole('status')).toHaveText('1 block changed')

  // Accept: the editor closes and the old content stays.
  page.once('dialog', (d) => void d.accept())
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect(editor).toHaveCount(0)
  await expect(originalFrame(page, note.title).locator('#marker')).toHaveText(`old content ${note.title}`)
  expect(await original(request, note.id)).toBe(html)
  expect(errors).toEqual([])
})

test('Edit page: leaving with unsaved changes through Back asks first', async ({ page, request }) => {
  const errors = watchErrors(page)
  const { note, html } = await createNote(request, 'leave')
  await page.goto('/')
  await listOf(page).getByRole('button', { name: note.title, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`#/note/${note.id}`))
  const article = page.getByRole('article', { name: `Note: ${note.title}` })
  const editor = await openEditor(page, article, note.title)
  await replaceText(page, note.title, '#marker', 'unsaved draft')
  await expect(editor.getByRole('status')).toHaveText('1 block changed')

  // Dismiss: stay on the note with the draft.
  let message = ''
  page.once('dialog', (d) => {
    message = d.message()
    expect(d.type()).toBe('confirm')
    void d.dismiss()
  })
  await article.getByRole('button', { name: '← Back' }).click()
  await expect.poll(() => message).toMatch(DISCARD_PROMPT)
  await expect(page).toHaveURL(new RegExp(`#/note/${note.id}`))
  await expect(editingFrame(page, note.title).locator('#marker')).toHaveText('unsaved draft')

  // Accept: leave the note; nothing was saved.
  page.once('dialog', (d) => void d.accept())
  await article.getByRole('button', { name: '← Back' }).click()
  await expect(page.getByRole('article', { name: `Note: ${note.title}` })).toHaveCount(0)
  expect(await original(request, note.id)).toBe(html)
  expect(errors).toEqual([])
})
