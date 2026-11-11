/**
 * Spec checks for the change magic-ui (openspec/changes/magic-ui/specs/visual-polish): the
 * decorative Magic UI layers stay out of the way (hidden from assistive tech, no pointer events),
 * everything stops under reduced motion (counts show their final value at once, no `mu-` element
 * animates), the agent shows "Thinking…" while an answer is pending, and screenshots of login,
 * home, news and the thinking row in light and dark for review.
 *
 * News items are synthetic browser-side answers (page.route), as in news.e2e.ts: the e2e
 * backend never reads a real feed. The pending answer uses the fake-slow model (5 seconds).
 */
import { expect, test, type Page, type Route } from '@playwright/test'
import { OWNER } from '../playwright.config.ts'

// Signed-out browsers and a 5-second pending answer: slow under the full suite's load.
test.describe.configure({ mode: 'serial', timeout: 60_000 })

const FAKE_LLM = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const MU = "[class^='mu-'], [class*=' mu-']"

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

/** Light then dark screenshots of the page as it is now (the app follows the system theme). */
async function shotBoth(page: Page, name: string) {
  await page.emulateMedia({ colorScheme: 'light' })
  await shot(page, `${name}-light`)
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, `${name}-dark`)
  await page.emulateMedia({ colorScheme: 'light' })
}

