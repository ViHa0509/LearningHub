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
  await expect(cards).toHaveCount(5)
  await expect(cards.locator('h2')).toHaveText(['Frontend', 'Backend', 'DevOps', 'QA', 'Data Engineer'])
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
  await list.getByRole('button', { name: 'Redis eviction policies' }).click()
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
  expect(background).toBe('rgb(22, 22, 21)')
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
  await expect(agent.getByText('LH_ANTHROPIC_API_KEY')).toBeVisible()
  await expect(agent.getByRole('textbox', { name: 'Message the agent' })).toHaveCount(0)
  const lesson = page.getByRole('article', { name: 'Lesson: GraphQL' })
  await expect(lesson.getByText(/No lesson yet/)).toBeVisible()
  await expect(lesson.getByRole('button', { name: 'Draft with agent' })).toHaveCount(0)
  await shot(page, 'agent-not-configured')
  expect(errors).toEqual([])
})

test('a key pasted in Settings enables the chat without a restart', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  await agent.getByRole('link', { name: 'Open settings' }).click()
  await expect(page).toHaveURL(/#\/settings$/)

  const anthropic = page.getByRole('article', { name: 'Anthropic (Claude)' })
  await expect(anthropic.getByRole('status')).toHaveText('Not configured')
  // A dummy key: saving makes no provider call, and the test never presses "Test".
  await anthropic.getByLabel('API key').fill('sk-ant-e2e-dummy-key-7777')
  await anthropic.getByRole('button', { name: 'Save' }).click()
  await expect(anthropic.getByRole('status')).toHaveText('Saved in app · key …7777')
  await expect(agent.getByRole('textbox', { name: 'Message the agent' })).toBeVisible()
  await shot(page, 'settings-saved')

  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Agent' }).getByRole('combobox', { name: 'Provider' })).toHaveValue(
    'anthropic',
  )
  await page.getByRole('article', { name: 'Anthropic (Claude)' }).getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByRole('article', { name: 'Anthropic (Claude)' }).getByRole('status')).toHaveText('Not configured')
  await expect(page.getByRole('complementary', { name: 'Agent' }).getByRole('status')).toContainText(
    'No AI provider is configured.',
  )
  expect(errors).toEqual([])
})
