/**
 * Spec checks for the change lesson-pdf: Import PDF into the lesson editor (unsaved until Save,
 * confirm before replacing, refusals and the no-text warning), Export PDF on a lesson (print
 * with the lesson title, print layout), PDF files in the notes Import dialog, and Export PDF on a
 * note (an isolated print view in a new tab). PDFs are generated in the tests (e2e/pdf.ts).
 * window.print is replaced by a recorder, so no print dialog opens.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { BULLET, makePdf } from './pdf.ts'

test.describe.configure({ mode: 'serial' })

const API = 'http://127.0.0.1:8001/api'
const H = { 'X-LearningHub': '1' }
const NODE = 'devops/kubernetes'
const NODE_TITLE = 'Kubernetes'
const NOTE_PREFIX = 'QC-pdf'

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

async function setLesson(request: APIRequestContext, body: string) {
  const res = await request.put(`${API}/lessons/${NODE}`, {
    headers: H,
    data: { body, source: 'user' },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}

async function lessonBody(request: APIRequestContext): Promise<string> {
  return (await (await request.get(`${API}/lessons/${NODE}`)).json()).body
}

async function deleteQcNotes(request: APIRequestContext) {
  for (const archived of [false, true]) {
    const notes = await (await request.get(`${API}/notes${archived ? '?archived=true' : ''}`)).json()
    for (const n of notes as Array<{ id: string; title: string }>) {
      if (n.title.startsWith(NOTE_PREFIX)) await request.delete(`${API}/notes/${n.id}`, { headers: H })
    }
  }
}

/** Records every window.print() call with the document title and print class at that moment. */
const PRINT_RECORDER = `
  window.__prints = [];
  window.print = function () {
    window.__prints.push({
      title: document.title,
      printing: document.documentElement.classList.contains('printing-lesson'),
    });
  };
`

async function prints(page: Page): Promise<Array<{ title: string; printing: boolean }>> {
  return (await page.evaluate('window.__prints')) as Array<{ title: string; printing: boolean }>
}

function lessonSection(page: Page) {
  return page.getByRole('article', { name: `Lesson: ${NODE_TITLE}` }).getByRole('region', { name: 'Lesson' })
}

async function importPdf(page: Page, name: string, buffer: Buffer, mimeType = 'application/pdf') {
  await lessonSection(page).getByLabel('PDF file').setInputFiles({ name, mimeType, buffer })
}

const DOCKER_PDF = makePdf([['Docker images', 'are read-only templates.', '', `${BULLET} layers`, `${BULLET} tags`]])

test.beforeEach(async ({ request }) => {
  await setLesson(request, '')
})

test.afterAll(async ({ request }) => {
  await setLesson(request, '')
  await deleteQcNotes(request)
})

