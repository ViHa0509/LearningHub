/**
 * Spec checks for the change note-edit-save: rename in the learned list with Save and Cancel,
 * the note page title with Save and Cancel (never saved on blur), and the page HTML editor
 * (Edit page, live sandboxed preview, Save, Ctrl+S, Cancel and leave confirmations).
 * Data is created through the API with unique titles and removed afterwards.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

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
async function createNote(request: APIRequestContext, tag: string, node = 'backend/redis') {
  const title = uniqueTitle(tag)
  const html = pageHtml(title, `old content ${title}`)
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

test('Edit page: editor shows the stored HTML with an isolated preview, Save replaces the page', async ({
  page,
  request,
}) => {
  const errors = watchErrors(page)
  const { note, html } = await createNote(request, 'editsave')
  const article = await openNotePage(page, note)
  await expect(page.frameLocator(`iframe[title="Original page: ${note.title}"]`).locator('#marker')).toHaveText(
    `old content ${note.title}`,
  )

  await article.getByRole('button', { name: 'Edit page' }).click()
  const editor = page.getByRole('region', { name: 'Edit page' })
  const source = editor.getByRole('textbox', { name: 'Page HTML' })
  await expect(source).toHaveValue(html)
  const preview = editor.locator(`iframe[title="Preview: ${note.title}"]`)
  await expect(preview).toHaveAttribute('sandbox', 'allow-scripts')
  expect(await preview.getAttribute('sandbox')).not.toContain('allow-same-origin')
  await expect(page.frameLocator(`iframe[title="Preview: ${note.title}"]`).locator('#marker')).toHaveText(
    `old content ${note.title}`,
  )
  const save = editor.getByRole('button', { name: 'Save' })
  await expect(save).toBeDisabled()

  // Live preview follows the source; Save becomes enabled.
  const newHtml = pageHtml(note.title, 'volatile-lru evicts keys with a TTL')
  await source.fill(newHtml)
  await expect(save).toBeEnabled()
  await expect(page.frameLocator(`iframe[title="Preview: ${note.title}"]`).locator('#marker')).toHaveText(
    'volatile-lru evicts keys with a TTL',
  )
  await shot(page, 'note-edit-editor')

  await save.click()
  await expect(editor).toHaveCount(0)
  await expect(page.frameLocator(`iframe[title="Original page: ${note.title}"]`).locator('#marker')).toHaveText(
    'volatile-lru evicts keys with a TTL',
  )
  expect((await original(request, note.id)).trim()).toBe(newHtml)

  // Title and link unchanged; content persists after reload.
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(note.title)
  await expect(page.getByRole('combobox', { name: 'Roadmap node' })).toHaveValue('backend/redis')
  await expect(page.frameLocator(`iframe[title="Original page: ${note.title}"]`).locator('#marker')).toHaveText(
    'volatile-lru evicts keys with a TTL',
  )
  await shot(page, 'note-edit-saved')
  expect(errors).toEqual([])
})

test('Edit page: Ctrl+S saves', async ({ page, request }) => {
  const errors = watchErrors(page)
  const { note } = await createNote(request, 'ctrls')
  const article = await openNotePage(page, note)
  await article.getByRole('button', { name: 'Edit page' }).click()
  const editor = page.getByRole('region', { name: 'Edit page' })
  const source = editor.getByRole('textbox', { name: 'Page HTML' })
  await expect(source).toHaveValue(/old content/)
  const newHtml = pageHtml(note.title, 'saved with the keyboard')
  await source.fill(newHtml)
  await source.press('Control+s')
  await expect(editor).toHaveCount(0)
  await expect(page.frameLocator(`iframe[title="Original page: ${note.title}"]`).locator('#marker')).toHaveText(
    'saved with the keyboard',
  )
  expect((await original(request, note.id)).trim()).toBe(newHtml)
  expect(errors).toEqual([])
})

test('Edit page: preview runs scripts in a sandbox without access to the application', async ({ page, request }) => {
  const errors = watchErrors(page)
  const { note } = await createNote(request, 'isolated')
  const article = await openNotePage(page, note)
  await article.getByRole('button', { name: 'Edit page' }).click()
  const editor = page.getByRole('region', { name: 'Edit page' })
  const source = editor.getByRole('textbox', { name: 'Page HTML' })
  await expect(source).toHaveValue(/old content/)
  const script = `<!doctype html><html><body><p id="marker">waiting</p><script>
var out; try { out = 'leaked: ' + window.parent.document.title } catch (e) { out = 'isolated' }
try { localStorage.setItem('x', '1'); out += ' storage-open' } catch (e) { out += ' no-storage' }
document.getElementById('marker').textContent = 'ran ' + out
</script></body></html>`
  await source.fill(script)
  await expect(page.frameLocator(`iframe[title="Preview: ${note.title}"]`).locator('#marker')).toHaveText(
    'ran isolated no-storage',
  )
  // Discard to leave the note as it was.
  page.once('dialog', (d) => void d.accept())
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect(editor).toHaveCount(0)
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
  await article.getByRole('button', { name: 'Edit page' }).click()
  const editor = page.getByRole('region', { name: 'Edit page' })
  await expect(editor.getByRole('textbox', { name: 'Page HTML' })).toHaveValue(html)
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect(editor).toHaveCount(0)
  expect(dialogs).toBe(0)
  page.off('dialog', count)

  // Changes, then dismiss: the editor stays with the draft.
  await article.getByRole('button', { name: 'Edit page' }).click()
  const source = editor.getByRole('textbox', { name: 'Page HTML' })
  await expect(source).toHaveValue(html)
  const draft = pageHtml(note.title, 'draft that will be dropped')
  await source.fill(draft)
  let message = ''
  page.once('dialog', (d) => {
    message = d.message()
    expect(d.type()).toBe('confirm')
    void d.dismiss()
  })
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => message).toMatch(DISCARD_PROMPT)
  await expect(editor).toBeVisible()
  await expect(source).toHaveValue(draft)

  // Accept: the editor closes and the old content stays.
  page.once('dialog', (d) => void d.accept())
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.frameLocator(`iframe[title="Original page: ${note.title}"]`).locator('#marker')).toHaveText(
    `old content ${note.title}`,
  )
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
  await article.getByRole('button', { name: 'Edit page' }).click()
  const editor = page.getByRole('region', { name: 'Edit page' })
  const source = editor.getByRole('textbox', { name: 'Page HTML' })
  await expect(source).toHaveValue(html)
  await source.fill(pageHtml(note.title, 'unsaved draft'))

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
  await expect(source).toHaveValue(/unsaved draft/)

  // Accept: leave the note; nothing was saved.
  page.once('dialog', (d) => void d.accept())
  await article.getByRole('button', { name: '← Back' }).click()
  await expect(page.getByRole('article', { name: `Note: ${note.title}` })).toHaveCount(0)
  expect(await original(request, note.id)).toBe(html)
  expect(errors).toEqual([])
})