/** The computed animation-name of every `mu-` element on the page. */
function muAnimations(page: Page): Promise<Array<{ cls: string; name: string }>> {
  return page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(MU)})).map((el) => ({
    cls: el.getAttribute('class'),
    name: getComputedStyle(el).animationName,
  }))`)
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

/** The learned list has loaded (it waits for the notes and every roadmap), so screenshots show the page at rest. */
async function learnedLoaded(page: Page) {
  const list = page.getByRole('complementary', { name: 'Learned items' })
  await expect(list.getByText('Loading your notes…')).toHaveCount(0, { timeout: 20_000 })
}

async function fakeNews(page: Page) {
  const now = Date.now()
  const sources = [
    { id: 'qc-lab', name: 'QC Lab News', homepage: 'https://lab.example.test/' },
    { id: 'qc-research', name: 'QC Research Blog', homepage: 'https://research.example.test/' },
    { id: 'qc-weekly', name: 'QC Weekly Digest', homepage: 'https://weekly.example.test/' },
  ]
  const items = Array.from({ length: 6 }, (_, n) => {
    const s = sources[n % sources.length]
    return {
      id: `00000000-0000-4000-8000-${String(n + 100).padStart(12, '0')}`,
      source: s.id,
      source_name: s.name,
      title: `Visual polish item ${n + 1}: models, robots and benchmarks`,
      url: `${s.homepage}posts/${n}`,
      published_at: new Date(now - n * 3_600_000).toISOString(),
      summary: 'A short synthetic summary for the screenshot review.',
    }
  })
  await page.route(
    (url) => url.pathname.startsWith('/api/news'),
    async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/news/refresh') {
        return route.fulfill({ json: { state: 'idle', started_at: null, finished_at: null, error: null, sources: [] } })
      }
      return route.fulfill({
        json: {
          items,
          sources: sources.map((s) => ({
            ...s,
            count: items.filter((i) => i.source === s.id).length,
            last_ok: true,
            last_error: null,
            last_fetched_at: new Date(now).toISOString(),
          })),
          last_refresh_at: new Date(now - 12 * 60_000).toISOString(),
          stale: false,
        },
      })
    },
  )
  return items
}

test.describe('Signed out', () => {
  test.use({ storageState: SIGNED_OUT })

  test('login page: decorative background hidden from assistive tech; "Log in" keeps its name and works by keyboard', async ({
    page,
  }) => {
    const errors = watchErrors(page)
    await page.goto('/#/')
    const main = page.getByRole('main', { name: 'Log in' })
    await expect(main.getByRole('heading', { name: 'Log in' })).toBeVisible()
    const background = main.locator('svg[aria-hidden="true"]').first()
    await expect(background).toBeVisible()
    await expect(background).toHaveCSS('pointer-events', 'none')
    // Animated (no reduced motion): the glow runs on the background.
    expect(await background.getAttribute('class')).toContain('mu-glow')
    await shotBoth(page, 'visual-login')

    // The button keeps its accessible name and submits by keyboard.
    const button = main.getByRole('button', { name: 'Log in', exact: true })
    await expect(button).toBeEnabled()
    await main.getByLabel('Email', { exact: true }).fill(OWNER.email)
    await main.getByLabel('Password', { exact: true }).fill(OWNER.password)
    await main.getByLabel('Password', { exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(button).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: `Account menu: ${OWNER.name}` })).toBeVisible({ timeout: 15_000 })
    expect(errors).toEqual([])
  })

  test('login page under reduced motion: the background is static and no mu- element animates', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/')
    const main = page.getByRole('main', { name: 'Log in' })
    await expect(main.getByRole('button', { name: 'Log in', exact: true })).toBeVisible()
    expect(await main.locator('svg[aria-hidden="true"]').first().getAttribute('class')).not.toContain('mu-glow')
    for (const el of await muAnimations(page)) expect(el, el.cls).toMatchObject({ name: 'none' })
  })
})

test('home under reduced motion: counts show their final value at once and no element animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const home = page.getByRole('region', { name: 'Home' })
  await expect(home.getByRole('link', { name: /^Backend/ })).toBeVisible()
  const tickers = home.locator('.mu-ticker')
  await expect(tickers.first()).toBeVisible()
  // Read at once: every count already shows the number its label holds.
  const counts: Array<{ text: string; label: string }> = await page.evaluate(
    `Array.from(document.querySelectorAll('.mu-ticker')).map((el) => ({ text: el.textContent, label: el.getAttribute('aria-label') }))`,
  )
  expect(counts.length).toBeGreaterThan(0)
  for (const c of counts) expect(c.text).toBe(c.label)
  const animations = await muAnimations(page)
  expect(animations.length).toBeGreaterThan(0)
  for (const el of animations) expect(el, el.cls).toMatchObject({ name: 'none' })

  // Hovering a card shows the border beam, which does not animate either.
  await home.getByRole('link', { name: /^Backend/ }).hover()
  for (const el of await muAnimations(page)) expect(el, el.cls).toMatchObject({ name: 'none' })
})

test('home and news screenshots in light and dark; the counts reach their final value', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const home = page.getByRole('region', { name: 'Home' })
  const ticker = home.locator('.mu-ticker').first()
  await expect(ticker).toBeVisible()
  const label = await ticker.getAttribute('aria-label')
  await expect(ticker).toHaveText(label!, { timeout: 10_000 })
  await learnedLoaded(page)
  await page.waitForLoadState('networkidle')
  await shotBoth(page, 'visual-home')

  const items = await fakeNews(page)
  await page.goto('/#/news')
  await expect(page.getByText(items[0].title)).toBeVisible()
  await expect(page.getByText(items[5].title)).toBeVisible()
  // Let the items finish fading in before the screenshots.
  await page.waitForTimeout(1_000)
  await shotBoth(page, 'visual-news')
  expect(errors).toEqual([])
})

test('the agent shows "Thinking…" with a shimmer while the answer is pending', async ({ page, request }) => {
  const created = await request.post('/api/ai-providers', {
    headers: H,
    data: { name: `Slow ${Date.now().toString(36)}`, provider_type: 'local', model_name: 'fake-slow', base_url: FAKE_LLM, config: {} },
  })
  expect(created.status(), await created.text()).toBe(201)
  const id = (await created.json()).id as string
  try {
    const assigned = await request.put('/api/agents/assistant/provider', {
      headers: H,
      data: { primary_provider_id: id, fallback_provider_id: null },
    })
    expect(assigned.status(), await assigned.text()).toBe(200)

    await page.goto('/')
    await learnedLoaded(page)
    await page.waitForLoadState('networkidle')
    const agent = page.getByRole('complementary', { name: 'Agent' })
    const box = agent.getByRole('textbox', { name: 'Message the agent' })
    await box.fill('Take your time')
    await box.press('Enter')
    const log = agent.getByRole('log', { name: 'Conversation' })
    const thinking = log.getByRole('status')
    await expect(thinking).toHaveText('Thinking…')
    await expect(thinking.locator('.mu-shiny')).toBeVisible()
    await expect(thinking.locator('.mu-shiny')).not.toHaveCSS('animation-name', 'none')
    await shotBoth(page, 'visual-agent-thinking')

    await expect(log.getByText('OK from fake')).toBeVisible({ timeout: 20_000 })
    await expect(log.getByRole('status')).toHaveCount(0)
  } finally {
    await request.put('/api/agents/assistant/provider', {
      headers: H,
      data: { primary_provider_id: null, fallback_provider_id: null },
    })
    await request.delete(`/api/ai-providers/${id}`, { headers: H })
  }
})
