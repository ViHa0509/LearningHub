/**
 * End-to-end checks for the Owner login (spec: openspec/changes/owner-auth/specs/auth).
 * Black box: the browser, the public API and the outbox folder the e2e backend writes emails to.
 *
 * Every other e2e file runs signed in with the session saved in OWNER_STATE. Tests here that end
 * all sessions (password reset, log out everywhere else) write a fresh Owner session to that file
 * before they finish, so later tests and files stay signed in. Tests that need a signed-out
 * browser start from an empty storage state.
 *
 * The login rate limit (10 attempts a minute per address) is shared by every login of this file,
 * so only a few tests log in with a password; the limit itself is checked in rate-limit.e2e.ts.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type Page,
  type APIRequest,
} from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { OWNER, OWNER_STATE } from '../playwright.config.ts'
import { latestOutboxToken, nextOutboxToken, outboxToken } from './outbox.ts'

const APP = 'http://127.0.0.1:5174'
const FAKE = 'http://127.0.0.1:8002'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const LESSON = '/#/lesson/devops/helm'

const WRONG_LOGIN = 'Wrong email or password'
const OUTBOX_NOTE = 'Email is not configured: the link was written to storage/outbox on the server.'
const USED_LINK = 'This link has expired or was already used.'
const FORGOT_SENT = 'If that email belongs to the owner, a reset link is on its way.'
const MAGIC_SENT = 'If that email belongs to the owner, a sign-in link is on its way.'

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

function loginPage(page: Page) {
  return page.getByRole('main', { name: 'Log in' })
}

function accountButton(page: Page) {
  return page.getByRole('button', { name: `Account menu: ${OWNER.name}` })
}

function login(request: APIRequestContext, email: string, password: string): Promise<APIResponse> {
  return request.post('/api/auth/login', { headers: H, data: { email, password } })
}

/** A request context of its own (own cookies), signed out. */
function freshContext(playwright: { request: APIRequest }): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL: APP, storageState: SIGNED_OUT })
}

/** A browser context of its own, signed out. */
function freshBrowser(browser: Browser) {
  return browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
}

/**
 * Makes the session of `ctx` the shared Owner session: its cookies go into OWNER_STATE, which
 * keeps the browser storage saved there (the app's note that this server needs a login).
 */
async function saveOwnerSession(ctx: APIRequestContext) {
  const saved = JSON.parse(readFileSync(OWNER_STATE, 'utf-8')) as { origins: unknown[] }
  const { cookies } = await ctx.storageState()
  writeFileSync(OWNER_STATE, JSON.stringify({ cookies, origins: saved.origins }, null, 2))
}

/** The fake GitHub reports the Owner's verified email and its usual user id again. */
async function resetFakeGithub(request: APIRequestContext) {
  const answer = await request.post(`${FAKE}/oauth-control`, { data: {} })
  expect(answer.ok()).toBeTruthy()
}

/**
 * Sets the Owner's password to `password` through a reset link (which ends every session) and
 * saves the new session to OWNER_STATE, so the tests after this one stay signed in.
 */
async function resetPasswordAndSaveOwner(playwright: { request: APIRequest }, password: string) {
  const ctx = await freshContext(playwright)
  try {
    const previous = latestOutboxToken('reset')
    const asked = await ctx.post('/api/auth/forgot', { headers: H, data: { email: OWNER.email } })
    expect(asked.status(), await asked.text()).toBe(200)
    const token = await nextOutboxToken('reset', previous)
    const reset = await ctx.post('/api/auth/reset', { headers: H, data: { token, password } })
    expect(reset.status(), await reset.text()).toBe(200)
    expect((await ctx.get('/api/auth/me')).status()).toBe(200)
    await saveOwnerSession(ctx)
  } finally {
    await ctx.dispose()
  }
}

