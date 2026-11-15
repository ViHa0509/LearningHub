/**
 * Spec checks for the change map-lesson-markers (learning-views): a roadmap node with a lesson
 * shows a "Has a lesson" mark next to the note badge, and the mark follows saving and clearing
 * a lesson from the lesson page. Data goes through the API; lessons are cleared afterwards.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial', timeout: 90_000 })

const API = 'http://127.0.0.1:8001/api'
const H = { 'X-LearningHub': '1' }
const PREFIX = 'QC-lessonmark'
const STAMP = Date.now().toString(36)
const NODES = ['backend/auth', 'backend/caching', 'backend/testing']

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

async function putLesson(request: APIRequestContext, node: string, body: string) {
  const res = await request.put(`${API}/lessons/${node}`, { headers: H, data: { body, source: 'user' } })
  expect(res.ok(), await res.text()).toBeTruthy()
}

async function createNote(request: APIRequestContext, tag: string, node: string) {
  const title = `${PREFIX} ${tag} ${STAMP}`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1></body></html>`
  const res = await request.post(`${API}/notes/import`, {
    headers: H,
    multipart: { files: { name: `${title.replace(/ /g, '_')}.html`, mimeType: 'text/html', buffer: Buffer.from(html) } },
  })
  expect(res.ok()).toBeTruthy()
  const note = (await res.json()).results[0].note
  const linked = await request.patch(`${API}/notes/${note.id}`, { headers: H, data: { node_id: node } })
  expect(linked.ok()).toBeTruthy()
}

async function cleanup(request: APIRequestContext) {
  for (const node of NODES) await putLesson(request, node, '')
  for (const archived of ['false', 'true']) {
    const res = await request.get(`${API}/notes?archived=${archived}`)
    if (!res.ok()) continue
    for (const n of (await res.json()) as Array<{ id: string; title: string }>) {
      if (n.title.startsWith(PREFIX)) await request.delete(`${API}/notes/${n.id}`, { headers: H })
    }
  }
}

test.beforeEach(async ({ request }) => cleanup(request))
test.afterEach(async ({ request }) => cleanup(request))

const MARK = 'Has a lesson'

test('Node with a lesson: the node has the mark and class, a node without one has neither', async ({ page, request }) => {
  await putLesson(request, 'backend/auth', 'Tokens and sessions, in my words.')
  const counts = await (await request.get(`${API}/domains/backend/counts`)).json()
  expect(counts.lessons).toContain('auth')
  expect(counts.lessons).not.toContain('graphql')

  await page.goto('/#/roadmap/backend')
  const node = page.getByTestId('node-backend/auth')
  await expect(node).toHaveClass(/has-lesson/)
  await expect(node.getByRole('img', { name: MARK })).toBeVisible()
  const plain = page.getByTestId('node-backend/graphql')
  await expect(plain).toBeVisible()
  await expect(plain).not.toHaveClass(/has-lesson/)
  await expect(plain.getByRole('img', { name: MARK })).toHaveCount(0)

  await page.emulateMedia({ colorScheme: 'light' })
  await shot(page, 'map-lesson-mark')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(node.getByRole('img', { name: MARK })).toBeVisible()
  await shot(page, 'map-lesson-mark-dark')
  await page.emulateMedia({ colorScheme: 'light' })
})

test('Notes and a lesson on one node: the notes badge and the lesson mark both show', async ({ page, request }) => {
  await createNote(request, 'one', 'backend/caching')
  await createNote(request, 'two', 'backend/caching')
  await putLesson(request, 'backend/caching', 'Caching notes.')

  await page.goto('/#/roadmap/backend')
  const node = page.getByTestId('node-backend/caching')
  await expect(node).toHaveClass(/has-lesson/)
  await expect(node.getByLabel('2 notes')).toBeVisible()
  await expect(node.getByRole('img', { name: MARK })).toBeVisible()
})

test('Lesson mark follows the lesson: saving shows it, clearing removes it, without a reload', async ({ page }) => {
  await page.goto('/#/roadmap/backend')
  const node = page.getByTestId('node-backend/testing')
  await expect(node).toBeVisible()
  await expect(node.getByRole('img', { name: MARK })).toHaveCount(0)

  await page.goto('/#/lesson/backend/testing')
  const lesson = page.getByRole('article', { name: /^Lesson:/ })
  await lesson.getByRole('button', { name: 'Write lesson' }).click()
  await lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' }).fill('Unit tests first.')
  await lesson.getByRole('button', { name: 'Save lesson' }).click()
  await expect(lesson.getByTestId('lesson-body')).toHaveText('Unit tests first.')

  // In-app navigation (no reload): the map shows the mark.
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: /backend/i }).first().click()
  await expect(page).toHaveURL(/#\/roadmap\/backend/)
  await expect(page.getByTestId('node-backend/testing')).toHaveClass(/has-lesson/)
  await expect(page.getByTestId('node-backend/testing').getByRole('img', { name: MARK })).toBeVisible()

  // Clear the lesson from its page: the mark is gone on the map.
  await page.goto('/#/lesson/backend/testing')
  await lesson.getByRole('button', { name: 'Edit lesson' }).click()
  await lesson.getByRole('textbox', { name: 'Lesson text (Markdown)' }).fill('')
  await lesson.getByRole('button', { name: 'Save lesson' }).click()
  await expect(lesson.getByText(/No lesson yet/)).toBeVisible()
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: /backend/i }).first().click()
  await expect(page).toHaveURL(/#\/roadmap\/backend/)
  const after = page.getByTestId('node-backend/testing')
  await expect(after).toBeVisible()
  await expect(after).not.toHaveClass(/has-lesson/)
  await expect(after.getByRole('img', { name: MARK })).toHaveCount(0)
})
