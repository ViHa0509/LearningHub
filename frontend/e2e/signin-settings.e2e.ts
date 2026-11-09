/**
 * End-to-end checks for Settings > Sign-in (spec: openspec/changes/sign-in-setup-and-sync/specs/auth,
 * "Set up GitHub and Google sign-in in the app"). Black box: the browser and the public API.
 *
 * The e2e backend sets GitHub through the environment (the fake provider) and leaves Google
 * unconfigured. Google is set in the app here with fake values (never used to sign in: the
 * real Google is never called) and removed again in afterAll, so other tests see the old state.
 */
import { expect, test, type Browser, type Page } from '@playwright/test'

const API = 'http://127.0.0.1:8001'
const APP = 'http://127.0.0.1:5174'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const GOOGLE_ID = 'e2e-google-client.apps.example.test'
const GOOGLE_SECRET = 'e2e-google-secret-WXYZ9876'

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

/** Whether a signed-out browser's login page offers Google (enabled link) or not. */
async function loginOffersGoogle(browser: Browser): Promise<'enabled' | 'not configured'> {
  const context = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
  try {
    const page = await context.newPage()
    await page.goto('/')
    const login = page.getByRole('main', { name: 'Log in' })
    await expect(login.getByRole('heading', { name: 'Log in' })).toBeVisible({ timeout: 15_000 })
    await expect(login.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible()
    const link = login.getByRole('link', { name: 'Continue with Google' })
    const off = login.getByRole('button', { name: 'Continue with Google' })
    await expect(link.or(off)).toBeVisible()
    if (await link.isVisible()) return 'enabled'
    await expect(off).toBeDisabled()
    return 'not configured'
  } finally {
    await context.close()
  }
}

function card(page: Page, name: 'GitHub' | 'Google') {
  return page.getByRole('article', { name })
}

test.describe('Sign-in settings', () => {
  test.afterAll(async ({ playwright }) => {
    // Remove Google from the app whatever happened, so the login page is as before.
    const { OWNER_STATE } = await import('../playwright.config.ts')
    const ctx = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
    await ctx.delete(`${API}/api/settings/sign-in/google`, { headers: H })
    await ctx.dispose()
  })

  test('the Settings nav reaches Sign-in, which shows the callback URLs and the GitHub source', async ({
    page,
    context,
  }) => {
    await page.goto('/#/settings')
    const nav = page.getByRole('navigation', { name: 'Settings sections' })
    await expect(nav.getByRole('link', { name: 'AI providers' })).toHaveAttribute('aria-current', 'page')
    await nav.getByRole('link', { name: 'Sign-in' }).click()
    await expect(page).toHaveURL(/#\/settings\/sign-in$/)
    await expect(page.getByRole('heading', { name: 'Sign-in', level: 1 })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Sign-in' })).toHaveAttribute('aria-current', 'page')

    // Scenario: Callback URL shown (LH_PUBLIC_URL is the e2e Vite address).
    const github = card(page, 'GitHub')
    const google = card(page, 'Google')
    await expect(github.getByLabel('Callback URL')).toHaveValue('http://127.0.0.1:5174/api/auth/oauth/github/callback')
    await expect(google.getByLabel('Callback URL')).toHaveValue('http://127.0.0.1:5174/api/auth/oauth/google/callback')
    await expect(github.getByText('From the environment')).toBeVisible()
    await expect(google.getByText('Not configured', { exact: true })).toBeVisible()
    // The environment's Client ID shows; its secret only as a hint.
    await expect(github.getByLabel('Client ID')).toHaveValue('e2e-github-client')
    await expect(github.getByLabel('Client secret')).toHaveValue('')
    await expect(github.getByLabel('Client secret')).toHaveAttribute('placeholder', 'Saved: …cret')
    // Links to where the OAuth apps are created.
    await expect(github.getByRole('link', { name: 'GitHub developer settings' })).toHaveAttribute(
      'href',
      'https://github.com/settings/developers',
    )
    await expect(google.getByRole('link', { name: 'Google Cloud credentials' })).toHaveAttribute(
      'href',
      'https://console.cloud.google.com/apis/credentials',
    )
    // GitHub is set by the environment, so there is nothing to remove in the app.
    await expect(github.getByRole('button', { name: 'Remove' })).toHaveCount(0)

    // Copy puts the callback URL on the clipboard.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP })
    await github.getByRole('button', { name: 'Copy' }).click()
    await expect(github.getByRole('status')).toHaveText('Copied')
    expect(await page.evaluate<string>('navigator.clipboard.readText()')).toBe(
      'http://127.0.0.1:5174/api/auth/oauth/github/callback',
    )
  })

  test('Save stays disabled until a change, and Cancel restores the saved values', async ({ page }) => {
    await page.goto('/#/settings/sign-in')
    const google = card(page, 'Google')
    const save = google.getByRole('button', { name: 'Save' })
    const cancel = google.getByRole('button', { name: 'Cancel' })
    await expect(google.getByLabel('Client ID')).toHaveValue('')
    await expect(save).toBeDisabled()
    await expect(cancel).toBeDisabled()

    await google.getByLabel('Client ID').fill('something-typed')
    await google.getByLabel('Client secret').fill('typed-secret')
    await expect(save).toBeEnabled()
    await cancel.click()
    await expect(google.getByLabel('Client ID')).toHaveValue('')
    await expect(google.getByLabel('Client secret')).toHaveValue('')
    await expect(save).toBeDisabled()

    // Escape cancels too.
    await google.getByLabel('Client ID').fill('typed-again')
    await google.getByLabel('Client ID').press('Escape')
    await expect(google.getByLabel('Client ID')).toHaveValue('')

    // On GitHub (set by the environment) Cancel brings the environment's Client ID back.
    const github = card(page, 'GitHub')
    await github.getByLabel('Client ID').fill('changed-github-id')
    await expect(github.getByRole('button', { name: 'Save' })).toBeEnabled()
    await github.getByRole('button', { name: 'Cancel' }).click()
    await expect(github.getByLabel('Client ID')).toHaveValue('e2e-github-client')
    await expect(github.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('Google set in the app: secret only as a hint, and the login page offers Google at once', async ({
    page,
    request,
    browser,
  }) => {
    expect(await loginOffersGoogle(browser)).toBe('not configured')

    await page.goto('/#/settings/sign-in')
    const google = card(page, 'Google')
    await google.getByLabel('Client ID').fill(GOOGLE_ID)
    await google.getByLabel('Client secret').fill(GOOGLE_SECRET)
    await google.getByRole('button', { name: 'Save' }).click()
    await expect(google.getByText('Set in the app')).toBeVisible()
    await expect(google.getByText('Saved.')).toBeVisible()
    await expect(google.getByLabel('Client ID')).toHaveValue(GOOGLE_ID)
    await expect(google.getByLabel('Client secret')).toHaveValue('')
    await expect(google.getByLabel('Client secret')).toHaveAttribute('placeholder', 'Saved: …9876')
    await expect(google.getByRole('button', { name: 'Save' })).toBeDisabled()
    await expect(google.getByRole('button', { name: 'Remove' })).toBeVisible()
    await shot(page, 'signin-settings')

    // Scenario: Secret never returned.
    const answer = await request.get(`${API}/api/settings/sign-in`)
    expect(answer.status()).toBe(200)
    const text = await answer.text()
    expect(text).not.toContain(GOOGLE_SECRET)
    expect(text).not.toContain('e2e-github-secret')
    const body = JSON.parse(text)
    expect(body.public_url).toBe('http://127.0.0.1:5174')
    expect(body.providers.google).toMatchObject({ client_id: GOOGLE_ID, secret_hint: '…9876', source: 'app' })
    expect(body.providers.github).toMatchObject({ client_id: 'e2e-github-client', source: 'env' })

    // Scenario: Turn on ... sign-in: the login page offers it without a restart.
    expect(await loginOffersGoogle(browser)).toBe('enabled')
    const status = await (await request.get(`${API}/api/auth/status`)).json()
    expect(status.providers.google.configured).toBe(true)

    // Changing only the Client ID keeps the saved secret.
    await google.getByLabel('Client ID').fill(`${GOOGLE_ID}-2`)
    await google.getByRole('button', { name: 'Save' }).click()
    await expect(google.getByText('Saved.')).toBeVisible()
    const kept = await (await request.get(`${API}/api/settings/sign-in`)).json()
    expect(kept.providers.google).toMatchObject({ client_id: `${GOOGLE_ID}-2`, secret_hint: '…9876', source: 'app' })
  })

  test('Remove Google: the login page shows Google as not configured again', async ({ page, request, browser }) => {
    // Google is set in the app (by the previous test, or here when run alone).
    const before = await (await request.get(`${API}/api/settings/sign-in`)).json()
    if (before.providers.google.source !== 'app') {
      const put = await request.put(`${API}/api/settings/sign-in/google`, {
        headers: H,
        data: { client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET },
      })
      expect(put.status(), await put.text()).toBe(200)
    }

    await page.goto('/#/settings/sign-in')
    const google = card(page, 'Google')
    await expect(google.getByText('Set in the app')).toBeVisible()
    page.once('dialog', (dialog) => void dialog.accept())
    await google.getByRole('button', { name: 'Remove' }).click()
    await expect(google.getByText('Not configured', { exact: true })).toBeVisible()
    await expect(google.getByLabel('Client ID')).toHaveValue('')
    await expect(google.getByRole('button', { name: 'Remove' })).toHaveCount(0)
    await expect(google.getByRole('alert')).toHaveCount(0)

    const after = await (await request.get(`${API}/api/settings/sign-in`)).json()
    expect(after.providers.google).toMatchObject({ client_id: null, secret_hint: null, source: null })
    expect(await loginOffersGoogle(browser)).toBe('not configured')
  })

  test('Only the Owner: without a session the sign-in settings answer 401 and nothing changes', async ({
    playwright,
    request,
  }) => {
    const before = await (await request.get(`${API}/api/settings/sign-in`)).json()
    const anon = await playwright.request.newContext({ baseURL: APP, storageState: SIGNED_OUT })
    try {
      expect((await anon.get(`${API}/api/settings/sign-in`)).status()).toBe(401)
      const put = await anon.put(`${API}/api/settings/sign-in/google`, {
        headers: H,
        data: { client_id: 'intruder', client_secret: 'intruder-secret' },
      })
      expect(put.status()).toBe(401)
      expect((await anon.delete(`${API}/api/settings/sign-in/github`, { headers: H })).status()).toBe(401)
    } finally {
      await anon.dispose()
    }
    const now = await (await request.get(`${API}/api/settings/sign-in`)).json()
    expect(now).toEqual(before)
    expect(now.providers.google.client_id).not.toBe('intruder')
    expect(now.providers.github.source).toBe('env')
  })
})
