/**
 * End-to-end UI checks: real browser (Edge), real backend, empty e2e database.
 * Specs: home-page, lesson-pages, learning-views. Each page is also saved as a
 * screenshot under e2e-results/screens/ for the UI QC agent to inspect.
 */
import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'

test.describe.configure({ mode: 'serial' })

const FIXTURE = resolve(import.meta.dirname, 'fixtures/redis-eviction.html')

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

/** Fail on any uncaught page error or console error (failed requests included). */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

test('home page shows a card per role with progress', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const home = page.getByRole('region', { name: 'Home' })
  const cards = home.getByRole('link')
  await expect(cards).toHaveCount(6)
  await expect(cards.locator('h2')).toHaveText(['Frontend', 'Backend', 'DevOps', 'QA', 'Data Engineer', 'AI Engineer'])
  await expect(home.getByRole('link', { name: /^Backend/ })).toContainText('0 / 25 topics')
  await expect(page.getByText('Nothing learned yet')).toBeVisible()
  await shot(page, 'home-light')
  expect(errors).toEqual([])
})

test('roadmap node opens a lesson that can be written and survives a reload', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.getByRole('link', { name: /^Backend/ }).click()
  await expect(page).toHaveURL(/#\/roadmap\/backend$/)
  await expect(page.getByTestId('node-backend/caching')).toBeVisible()
  await shot(page, 'roadmap-backend')

  await page.getByTestId('node-backend/caching').click()
  await expect(page).toHaveURL(/#\/lesson\/backend\/caching$/)
  const lesson = page.getByRole('article', { name: 'Lesson: Caching' })
  await expect(lesson.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Backend › Caching')
  await expect(lesson.getByRole('region', { name: 'Subtopics' }).getByRole('link', { name: 'Redis' })).toBeVisible()
  await expect(lesson.getByText(/No lesson yet/)).toBeVisible()
  await shot(page, 'lesson-empty')

  await lesson.getByRole('button', { name: 'Write lesson' }).click()
  await lesson
    .getByRole('textbox', { name: 'Lesson text (Markdown)' })
    .fill('## Cache-aside\n\nRead the cache, fall back to the **database**, then fill the cache.\n\n- TTL\n- Eviction')
  await lesson.getByRole('button', { name: 'Save lesson' }).click()
  await expect(lesson.getByTestId('lesson-body').locator('h2')).toHaveText('Cache-aside')

  await page.reload()
  await expect(page.getByTestId('lesson-body').locator('strong')).toHaveText('database')
  await shot(page, 'lesson-written')

  await page.goBack()
  await expect(page).toHaveURL(/#\/roadmap\/backend$/)
  expect(errors).toEqual([])
})

test('imported note opens from the list in a sandbox', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Import HTML files' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import HTML files' })
  await dialog.getByLabel('HTML files').setInputFiles(FIXTURE)
  await dialog.getByRole('combobox', { name: 'Roadmap node for redis-eviction.html' }).selectOption('backend/redis')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()

  const list = page.getByRole('complementary', { name: 'Learned items' })
  await list.getByRole('button', { name: 'Redis eviction policies', exact: true }).click()
  await expect(page).toHaveURL(/#\/note\//)
  const note = page.getByRole('article', { name: 'Note: Redis eviction policies' })
  await expect(note.getByRole('textbox', { name: 'Note title' })).toHaveValue('Redis eviction policies')
  await expect(list.getByRole('button', { name: 'Open Redis eviction policies' })).toHaveCount(0)

  const frame = page.frameLocator('iframe[title="Original page: Redis eviction policies"]')
  await expect(frame.locator('#js-check')).toHaveText('Scripts ran inside the sandbox.')
  await expect(page.locator('iframe.original')).toHaveAttribute('sandbox', 'allow-scripts')
  await shot(page, 'note-open')

  await page.goto('/')
  await expect(page.getByRole('link', { name: /^Backend/ })).toContainText('1 / 25 topics')
  expect(errors).toEqual([])
})

test('dark theme applies at once and is remembered', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const background = await page.evaluate('getComputedStyle(document.body).backgroundColor')
  expect(background).toBe('rgb(15, 15, 18)')
  await shot(page, 'home-dark')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.goto('/#/lesson/backend/caching')
  await expect(page.getByTestId('lesson-body')).toBeVisible()
  await shot(page, 'lesson-dark')
  await page.goto('/#/roadmap/devops')
  await expect(page.getByTestId('node-devops/ci-cd')).toBeVisible()
  await shot(page, 'roadmap-dark')

  await page.getByRole('radio', { name: 'System' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
  expect(errors).toEqual([])
})

test('lesson pages keep the same width whatever their content', async ({ page, request }) => {
  // A one-word lesson once shrank the page to a narrow column, unlike a node without a lesson.
  const saved = await request.put('http://127.0.0.1:8001/api/lessons/devops/helm', {
    headers: { 'X-LearningHub': '1' },
    data: { body: 'Test' },
  })
  expect(saved.ok()).toBe(true)
  const widths: Record<string, number> = {}
  for (const [path, title] of [
    ['devops/helm', 'Helm'],
    ['devops/docker', 'Docker'],
    ['backend/not-a-node', null],
  ] as const) {
    await page.goto(`/#/lesson/${path}`)
    const region = title
      ? page.getByRole('article', { name: `Lesson: ${title}` })
      : page.getByRole('region', { name: 'Lesson not found' })
    await expect(region).toBeVisible()
    widths[path] = (await region.boundingBox())!.width
  }
  const center = (await page.getByRole('main', { name: 'Content' }).boundingBox())!.width
  for (const width of Object.values(widths)) {
    expect(Math.round(width)).toBe(Math.round(Math.min(center, 860)))
  }
  await page.goto('/#/lesson/devops/helm')
  await expect(page.getByRole('article', { name: 'Lesson: Helm' })).toBeVisible()
  await shot(page, 'lesson-short')
})

test('unknown lesson shows a way back', async ({ page }) => {
  await page.goto('/#/lesson/backend/not-a-node')
  const missing = page.getByRole('region', { name: 'Lesson not found' })
  await expect(missing.getByRole('link', { name: 'Back to the Backend roadmap' })).toBeVisible()
  await shot(page, 'lesson-not-found')
})

test('agent panel explains how to configure a provider', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#/lesson/backend/graphql')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  await expect(agent.getByRole('status')).toContainText('No AI provider is configured.')
  await expect(agent.getByRole('link', { name: 'Open settings' })).toBeVisible()
  await expect(agent.getByRole('textbox', { name: 'Message the agent' })).toHaveCount(0)
  const lesson = page.getByRole('article', { name: 'Lesson: GraphQL' })
  await expect(lesson.getByText(/No lesson yet/)).toBeVisible()
  await expect(lesson.getByRole('button', { name: 'Draft with agent' })).toHaveCount(0)
  await shot(page, 'agent-not-configured')
  expect(errors).toEqual([])
})

test('a provider added in Settings enables the chat without a restart', async ({ page, request }) => {
  const errors = watchErrors(page)
  // With no provider configured the chat is refused with a conflict that points to Settings.
  const refused = await request.post('http://127.0.0.1:8001/api/agent/chat', {
    headers: { 'X-LearningHub': '1' },
    data: { agent_id: 'assistant', messages: [{ role: 'user', content: 'hi' }] },
  })
  expect(refused.status()).toBe(409)

  await page.goto('/')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  await agent.getByRole('link', { name: 'Open settings' }).click()
  await expect(page).toHaveURL(/#\/settings$/)
  await expect(page.getByText('No providers yet.')).toBeVisible()

  await page.getByRole('link', { name: 'Add provider' }).click()
  const form = page.getByRole('region', { name: 'Provider configuration' })
  await form.getByRole('radio', { name: 'Local', exact: true }).check({ force: true })
  await form.getByLabel('Name', { exact: true }).fill('E2E first provider')
  await form.getByLabel('Model', { exact: true }).fill('fake-ok')
  await form.getByLabel('Base URL').fill('http://127.0.0.1:8002/v1')
  await form.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page).toHaveURL(/#\/settings\/providers\/[0-9a-f-]+$/)
  await expect(agent.getByRole('textbox', { name: 'Message the agent' })).toBeVisible()
  await shot(page, 'settings-saved')

  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Agent' }).getByRole('combobox', { name: 'Provider' })).toContainText(
    'Agent default (E2E first provider',
  )
  // Remove it again (through the API) so the later files start without a provider.
  await page.goto('/#/settings')
  const list = await (await request.get('http://127.0.0.1:8001/api/ai-providers')).json()
  for (const p of list) await request.delete(`http://127.0.0.1:8001/api/ai-providers/${p.id}`, { headers: { 'X-LearningHub': '1' } })
  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Agent' }).getByRole('status')).toContainText(
    'No AI provider is configured.',
  )
  expect(errors).toEqual([])
})
