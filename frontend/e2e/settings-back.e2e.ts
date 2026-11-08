/**
 * End-to-end checks for the settings-back-link change (spec: learning-views, "Back from Settings").
 * The provider used here points at the fake LLM (port 8002) and is removed afterwards.
 */
import { expect, test, type Page } from '@playwright/test'

const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }

let providerId: string | null = null

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

test.afterEach(async ({ request }) => {
  if (providerId) await request.delete(`${API}/api/ai-providers/${providerId}`, { headers: H })
  providerId = null
})

test('Back to the lesson after opening Settings and a provider page', async ({ page, request }) => {
  const name = `Back link ${Date.now().toString(36)}`
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  providerId = (await res.json()).id

  await page.goto('/#/lesson/devops/helm')
  await expect(page.getByRole('article', { name: 'Lesson: Helm' })).toBeVisible()

  await page.getByRole('navigation', { name: 'App' }).getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/#\/settings$/)
  const settings = page.getByRole('region', { name: 'Settings' })
  await expect(settings.getByRole('link', { name: '← Back', exact: true })).toBeVisible()
  await shot(page, 'settings-back-link')

  // Open the provider page, then return to Settings with its own back link.
  await settings.getByRole('article', { name }).getByRole('link', { name }).click()
  await expect(page).toHaveURL(new RegExp(`#/settings/providers/${providerId}$`))
  const form = page.getByRole('region', { name: 'Provider configuration' })
  await expect(form.getByRole('heading', { level: 1, name })).toBeVisible()
  await form.getByRole('link', { name: '← Back to providers' }).click()
  await expect(page).toHaveURL(/#\/settings$/)

  // Back skips the provider page and Settings itself: the lesson is shown again.
  await page.getByRole('region', { name: 'Settings' }).getByRole('link', { name: '← Back', exact: true }).click()
  await expect(page).toHaveURL(/#\/lesson\/devops\/helm$/)
  await expect(page.getByRole('article', { name: 'Lesson: Helm' })).toBeVisible()
})

test('Settings opened directly: Back leads to the home page', async ({ page }) => {
  await page.goto('/#/settings')
  const back = page.getByRole('region', { name: 'Settings' }).getByRole('link', { name: '← Back', exact: true })
  await expect(back).toBeVisible()
  await back.click()
  await expect(page.getByRole('region', { name: 'Home' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Settings' })).toHaveCount(0)
})
