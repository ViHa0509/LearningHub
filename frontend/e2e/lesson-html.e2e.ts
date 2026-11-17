/**
 * Spec checks for the change lesson-import-html: the lesson page's Import PDF or HTML takes an
 * HTML page, converts it to Markdown in the editor (unsaved until Save), asks before replacing,
 * keeps structure, code and safe links, leaves scripts and styles out and keeps page text literal.
 * The HTML files are written by the tests; no page is stored by the app.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const API = 'http://127.0.0.1:8001/api'
const H = { 'X-LearningHub': '1' }
const NODE = 'devops/kubernetes'
const NODE_TITLE = 'Kubernetes'
const LITERAL = '*not bold* # not a heading'

const KAFKA_HTML = `<!doctype html><html><head><title>Kafka page</title>
<style>.secretstyle { color: red; }</style></head><body>
<nav>Site navigation</nav>
<h1>Kafka</h1>
<p>Kafka is a distributed log.</p>
<ul><li>topics</li><li>partitions</li></ul>
<table><tr><th>Concept</th><th>Meaning</th></tr><tr><td>Broker</td><td>A server</td></tr></table>
<pre>line one
  line two</pre>
<p>Use <code>kafka-topics</code> to list.</p>
<p>${LITERAL}</p>
<p><a href="javascript:alert(1)">evil link</a> and <a href="https://example.com/docs">good link</a></p>
<script>var secretscript = 1;</script>
</body></html>`

async function shot(page: Page, name: string) {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: `e2e-results/screens/${name}-dark.png`, fullPage: true })
  await page.emulateMedia({ colorScheme: 'light' })
}

async function setLesson(request: APIRequestContext, body: string) {
  const res = await request.put(`${API}/lessons/${NODE}`, { headers: H, data: { body, source: 'user' } })
  expect(res.ok(), await res.text()).toBeTruthy()
}

async function lessonBody(request: APIRequestContext): Promise<string> {
  return (await (await request.get(`${API}/lessons/${NODE}`)).json()).body
}

function lessonSection(page: Page) {
  return page.getByRole('article', { name: `Lesson: ${NODE_TITLE}` }).getByRole('region', { name: 'Lesson' })
}

async function importFile(page: Page, name: string, buffer: Buffer, mimeType = 'text/html') {
  await lessonSection(page).getByLabel('PDF or HTML file').setInputFiles({ name, mimeType, buffer })
}

test.beforeEach(async ({ request }) => {
  await setLesson(request, '')
})

test.afterAll(async ({ request }) => {
  await setLesson(request, '')
})

test.describe('Import an HTML page into the lesson editor', () => {
  test('Import an HTML page and save: Markdown in the editor, nothing saved until Save, then rendered safely', async ({
    page,
    request,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`/#/lesson/${NODE}`)
    const lesson = lessonSection(page)
    await expect(lesson.getByRole('button', { name: 'Import PDF or HTML' })).toBeEnabled()
    await importFile(page, 'kafka.html', Buffer.from(KAFKA_HTML))

    const editor = lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' })
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue(/^# Kafka$/m)
    await expect(editor).toHaveValue(/^Kafka is a distributed log\.$/m)
    await expect(editor).toHaveValue(/^- topics$/m)
    await expect(editor).toHaveValue(/^- partitions$/m)
    await expect(editor).toHaveValue(/^\| Concept \| Meaning \|$/m)
    await expect(editor).toHaveValue(/^\| --- \| --- \|$/m)
    await expect(editor).toHaveValue(/^\| Broker \| A server \|$/m)
    // Code and diagrams: a fenced block with the same lines, and a code span.
    await expect(editor).toHaveValue(/^```\nline one\n {2}line two\n```$/m)
    await expect(editor).toHaveValue(/`kafka-topics`/)
    // Script and style are left out; the javascript: link is plain text, the https link stays a link.
    const text = await editor.inputValue()
    expect(text).not.toContain('secretscript')
    expect(text).not.toContain('secretstyle')
    expect(text).not.toContain('javascript:')
    expect(text).toContain('evil link')
    expect(text).toContain('[good link](https://example.com/docs)')
    expect(text).not.toContain('Site navigation')
    // Nothing is saved before Save.
    expect(await lessonBody(request)).toBe('')
    await shot(page, 'lesson-import-html')

    await lesson.getByRole('button', { name: 'Save lesson' }).click()
    const body = lesson.getByTestId('lesson-body')
    await expect(body.locator('h1, h2, h3').first()).toHaveText('Kafka')
    await expect(body.locator('li')).toHaveText(['topics', 'partitions'])
    await expect(body.locator('table')).toHaveCount(1)
    await expect(body.locator('th')).toHaveText(['Concept', 'Meaning'])
    await expect(body.locator('td')).toHaveText(['Broker', 'A server'])
    await expect(body.locator('pre')).toContainText('line one')
    await expect(body.locator('pre')).toContainText('line two')
    await expect(body.locator('code', { hasText: 'kafka-topics' })).toHaveCount(1)
    await expect(body).not.toContainText('secretscript')
    await expect(body).not.toContainText('secretstyle')
    // The javascript: link is plain text; the https link is a link.
    await expect(body).toContainText('evil link')
    await expect(body.getByRole('link', { name: 'evil link' })).toHaveCount(0)
    await expect(body.getByRole('link', { name: 'good link' })).toHaveAttribute('href', 'https://example.com/docs')
    await expect(body.locator('a')).toHaveCount(1)
    // Page text stays text: shown literally, no emphasis, no extra heading.
    const literal = body.locator('p', { hasText: 'not a heading' })
    await expect(literal).toHaveText(LITERAL)
    await expect(literal.locator('em, strong')).toHaveCount(0)
    await expect(body.locator('h1, h2, h3, h4, h5, h6')).toHaveCount(1)
    expect(await lessonBody(request)).toContain('# Kafka')
    expect(errors).toEqual([])
  })

  test('Ask before replacing with an HTML page: declining keeps the text', async ({ page, request }) => {
    await setLesson(request, 'My own notes about pods.')
    await page.goto(`/#/lesson/${NODE}`)
    const lesson = lessonSection(page)
    await expect(lesson.getByTestId('lesson-body')).toHaveText('My own notes about pods.')
    const asked: string[] = []
    page.once('dialog', (dialog) => {
      asked.push(`${dialog.type()}: ${dialog.message()}`)
      void dialog.dismiss()
    })
    await importFile(page, 'kafka.html', Buffer.from(KAFKA_HTML))
    await expect.poll(() => asked).toEqual(['confirm: Replace the lesson text with the text of kafka.html?'])
    await expect(lesson.getByRole('status')).toHaveCount(0)
    await expect(lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' })).toHaveCount(0)
    await expect(lesson.getByTestId('lesson-body')).toHaveText('My own notes about pods.')
    expect(await lessonBody(request)).toBe('My own notes about pods.')
  })

  test('HTML page without text: the app says there is no text to import', async ({ page, request }) => {
    await setLesson(request, 'Kept as it is.')
    await page.goto(`/#/lesson/${NODE}`)
    const lesson = lessonSection(page)
    await expect(lesson.getByTestId('lesson-body')).toHaveText('Kept as it is.')
    page.on('dialog', (dialog) => void dialog.dismiss())
    await importFile(
      page,
      'empty.html',
      Buffer.from('<!doctype html><html><body><script>var a = 1;</script><div></div></body></html>'),
    )
    await expect(lesson.getByRole('status')).toContainText('the page has no text to import')
    await expect(lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' })).toHaveCount(0)
    await expect(lesson.getByTestId('lesson-body')).toHaveText('Kept as it is.')
    expect(await lessonBody(request)).toBe('Kept as it is.')
  })

  test('Undecodable HTML: refused with the reason and the lesson is unchanged', async ({ page, request }) => {
    await setLesson(request, 'Kept as it is.')
    await page.goto(`/#/lesson/${NODE}`)
    const lesson = lessonSection(page)
    await expect(lesson.getByTestId('lesson-body')).toHaveText('Kept as it is.')
    page.on('dialog', (dialog) => void dialog.dismiss())
    await importFile(page, 'broken.html', Buffer.from([0xff, 0xfe, 0x80, 0x81, 0xc3, 0x28, 0xa0, 0xa1]))
    await expect(lesson.getByRole('alert')).toContainText('Could not import broken.html:')
    await expect(lesson.getByRole('alert')).toContainText('not decodable')
    await expect(lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' })).toHaveCount(0)
    expect(await lessonBody(request)).toBe('Kept as it is.')
  })

  test('Import PDF or HTML: a .txt file is refused with the reason', async ({ page, request }) => {
    await setLesson(request, 'Kept as it is.')
    await page.goto(`/#/lesson/${NODE}`)
    const lesson = lessonSection(page)
    await expect(lesson.getByTestId('lesson-body')).toHaveText('Kept as it is.')
    let asked = 0
    page.on('dialog', (dialog) => {
      asked += 1
      void dialog.dismiss()
    })
    await importFile(page, 'notes.txt', Buffer.from('just plain text'), 'text/plain')
    await expect(lesson.getByRole('alert')).toContainText('Could not import notes.txt:')
    await expect(lesson.getByRole('alert')).toContainText('not a')
    await expect(lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' })).toHaveCount(0)
    expect(asked).toBe(0)
    expect(await lessonBody(request)).toBe('Kept as it is.')
  })

  test('Long page: only the first part is imported and the app says so', async ({ page, request }) => {
    test.slow()
    await page.goto(`/#/lesson/${NODE}`)
    const lesson = lessonSection(page)
    const paragraphs = Array.from({ length: 1200 }, (_, n) => `<p>Paragraph ${n} ${'word '.repeat(20)}</p>`).join('\n')
    await importFile(page, 'long.html', Buffer.from(`<!doctype html><html><body>${paragraphs}</body></html>`))
    await expect(lesson.getByRole('status')).toContainText('only the first part was imported')
    const editor = lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' })
    await expect(editor).toHaveValue(/^Paragraph 0 /m)
    expect((await editor.inputValue()).length).toBeLessThanOrEqual(100_000)
    expect(await lessonBody(request)).toBe('')
  })
})