test.describe('Signed out', () => {
  test.use({ storageState: SIGNED_OUT })

  test('the login page shows on the same address, the API answers 401, and logging in returns there', async ({
    page,
    request,
  }) => {
    // No session: the data routes answer 401 (spec: "No session").
    expect((await request.get('/api/notes')).status()).toBe(401)
    expect((await request.get('/api/domains')).status()).toBe(401)
    expect((await request.get('/api/auth/me')).status()).toBe(401)
    // Health and the auth status stay public.
    expect((await request.get('/api/health')).status()).toBe(200)
    const status = await (await request.get('/api/auth/status')).json()
    expect(status).toMatchObject({ auth_required: true, has_owner: true, mail: { mode: 'outbox' } })
    expect(status.providers.github.configured).toBe(true)
    expect(status.providers.google.configured).toBe(false)

    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto(LESSON)
    const form = loginPage(page)
    await expect(form.getByRole('heading', { name: 'Log in' })).toBeVisible()
    // The login page takes the app's place on the same address; none of the app shows.
    await expect(page).toHaveURL(/#\/lesson\/devops\/helm$/)
    await expect(page.getByRole('article', { name: 'Lesson: Helm' })).toHaveCount(0)
    await expect(accountButton(page)).toHaveCount(0)
    await expect(form.getByRole('link', { name: 'Forgot password?' })).toBeVisible()
    await expect(form.getByRole('link', { name: 'Email me a sign-in link' })).toBeVisible()
    await shot(page, 'auth-login-light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await shot(page, 'auth-login-dark')
    await page.emulateMedia({ colorScheme: 'light' })

    await form.getByLabel('Email', { exact: true }).fill(OWNER.email)
    await form.getByLabel('Password', { exact: true }).fill(OWNER.password)
    await form.getByRole('button', { name: 'Log in' }).click()

    // Signed in, back on the page that asked for the login.
    await expect(accountButton(page)).toBeVisible()
    await expect(page).toHaveURL(/#\/lesson\/devops\/helm$/)
    await expect(page.getByRole('article', { name: 'Lesson: Helm' })).toBeVisible()
    await expect(loginPage(page)).toHaveCount(0)
    expect((await page.request.get('/api/notes')).status()).toBe(200)
  })

  test('a wrong password and an unknown email both get "Wrong email or password" and no session', async ({
    page,
  }) => {
    await page.goto('/#/')
    const form = loginPage(page)
    await expect(form).toBeVisible()

    await form.getByLabel('Email', { exact: true }).fill(OWNER.email)
    await form.getByLabel('Password', { exact: true }).fill('not-the-owner-password')
    await form.getByRole('button', { name: 'Log in' }).click()
    await expect(form.getByRole('alert')).toHaveText(WRONG_LOGIN)
    expect((await page.request.get('/api/auth/me')).status()).toBe(401)

    await form.getByLabel('Email', { exact: true }).fill('nobody@example.test')
    await form.getByLabel('Password', { exact: true }).fill(OWNER.password)
    await form.getByRole('button', { name: 'Log in' }).click()
    await expect(form.getByRole('alert')).toHaveText(WRONG_LOGIN)
    await expect(form.getByRole('button', { name: 'Log in' })).toBeEnabled()

    expect((await page.request.get('/api/auth/me')).status()).toBe(401)
    expect((await page.request.get('/api/notes')).status()).toBe(401)
    expect(await page.context().cookies()).toEqual([])
    await expect(accountButton(page)).toHaveCount(0)
  })

  test('sign-up is refused once the admin exists, and the login page shows instead of create-admin', async ({
    page,
    request,
  }) => {
    const refused = await request.post('/api/auth/signup', {
      headers: H,
      data: { email: 'second@example.test', password: 'second-owner-password', display_name: 'Second' },
    })
    expect(refused.status()).toBe(403)
    // Spec (multi-user, Invite only): once the admin exists, sign-up needs an invitation.
    expect((await refused.json()).detail).toBe('You need an invitation to join')
    expect((await request.get('/api/auth/me')).status()).toBe(401)
    // The refused account was not created: its email cannot log in or ask for a link either way.
    expect((await (await request.get('/api/auth/status')).json()).has_owner).toBe(true)

    for (const address of ['/#/', '/#/auth/create']) {
      await page.goto(address)
      await expect(loginPage(page).getByRole('heading', { name: 'Log in' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Create the admin account' })).toHaveCount(0)
    }
  })

  test('the account menu shows the Owner, and Log out ends the session and shows the login page', async ({
    page,
    playwright,
  }) => {
    // A session of this browser only, so the shared Owner session is not ended.
    expect((await login(page.request, OWNER.email, OWNER.password)).status()).toBe(200)
    await page.goto('/#/')
    const button = accountButton(page)
    // A browser new to the app waits for the session check first; slow under load.
    await expect(button).toBeVisible({ timeout: 15_000 })
    await expect(button).toContainText(OWNER.name)
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText(OWNER.email, { exact: true })).toBeVisible()
    const menu = page.getByRole('menu', { name: 'Account' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Settings', 'Log out'])
    await shot(page, 'account-menu')

    // Settings opens from the menu.
    await menu.getByRole('menuitem', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/#\/settings$/)
    await expect(menu).toHaveCount(0)

    const before = await page.context().cookies()
    expect(before.length).toBeGreaterThan(0)
    await button.click()
    await page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: 'Log out' }).click()
    await expect(loginPage(page).getByRole('heading', { name: 'Log in' })).toBeVisible()
    await expect(accountButton(page)).toHaveCount(0)
    expect((await page.request.get('/api/notes')).status()).toBe(401)

    // The old session cookie, sent again from elsewhere, is refused: the session ended on the server.
    const replay = await playwright.request.newContext({ baseURL: APP, storageState: { cookies: before, origins: [] } })
    try {
      expect((await replay.get('/api/notes')).status()).toBe(401)
      expect((await replay.get('/api/auth/me')).status()).toBe(401)
    } finally {
      await replay.dispose()
    }
  })

  test('a magic link from the outbox signs in once; opening it again is refused', async ({ page, request, browser }) => {
    const previous = latestOutboxToken('magic')
    await page.goto('/#/auth/magic')
    const card = page.getByRole('main', { name: 'Sign in with an email link' })
    await card.getByLabel('Email', { exact: true }).fill(OWNER.email)
    await card.getByRole('button', { name: 'Send sign-in link' }).click()
    await expect(card.getByRole('status')).toContainText(MAGIC_SENT)
    await expect(card.getByRole('status')).toContainText(OUTBOX_NOTE)

    // An unknown email gets the same answer (and no email).
    const unknown = await request.post('/api/auth/magic', { headers: H, data: { email: 'nobody@example.test' } })
    expect(unknown.status()).toBe(200)
    expect((await unknown.json()).message).toBe(MAGIC_SENT)

    const token = await nextOutboxToken('magic', previous)
    await page.goto(`/#/auth/magic?token=${token}`)
    await expect(accountButton(page)).toBeVisible()
    expect(page.url()).not.toContain(token)
    expect((await page.request.get('/api/notes')).status()).toBe(200)

    // A second use, in another browser, is refused and signs nobody in.
    const other = await freshBrowser(browser)
    try {
      const again = await other.newPage()
      await again.goto(`/#/auth/magic?token=${token}`)
      const refused = again.getByRole('main', { name: 'Sign-in link not accepted' })
      await expect(refused.getByRole('alert')).toHaveText(USED_LINK)
      await expect(refused.getByRole('button', { name: 'Send sign-in link' })).toBeVisible()
      expect((await again.request.get('/api/auth/me')).status()).toBe(401)
    } finally {
      await other.close()
    }
  })

  test('Continue with GitHub signs the Owner in through the provider and lands on the same page; Google is not configured', async ({
    page,
    request,
  }) => {
    await resetFakeGithub(request)
    await page.goto(LESSON)
    const form = loginPage(page)
    const google = form.getByRole('button', { name: 'Continue with Google' })
    await expect(google).toBeDisabled()
    await expect(form.getByText('Not configured on this server')).toBeVisible()
    await expect(google).toHaveAccessibleDescription('Not configured on this server')
    await expect(form.getByRole('button', { name: 'Continue with GitHub' })).toHaveCount(0)

    await form.getByRole('link', { name: 'Continue with GitHub' }).click()
    await expect(accountButton(page)).toBeVisible()
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:5174\/#\/lesson\/devops\/helm$/)
    await expect(page.getByRole('article', { name: 'Lesson: Helm' })).toBeVisible()
    const me = await (await page.request.get('/api/auth/me')).json()
    expect(me.email).toBe(OWNER.email)
    expect(me.linked).toContain('github')
  })

  test('a GitHub identity with another email and no invitation is refused: "You need an invitation to join", no session', async ({
    page,
    request,
  }) => {
    await request.post(`${FAKE}/oauth-control`, { data: { email: 'stranger@example.test', user_id: 777001 } })
    try {
      await page.goto('/#/')
      await loginPage(page).getByRole('link', { name: 'Continue with GitHub' }).click()
      const form = loginPage(page)
      await expect(form.getByRole('alert')).toHaveText('You need an invitation to join.')
      // The error code leaves the address bar once shown.
      await expect(page).toHaveURL(/#\/auth\/login$/)
      await expect(accountButton(page)).toHaveCount(0)
      expect((await page.request.get('/api/auth/me')).status()).toBe(401)
      expect((await page.request.get('/api/notes')).status()).toBe(401)
    } finally {
      await resetFakeGithub(request)
    }
  })

  test('a GitHub callback with a forged state is refused and creates no session', async ({ page, request }) => {
    await resetFakeGithub(request)
    await page.goto('/#/')
    await expect(loginPage(page)).toBeVisible()
    // This browser starts a real sign-in (the server sets its state cookie) ...
    const started = await page.request.get('/api/auth/oauth/github/start?next=%23%2F', { maxRedirects: 0 })
    expect(started.status()).toBe(302)
    const authorize = new URL(started.headers()['location'])
    expect(authorize.origin + authorize.pathname).toBe(`${FAKE}/oauth/github/authorize`)
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    const realState = authorize.searchParams.get('state')
    expect(realState).toBeTruthy()

    // ... but the callback arrives with another state and a code the provider would accept.
    await page.goto(`/api/auth/oauth/github/callback?code=forged-code&state=forged-${realState}`)
    const form = loginPage(page)
    await expect(form.getByRole('alert')).toHaveText(/The sign-in could not be confirmed/)
    await expect(accountButton(page)).toHaveCount(0)
    expect((await page.request.get('/api/auth/me')).status()).toBe(401)

    // A callback without any started sign-in in this browser is refused the same way.
    const bare = await request.get(`/api/auth/oauth/github/callback?code=x&state=${realState}`, { maxRedirects: 0 })
    expect(bare.status()).toBe(302)
    expect(bare.headers()['location']).toBe(`${APP}/#/auth/login?error=state_mismatch`)
    expect((bare.headers()['set-cookie'] ?? '').includes('lh_session=')).toBeFalsy()
    expect((await request.get('/api/auth/me')).status()).toBe(401)
  })
})

test('the verify page refuses a used link, and a verified Owner is told so on resend', async ({ page, request }) => {
  // The Owner verified with the sign-up link in the setup (that is the fresh-link check);
  // once verified, a resend sends no new link.
  const resend = await request.post('/api/auth/verify/resend', { headers: H })
  expect(resend.status()).toBe(200)
  expect((await resend.json()).message).toBe('Your email is verified already.')
  expect((await (await request.get('/api/auth/me')).json()).email_verified).toBe(true)

  await page.goto(`/#/auth/verify?token=${outboxToken('verify')}`)
  const card = page.getByRole('main', { name: 'Email not verified' })
  await expect(card.getByRole('alert')).toHaveText(USED_LINK)
  await expect(page).toHaveURL(/#\/auth\/verify$/)
})

test('sessions are listed, and log out everywhere else ends the other browser\'s session', async ({ playwright }) => {
  const first = await freshContext(playwright)
  const second = await freshContext(playwright)
  try {
    expect((await login(first, OWNER.email, OWNER.password)).status()).toBe(200)
    expect((await login(second, OWNER.email, OWNER.password)).status()).toBe(200)

    const listed = (await (await first.get('/api/auth/sessions')).json()) as Array<{ id: string; current: boolean }>
    expect(listed.filter((s) => s.current)).toHaveLength(1)
    expect(listed.length).toBeGreaterThanOrEqual(2)
    const firstId = listed.find((s) => s.current)!.id
    const fromSecond = (await (await second.get('/api/auth/sessions')).json()) as Array<{ id: string; current: boolean }>
    expect(fromSecond.find((s) => s.id === firstId)?.current).toBe(false)

    const out = await second.post('/api/auth/sessions/logout-others', { headers: H })
    expect(out.status()).toBe(200)
    expect((await out.json()).revoked).toBeGreaterThanOrEqual(1)

    expect((await first.get('/api/notes')).status()).toBe(401)
    expect((await second.get('/api/notes')).status()).toBe(200)
    const left = (await (await second.get('/api/auth/sessions')).json()) as Array<{ current: boolean }>
    expect(left).toEqual([expect.objectContaining({ current: true })])
  } finally {
    // Every other session ended, the shared one too: the remaining one becomes the Owner's.
    await saveOwnerSession(second)
    await first.dispose()
    await second.dispose()
  }
  // The saved session works for the tests that follow.
  const check = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    expect((await check.get('/api/notes')).status()).toBe(200)
  } finally {
    await check.dispose()
  }
})

test.describe('Forgot password', () => {
  test.use({ storageState: SIGNED_OUT })

  test('a reset link from the outbox sets a new password once; the old one and other sessions stop working', async ({
    page,
    playwright,
  }) => {
    const NEW_PASSWORD = 'e2e-new-owner-password-2'
    const shared = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
    try {
      expect((await shared.get('/api/notes')).status()).toBe(200)

      const previous = latestOutboxToken('reset')
      await page.goto('/#/auth/login')
      await loginPage(page).getByRole('link', { name: 'Forgot password?' }).click()
      const card = page.getByRole('main', { name: 'Reset your password' })
      await card.getByLabel('Email', { exact: true }).fill(OWNER.email)
      await card.getByRole('button', { name: 'Send reset link' }).click()
      await expect(card.getByRole('status')).toContainText(FORGOT_SENT)
      await expect(card.getByRole('status')).toContainText(OUTBOX_NOTE)

      // An unknown email gets the same answer.
      const unknown = await page.request.post('/api/auth/forgot', { headers: H, data: { email: 'nobody@example.test' } })
      expect((await unknown.json()).message).toBe(FORGOT_SENT)

      const token = await nextOutboxToken('reset', previous)
      await page.goto(`/#/auth/reset?token=${token}`)
      const reset = page.getByRole('main', { name: 'Set a new password' })
      await reset.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
      await reset.getByLabel('Confirm new password', { exact: true }).fill(NEW_PASSWORD)
      await reset.getByRole('button', { name: 'Set new password' }).click()
      // Hashing the new password and signing in take seconds under the full suite's load.
      await expect(accountButton(page)).toBeVisible({ timeout: 15_000 })
      expect(page.url()).not.toContain(token)

      // The link works once.
      const reused = await page.request.post('/api/auth/reset', { headers: H, data: { token, password: 'yet-another-password' } })
      expect(reused.status()).toBe(400)
      // Other sessions are logged out.
      expect((await shared.get('/api/notes')).status()).toBe(401)

      const check = await freshContext(playwright)
      try {
        const old = await login(check, OWNER.email, OWNER.password)
        expect(old.status()).toBe(401)
        expect((await old.json()).detail).toBe(WRONG_LOGIN)
        expect((await login(check, OWNER.email, NEW_PASSWORD)).status()).toBe(200)
      } finally {
        await check.dispose()
      }
    } finally {
      await shared.dispose()
      // Back to the configured password, with a fresh shared session for the tests that follow.
      await resetPasswordAndSaveOwner(playwright, OWNER.password)
    }
  })
})
