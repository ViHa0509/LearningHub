/**
 * End-to-end checks for the Service unavailable page (spec: learning-views, "Service unavailable page").
 * Outages are simulated in the browser with page.route; the real e2e backend stays up.
 */
import { expect, test, type Page, type Route } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const LESSON = '/#/lesson/devops/helm'

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

/** Every API request fails as if the backend were not running. */
async function backendDown(page: Page) {
  await page.route('**/api/**', (route: Route) => route.abort('connectionrefused'))
}

/** The backend answers, but its database does not. */
async function databaseDown(page: Page) {
  await page.route('**/api/**', (route: Route) => {
    if (new URL(route.request().url()).pathname === '/api/health') {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'unavailable', reason: 'database' }),
      })
    }
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"db"}' })
  })
}

function outage(page: Page) {
  return page.getByRole('main', { name: 'Service unavailable' })
}

function isHealth(url: string) {
  return new URL(url).pathname === '/api/health'
}

test('backend down: the Service unavailable page names the server, with no retry controls', async ({ page }) => {
  await backendDown(page)
  await page.goto(LESSON)
  const screen = outage(page)
  await expect(screen).toBeVisible()
  await expect(screen.getByRole('heading', { name: 'Service unavailable' })).toBeVisible()
  await expect(screen.getByText("Learning Hub can't reach its server.")).toBeVisible()
  await expect(screen.getByText('This page reconnects on its own.')).toBeVisible()
  await expect(screen.getByText(/^Last checked \d{2}:\d{2}:\d{2}$/)).toBeVisible()
  // No retry controls: no button, no countdown.
  await expect(screen.getByRole('button')).toHaveCount(0)
  await expect(screen.getByRole('status')).toHaveCount(0)
  await expect(page.getByText(/Retrying|Try again/)).toHaveCount(0)
  await expect(page.getByText(/Is the backend running\?/)).toHaveCount(0)
  // The panels are hidden, not shown next to the outage page.
  await expect(page.getByRole('article', { name: 'Lesson: Helm' })).toBeHidden()
  await shot(page, 'service-unavailable-light')

  // The top bar with the theme switch stays usable.
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(screen).toBeVisible()
  await shot(page, 'service-unavailable-dark')
})

test('database down: the page names the database', async ({ page }) => {
  await databaseDown(page)
  await page.goto(LESSON)
  const screen = outage(page)
  await expect(screen).toBeVisible()
  await expect(screen.getByText("Learning Hub can't reach its database.")).toBeVisible()
  await expect(screen.getByText("Learning Hub can't reach its server.")).toHaveCount(0)
  await expect(page.getByText(/Is the backend running\?/)).toHaveCount(0)
})

test('service comes back: the same lesson page returns with its data, without a click or reload', async ({ page }) => {
  const healthTimes: number[] = []
  page.on('request', (r) => {
    if (isHealth(r.url())) healthTimes.push(Date.now())
  })
  await backendDown(page)
  await page.goto(LESSON)
  await expect(outage(page)).toBeVisible()
  await page.evaluate('window.__lhMarker = "still-here"')

  // While down, the app keeps checking in the background (every 5 s).
  const seen = healthTimes.length
  await expect.poll(() => healthTimes.length, { timeout: 8_000 }).toBeGreaterThan(seen)

  await page.unrouteAll({ behavior: 'ignoreErrors' })
  const lesson = page.getByRole('article', { name: 'Lesson: Helm' })
  await expect(lesson).toBeVisible({ timeout: 10_000 })
  await expect(lesson.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(/^DevOps › .*Helm$/)
  await expect(outage(page)).toHaveCount(0)
  await expect(page).toHaveURL(/#\/lesson\/devops\/helm$/)
  expect(await page.evaluate('window.__lhMarker')).toBe('still-here')
})

test('one failing request while the service is healthy does not show the outage page', async ({ page }) => {
  let failed = 0
  await page.route('**/api/lessons/devops/helm', (route: Route) => {
    if (route.request().method() === 'GET' && failed === 0) {
      failed += 1
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' })
    }
    return route.fallback()
  })
  // Start healthy on the home page, so the start-up health check is finished.
  const startup = page.waitForResponse((r) => isHealth(r.url()))
  await page.goto('/')
  expect((await startup).status()).toBe(200)
  await expect(page.getByRole('region', { name: 'Home' })).toBeVisible()

  // The lesson request answers 500 once; the app checks its health at once, and the check passes.
  const healthAfterFailure = page.waitForResponse((r) => isHealth(r.url()) && failed > 0, { timeout: 5_000 })
  await page.goto(LESSON)
  expect((await healthAfterFailure).status()).toBe(200)
  await page.waitForTimeout(1_000)
  await expect(outage(page)).toHaveCount(0)
  await expect(page.getByRole('article', { name: 'Lesson: Helm' })).toBeVisible()
  expect(failed).toBe(1)
})