test.describe('Import a PDF into the lesson editor', () => {
  test('Import and save: the text opens unsaved in the editor and is kept after Save', async ({ page, request }) => {
    const errors = watchErrors(page)
    await page.goto(`/#/lesson/${NODE}`)
    const lesson = lessonSection(page)
    await expect(lesson.getByRole('button', { name: 'Import PDF' })).toBeEnabled()

    // The extraction is held back a moment so the progress text can be seen.
    await page.route('**/api/lessons/extract-pdf', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      await route.continue()
    })
    await importPdf(page, 'docker.pdf', DOCKER_PDF)
    await expect(lesson.getByRole('status')).toHaveText('Reading PDF…')

    const editor = lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' })
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue(/Docker images are read-only templates\./)
    await expect(editor).toHaveValue(/^- layers$/m)
    await expect(editor).toHaveValue(/^- tags$/m)
    await expect(lesson.getByRole('status')).toHaveCount(0)
    // Nothing is saved before Save, and Export waits for the edit to end.
    expect(await lessonBody(request)).toBe('')
    await expect(lesson.getByRole('button', { name: 'Export PDF' })).toBeDisabled()
    await shot(page, 'lesson-pdf-import')

    await lesson.getByRole('button', { name: 'Save lesson' }).click()
    const body = lesson.getByTestId('lesson-body')
    await expect(body.locator('li')).toHaveText(['layers', 'tags'])
    await expect(body).toContainText('Docker images are read-only templates.')
    expect(await lessonBody(request)).toContain('- layers')

    await page.reload()
    await expect(lessonSection(page).getByTestId('lesson-body').locator('li')).toHaveText(['layers', 'tags'])
    expect(errors).toEqual([])
  })

  test('Ask before replacing: declining keeps the lesson, accepting opens the PDF text unsaved', async ({
    page,
    request,
  }) => {
    await setLesson(request, 'My own notes about pods.')
    await page.goto(`/#/lesson/${NODE}`)
    const lesson = lessonSection(page)
    await expect(lesson.getByTestId('lesson-body')).toHaveText('My own notes about pods.')

    const asked: string[] = []
    page.once('dialog', (dialog) => {
      asked.push(`${dialog.type()}: ${dialog.message()}`)
      void dialog.dismiss()
    })
    await importPdf(page, 'docker.pdf', DOCKER_PDF)
    await expect.poll(() => asked).toEqual(['confirm: Replace the lesson text with the text of docker.pdf?'])
    await expect(lesson.getByRole('status')).toHaveCount(0)
    await expect(lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' })).toHaveCount(0)
    await expect(lesson.getByTestId('lesson-body')).toHaveText('My own notes about pods.')

    // An open edit counts as text too: the editor's text is kept when the user declines.
    await lesson.getByRole('button', { name: 'Edit lesson' }).click()
    const editor = lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' })
    await editor.fill('Edited but not saved.')
    page.once('dialog', (dialog) => void dialog.dismiss())
    await importPdf(page, 'docker.pdf', DOCKER_PDF)
    await expect(lesson.getByRole('button', { name: 'Import PDF' })).toBeEnabled()
    await expect(editor).toHaveValue('Edited but not saved.')

    page.once('dialog', (dialog) => void dialog.accept())
    await importPdf(page, 'docker.pdf', DOCKER_PDF)
    await expect(editor).toHaveValue(/^- layers$/m)
    expect(await lessonBody(request)).toBe('My own notes about pods.')

    await lesson.getByRole('button', { name: 'Cancel' }).click()
    await expect(lesson.getByTestId('lesson-body')).toHaveText('My own notes about pods.')
    expect(await lessonBody(request)).toBe('My own notes about pods.')
  })

  test('Not a PDF, or an encrypted PDF: the import is refused with the reason', async ({ page, request }) => {
    await setLesson(request, 'Kept as it is.')
    await page.goto(`/#/lesson/${NODE}`)
    const lesson = lessonSection(page)
    await expect(lesson.getByTestId('lesson-body')).toHaveText('Kept as it is.')
    let asked = 0
    page.on('dialog', (dialog) => {
      asked += 1
      void dialog.dismiss()
    })

    await importPdf(page, 'notes.pdf', Buffer.from('<html><body>not a pdf</body></html>'))
    await expect(lesson.getByRole('alert')).toHaveText('Could not import notes.pdf: the file is not a PDF')
    await expect(lesson.getByTestId('lesson-body')).toHaveText('Kept as it is.')

    await importPdf(page, 'locked.pdf', makePdf([['Secret text']], { encrypted: true }))
    await expect(lesson.getByRole('alert')).toContainText('Could not import locked.pdf:')
    await expect(lesson.getByRole('alert')).toContainText('password-protected')
    await expect(lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' })).toHaveCount(0)
    expect(asked).toBe(0)
    expect(await lessonBody(request)).toBe('Kept as it is.')

    // The endpoint itself needs the app header.
    const bare = await request.post(`${API}/lessons/extract-pdf`, {
      multipart: { file: { name: 'docker.pdf', mimeType: 'application/pdf', buffer: DOCKER_PDF } },
    })
    expect(bare.status()).toBe(403)
  })

  test('Scanned PDF: the app says there is no text to import', async ({ page, request }) => {
    await page.goto(`/#/lesson/${NODE}`)
    const lesson = lessonSection(page)
    await importPdf(page, 'scan.pdf', makePdf([[]]))
    await expect(lesson.getByRole('status')).toContainText('no text to import')
    await expect(lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' })).toHaveCount(0)
    expect(await lessonBody(request)).toBe('')
  })
})

test.describe('Export a lesson as PDF', () => {
  test('Nothing to export: Export PDF is disabled while the lesson is empty', async ({ page }) => {
    await page.goto(`/#/lesson/${NODE}`)
    const lesson = lessonSection(page)
    await expect(lesson.getByRole('button', { name: 'Write lesson' })).toBeVisible()
    await expect(lesson.getByRole('button', { name: 'Export PDF' })).toBeDisabled()
  })

  test('Export a written lesson: print runs with the lesson title and only the lesson is printed', async ({
    page,
    request,
  }) => {
    await setLesson(request, '## Pods\n\nThe smallest unit.\n\n- containers\n- volumes')
    await page.addInitScript(PRINT_RECORDER)
    await page.goto(`/#/lesson/${NODE}`)
    const lesson = lessonSection(page)
    await expect(lesson.getByTestId('lesson-body').locator('h2')).toHaveText('Pods')
    const appTitle = await page.title()

    const exportButton = lesson.getByRole('button', { name: 'Export PDF' })
    await expect(exportButton).toBeEnabled()
    await exportButton.click()
    await expect.poll(() => prints(page)).toEqual([{ title: NODE_TITLE, printing: true }])
    // The app's title and screen layout come back after printing.
    await expect(page).toHaveTitle(appTitle)
    await expect(page.locator('html')).not.toHaveClass(/printing-lesson/)

    // The print layout: the lesson stays, the panels, buttons and chat are hidden.
    await page.emulateMedia({ media: 'print' })
    await page.evaluate("document.documentElement.classList.add('printing-lesson')")
    await expect(lesson.getByTestId('lesson-body')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: NODE_TITLE })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Agent' })).toBeHidden()
    await expect(page.getByRole('complementary', { name: 'Learned items' })).toBeHidden()
    await expect(exportButton).toBeHidden()
    await expect(lesson.getByRole('button', { name: 'Edit lesson' })).toBeHidden()
    await page.evaluate("document.documentElement.classList.remove('printing-lesson')")
    await page.emulateMedia({ media: 'screen' })
  })
})

test.describe('PDF files in the notes import', () => {
  test('A PDF becomes a note titled after its first line; scanned and other files are rejected', async ({
    page,
    request,
  }) => {
    await deleteQcNotes(request)
    const errors = watchErrors(page)
    const title = `${NOTE_PREFIX} Docker basics`
    const pdf = makePdf([[title, 'Markup <b>stays</b> text & more.', '', `${BULLET} images`, `${BULLET} containers`]])
    await page.goto('/')
    await page.getByRole('button', { name: 'Import HTML or PDF files' }).click()
    const dialog = page.getByRole('dialog', { name: 'Import HTML or PDF files' })
    await dialog.getByLabel('HTML or PDF files').setInputFiles([
      { name: 'docker-basics.pdf', mimeType: 'application/pdf', buffer: pdf },
      { name: 'scan.pdf', mimeType: 'application/pdf', buffer: makePdf([[]]) },
      { name: 'notes.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK fake docx') },
    ])
    const rows = dialog.locator('.import-results li')
    await expect(rows.filter({ hasText: 'docker-basics.pdf' })).toContainText('Imported')
    await expect(rows.filter({ hasText: 'scan.pdf' })).toContainText('Rejected:')
    await expect(rows.filter({ hasText: 'scan.pdf' })).toContainText('no text to import')
    await expect(rows.filter({ hasText: 'notes.docx' })).toContainText('Rejected: not an HTML or PDF file')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    const notes = (await (await request.get(`${API}/notes`)).json()) as Array<{ id: string; title: string }>
    const created = notes.filter((n) => n.title.startsWith(NOTE_PREFIX))
    expect(created.map((n) => n.title)).toEqual([title])

    await page.goto(`/#/note/${created[0].id}`)
    const frame = page.frameLocator(`iframe[title="Original page: ${title}"]`)
    await expect(frame.locator('li')).toHaveText(['images', 'containers'])
    await expect(frame.locator('body')).toContainText('Markup <b>stays</b> text & more.')
    await expect(frame.locator('b')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})

test.describe('Export a note as PDF', () => {
  test('Export PDF opens the isolated print view in a new tab, which prints', async ({ page, request }) => {
    // A second tab with its own sandboxed page: slow on a loaded machine.
    test.slow()
    await deleteQcNotes(request)
    const title = `${NOTE_PREFIX} Print probe`
    // The page's script tries to read the app's storage and call the app's API as the user.
    const html = `<!doctype html><html><head><title>${title}</title></head><body>
<h1>${title}</h1><p id="storage">pending</p><p id="api">pending</p>
<script>
try { localStorage.getItem('x'); document.getElementById('storage').textContent = 'storage readable'; }
catch (e) { document.getElementById('storage').textContent = 'storage blocked'; }
fetch('/api/notes').then(function (r) { return r.text(); })
  .then(function () { document.getElementById('api').textContent = 'api readable'; })
  .catch(function () { document.getElementById('api').textContent = 'api blocked'; });
</script></body></html>`
    const imported = await request.post(`${API}/notes/import`, {
      headers: H,
      multipart: { files: { name: 'print-probe.html', mimeType: 'text/html', buffer: Buffer.from(html) } },
    })
    expect(imported.ok(), await imported.text()).toBeTruthy()
    const outcome = (await imported.json()) as { results: Array<{ note: { id: string } | null }> }
    const id = outcome.results[0].note!.id

    // The print view's headers: isolated (no same-origin), only the print dialog added.
    const view = await request.get(`${API}/notes/${id}/print`)
    expect(view.status()).toBe(200)
    expect(view.headers()['content-security-policy']).toBe('sandbox allow-scripts allow-modals')
    expect(await view.text()).toContain('print()')

    await page.context().addInitScript(`
      window.print = function () { document.documentElement.setAttribute('data-printed', 'yes'); };
    `)
    await page.goto(`/#/note/${id}`)
    const note = page.getByRole('article', { name: `Note: ${title}` })
    const link = note.getByRole('link', { name: 'Export PDF' })
    await expect(link).toHaveAttribute('href', `/api/notes/${id}/print`)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')

    const [tab] = await Promise.all([page.context().waitForEvent('page'), link.click()])
    await tab.waitForLoadState()
    expect(tab.url()).toContain(`/api/notes/${id}/print`)
    await expect(tab.locator('h1')).toHaveText(title)
    await expect(tab.locator('html')).toHaveAttribute('data-printed', 'yes')
    await expect(tab.locator('#storage')).toHaveText('storage blocked')
    await expect(tab.locator('#api')).toHaveText('api blocked')
    expect(await tab.evaluate('window.opener')).toBeNull()
    await tab.close()
  })
})
