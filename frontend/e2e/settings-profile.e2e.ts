/**
 * Spec checks for the change settings-tabs (openspec/changes/settings-tabs/specs/settings): the
 * left-column navigation of Settings and Profile, Profile (details, avatar, email change), Security
 * (password, linked sign-in methods, sessions), Preferences, Delete account and Delete all notes.
 *
 * Every test makes its own fresh member through the sign-up API in a browser context of its own
 * (the admin is the account owner.setup.ts creates); the members are deleted in afterAll. Emails are
 * read from the outbox, GitHub is the fake provider on the fake server (port 8002), the model is the
 * fake OpenAI-compatible server.
 *
 * Not testable end to end: "none of a deleted member's notes, lessons, providers or chats remain" (the
 * admin API shows only that the account is gone; the cascade is a backend test), "single use and 24 h
 * of the email link" (24 h cannot be waited for; single use is checked by opening the link twice).
 */
import { expect as baseExpect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { OWNER, OWNER_STATE } from '../playwright.config.ts'
import { latestOutboxToken, nextOutboxToken, outboxMailsTo } from './outbox.ts'

test.describe.configure({ timeout: 120_000 })
const expect = baseExpect.configure({ timeout: 20_000 })

const APP = 'http://127.0.0.1:5174'
const FAKE = 'http://127.0.0.1:8002'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const STAMP = Date.now().toString(36)
// A per-run test credential for the fake accounts of this file.
const MEMBER_PW = `${STAMP}-e2e-member-pw`
const CHANGED_PW = `${STAMP}-e2e-changed-pw`

/** Accounts made here, removed in afterAll (by id, so a changed email does not matter). */
const created: string[] = []
const contexts: BrowserContext[] = []
let counter = 0

// A 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

/** Light, then dark (`-dark` suffix) screenshots of the page as it is now. */
async function shotBoth(page: Page, name: string) {
  await page.emulateMedia({ colorScheme: 'light' })
  await shot(page, name)
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, `${name}-dark`)
  await page.emulateMedia({ colorScheme: 'light' })
}

interface MeApi {
  id: string
  email: string
  email_verified: boolean
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  linked: string[]
  preferences: { answer_language: string; default_effort: string }
}
const meOf = async (page: Page) => (await (await page.request.get('/api/auth/me')).json()) as MeApi

/** A fresh member (password, unverified email, time zone set so no dialog covers the page) in a browser of its own. */
async function newMember(browser: Browser, tag: string) {
  const email = `sp-${tag}-${STAMP}-${counter++}@example.test`
  const context = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
  contexts.push(context)
  const signup = await context.request.post('/api/auth/signup', {
    headers: H,
    data: { email, password: MEMBER_PW, display_name: 'SP Member' },
  })
  expect(signup.status(), await signup.text()).toBe(201)
  const zone = await context.request.put('/api/auth/timezone', { headers: H, data: { timezone: 'UTC' } })
  expect(zone.status(), await zone.text()).toBe(200)
  const page = await context.newPage()
  const me = (await (await context.request.get('/api/auth/me')).json()) as MeApi
  created.push(me.id)
  return { email, context, page, id: me.id }
}

const accountButton = (page: Page) => page.getByRole('button', { name: /^Account menu: / })
const profile = (page: Page) => page.getByRole('region', { name: 'Profile' })
const learnedList = (page: Page) => page.getByRole('complementary', { name: 'Learned items' })

test.afterAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    const users = (await (await admin.get('/api/admin/users')).json()) as Array<{ id: string; email: string }>
    for (const id of created) {
      const found = users.find((u) => u.id === id)
      if (found) await admin.delete(`/api/admin/users/${id}`, { headers: H, data: { confirm_email: found.email } })
    }
    await admin.post(`${FAKE}/oauth-control`, { data: {} })
  } finally {
    await admin.dispose()
    for (const context of contexts) await context.close()
  }
})

// ---------------------------------------------------------------------------------------------
// Left-column navigation
// ---------------------------------------------------------------------------------------------

test('Left-column navigation > Settings sections in the left column, and Back to the Learned list', async ({ page }) => {
  await page.goto('/#/settings/agents')
  const nav = page.getByRole('navigation', { name: 'Settings sections' })
  await expect(nav.getByRole('link')).toHaveText(['AI providers', 'Agents', 'Users', 'Sign-in', 'Data & sync'])
  await expect(nav.getByRole('link', { name: 'Agents' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
  await expect(learnedList(page)).toHaveCount(0)
  // No tab row above the content: the sections are not inside the main pane and are not tabs.
  await expect(page.getByRole('main', { name: 'Content' }).getByRole('navigation', { name: 'Settings sections' })).toHaveCount(0)
  await expect(page.getByRole('tablist')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Agents' }).getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible()
  await shotBoth(page, 'settings-left-column')

  // Each section has its own address.
  await nav.getByRole('link', { name: 'Data & sync' }).click()
  await expect(page).toHaveURL(/#\/settings\/data$/)
  await expect(nav.getByRole('link', { name: 'Data & sync' })).toHaveAttribute('aria-current', 'page')

  // Leaving Settings for the home page brings the Learned list back.
  await page.getByRole('link', { name: '← Back', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What do you want to learn?' })).toBeVisible()
  await expect(learnedList(page)).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toHaveCount(0)
})

test('Left-column navigation > Member sees fewer sections', async ({ browser }) => {
  const { page } = await newMember(browser, 'nav')
  await page.goto('/#/settings')
  const nav = page.getByRole('navigation', { name: 'Settings sections' })
  await expect(nav.getByRole('link')).toHaveText(['AI providers', 'Agents', 'Data & sync'])
  await expect(learnedList(page)).toHaveCount(0)
  await shot(page, 'settings-left-column-member')
})

// ---------------------------------------------------------------------------------------------
// Profile page
// ---------------------------------------------------------------------------------------------

test('Profile page > Open Profile from the avatar menu: General with the sections in the left column', async ({ page }) => {
  await page.goto('/')
  await accountButton(page).click()
  await page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: 'Profile' }).click()
  await expect(page).toHaveURL(/#\/profile$/)
  await expect(profile(page).getByRole('heading', { level: 1, name: 'General' })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Profile sections' })
  await expect(nav.getByRole('link')).toHaveText(['General', 'Security', 'Preferences'])
  await expect(nav.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page')
  await expect(learnedList(page)).toHaveCount(0)
  await expect(page.getByRole('tablist')).toHaveCount(0)
  await shotBoth(page, 'profile-general')

  await nav.getByRole('link', { name: 'Security' }).click()
  await expect(page).toHaveURL(/#\/profile\/security$/)
  await expect(profile(page).getByRole('heading', { level: 1, name: 'Security' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Security' })).toHaveAttribute('aria-current', 'page')
  await expect(profile(page).getByRole('group', { name: 'Sessions' })).toBeVisible()
  await shotBoth(page, 'profile-security')

  await nav.getByRole('link', { name: 'Preferences' }).click()
  await expect(page).toHaveURL(/#\/profile\/preferences$/)
  await expect(profile(page).getByRole('heading', { level: 1, name: 'Preferences' })).toBeVisible()
  await expect(profile(page).getByLabel('Answer language')).toBeVisible()
  await shotBoth(page, 'profile-preferences')
})

test('Profile page > Old account address: #/settings/account shows Profile', async ({ page }) => {
  await page.goto('/#/settings/account')
  await expect(profile(page).getByRole('heading', { level: 1, name: 'General' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Profile sections' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toHaveCount(0)
})

// ---------------------------------------------------------------------------------------------
// Profile details
// ---------------------------------------------------------------------------------------------

test('Profile details > Change display name: Save is off until a change, and the avatar menu shows the new name', async ({ browser }) => {
  const { page } = await newMember(browser, 'name')
  await page.goto('/#/profile')
  const form = profile(page).getByRole('form', { name: 'Profile details' })
  const name = form.getByLabel('Display name')
  await expect(name).toHaveValue('SP Member')
  await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled()
  await name.fill('Renamed Member')
  await expect(form.getByRole('button', { name: 'Save' })).toBeEnabled()
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form.getByText('Saved.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Account menu: Renamed Member' })).toBeVisible()
  expect((await meOf(page)).display_name).toBe('Renamed Member')
  await page.reload()
  await expect(profile(page).getByLabel('Display name')).toHaveValue('Renamed Member')
})

test('Profile details > Leave without saving: the app asks, declining keeps the page, the stored bio is unchanged', async ({ browser }) => {
  const { page } = await newMember(browser, 'bio')
  await page.goto('/#/profile')
  await profile(page).getByLabel('Bio', { exact: true }).fill('A bio that is never saved')
  const messages: string[] = []
  page.on('dialog', (d) => {
    messages.push(d.message())
    void d.dismiss()
  })
  await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('link', { name: 'Security' }).click()
  await expect.poll(() => messages.length).toBeGreaterThan(0)
  expect(messages[0]).toMatch(/unsaved changes/i)
  await expect(page).toHaveURL(/#\/profile$/)
  await expect(profile(page).getByLabel('Bio', { exact: true })).toHaveValue('A bio that is never saved')
  expect((await meOf(page)).bio ?? '').toBe('')

  // Accepting leaves the page and still stores nothing.
  page.removeAllListeners('dialog')
  page.on('dialog', (d) => void d.accept())
  await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('link', { name: 'Security' }).click()
  await expect(page).toHaveURL(/#\/profile\/security$/)
  expect((await meOf(page)).bio ?? '').toBe('')
})

test('Profile details > Unverified email: Verify email sends a link and the page says so', async ({ browser }) => {
  const { page, email } = await newMember(browser, 'verify')
  await page.goto('/#/profile')
  const group = profile(page).getByRole('group', { name: 'Email' })
  await expect(group).toContainText(email)
  await expect(group).toContainText('Not verified')
  const previous = latestOutboxToken('verify')
  await group.getByRole('button', { name: 'Verify email' }).click()
  await expect(group.getByRole('status')).toContainText(/link/i)
  const token = await nextOutboxToken('verify', previous)
  expect(token.length).toBeGreaterThan(10)
  await shot(page, 'profile-verify-email')
  // The sent link verifies the address.
  await page.goto(`/#/auth/verify?token=${token}`)
  await expect(page.getByRole('heading', { name: 'Your email is verified' })).toBeVisible()
  expect((await meOf(page)).email_verified).toBe(true)
})

// ---------------------------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------------------------

test('Avatar > Upload an avatar: the avatar menu shows it, it is served with safe headers to the signed-in user only; Remove goes back to initials', async ({
  browser,
  playwright,
}) => {
  const { page } = await newMember(browser, 'avatar')
  await page.goto('/#/profile')
  const avatarImage = accountButton(page).locator('img')
  await expect(avatarImage).toHaveCount(0)
  await profile(page).getByLabel('Avatar file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG })
  await expect(avatarImage).toBeVisible()
  await expect.poll(() => avatarImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await shot(page, 'profile-avatar')
  const url = (await meOf(page)).avatar_url
  expect(url).toBeTruthy()

  const served = await page.request.get(url!)
  expect(served.status()).toBe(200)
  expect(served.headers()['content-type']).toMatch(/^image\/png/)
  expect(served.headers()['x-content-type-options']).toBe('nosniff')
  const anonymous = await playwright.request.newContext({ baseURL: APP, storageState: SIGNED_OUT })
  try {
    expect((await anonymous.get(url!)).status()).toBe(401)
  } finally {
    await anonymous.dispose()
  }

  await profile(page).getByRole('button', { name: 'Remove picture' }).click()
  await expect(avatarImage).toHaveCount(0)
  expect((await meOf(page)).avatar_url).toBeNull()
})

test('Avatar > Wrong avatar file: a 3 MB image, a PDF, an SVG and an HTML file named .png are refused with the reason and the avatar is unchanged', async ({
  browser,
}) => {
  const { page } = await newMember(browser, 'badavatar')
  await page.goto('/#/profile')
  const input = profile(page).getByLabel('Avatar file')
  const group = profile(page).getByRole('group', { name: 'Avatar' })
  const avatarImage = accountButton(page).locator('img')

  await input.setInputFiles({
    name: 'big.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]),
  })
  await expect(group.getByRole('alert')).toContainText('1 MB')

  await input.setInputFiles({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%fake\n') })
  await expect(group.getByRole('alert')).toContainText('PNG, JPEG or WebP')

  // Passes the browser's check (named .png) and is refused by the server, which reads the content.
  await input.setInputFiles({ name: 'page.png', mimeType: 'image/png', buffer: Buffer.from('<!doctype html><script>alert(1)</script>') })
  await expect(group.getByRole('alert')).toContainText('PNG, JPEG or WebP')
  await shot(page, 'profile-avatar-refused')
  await expect(avatarImage).toHaveCount(0)
  expect((await meOf(page)).avatar_url).toBeNull()

  // The server refuses on its own (a client that skips the page's check): SVG, 3 MB, HTML as .png.
  const send = (name: string, mimeType: string, buffer: Buffer) =>
    page.request.post('/api/auth/avatar', { headers: H, multipart: { file: { name, mimeType, buffer } } })
  const svg = await send('x.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))
  expect(svg.status()).toBe(415)
  const big = await send('big.png', 'image/png', Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]))
  expect(big.status()).toBe(413)
  const html = await send('page.png', 'image/png', Buffer.from('<!doctype html><p>x</p>'))
  expect(html.status()).toBe(415)
  expect((await meOf(page)).avatar_url).toBeNull()
})

// ---------------------------------------------------------------------------------------------
// Email change
// ---------------------------------------------------------------------------------------------

test('Email change > Not confirmed: the request changes nothing, sign-in with the old email still works', async ({ browser, playwright }) => {
  const { page, email } = await newMember(browser, 'mailno')
  const next = `sp-new-${STAMP}-${counter++}@example.test`
  await page.goto('/#/profile')
  const group = profile(page).getByRole('group', { name: 'Email' })
  await group.getByRole('button', { name: 'Change email' }).click()
  await group.getByLabel('New email').fill(next)
  await group.getByRole('button', { name: 'Save' }).click()
  await expect(group.getByRole('status')).toContainText('Your email changes when you open it')
  await shot(page, 'profile-email-change-sent')
  expect((await meOf(page)).email).toBe(email)
  await expect(group).toContainText(email)

  const other = await playwright.request.newContext({ baseURL: APP, storageState: SIGNED_OUT })
  try {
    const login = await other.post('/api/auth/login', { headers: H, data: { email, password: MEMBER_PW } })
    expect(login.status(), await login.text()).toBe(200)
    const newer = await other.post('/api/auth/login', { headers: H, data: { email: next, password: MEMBER_PW } })
    expect(newer.status()).toBe(401)
  } finally {
    await other.dispose()
  }
})

test('Email change > Change confirmed: the link goes to the new address, the old one gets a notice, opening the link changes the email (verified); the link works once', async ({
  browser,
  playwright,
}) => {
  const { page, email } = await newMember(browser, 'mailyes')
  const next = `sp-confirmed-${STAMP}-${counter++}@example.test`
  const previous = latestOutboxToken('email-change')
  await page.goto('/#/profile')
  const group = profile(page).getByRole('group', { name: 'Email' })
  await group.getByRole('button', { name: 'Change email' }).click()
  await group.getByLabel('New email').fill(next)
  await group.getByRole('button', { name: 'Save' }).click()
  await expect(group.getByRole('status')).toBeVisible()

  const token = await nextOutboxToken('email-change', previous)
  expect(outboxMailsTo(next).some((m) => m.includes(`token=${token}`))).toBe(true)
  const notice = outboxMailsTo(email).filter((m) => /about to change/i.test(m))
  expect(notice.length).toBeGreaterThan(0)
  expect(notice.join('\n')).not.toContain(token)
  expect((await meOf(page)).email).toBe(email)

  await page.goto(`/#/auth/email-change?token=${token}`)
  await expect(page.getByRole('heading', { name: 'Your email is changed' })).toBeVisible()
  await shot(page, 'profile-email-changed')
  const me = await meOf(page)
  expect(me.email).toBe(next)
  expect(me.email_verified).toBe(true)

  const again = await page.request.post('/api/auth/email/confirm', { headers: H, data: { token } })
  expect(again.status()).toBe(400)
  const other = await playwright.request.newContext({ baseURL: APP, storageState: SIGNED_OUT })
  try {
    expect((await other.post('/api/auth/login', { headers: H, data: { email: next, password: MEMBER_PW } })).status()).toBe(200)
  } finally {
    await other.dispose()
  }
})

// ---------------------------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------------------------

test('Password in Security > Change password: the new password works at the next sign-in and the old one does not', async ({ browser }) => {
  const { page, email } = await newMember(browser, 'pw')
  await page.goto('/#/profile/security')
  const form = profile(page).getByRole('form', { name: 'Password' })
  await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled()
  await form.getByLabel('Current password').fill(MEMBER_PW)
  await form.getByLabel('New password').fill(CHANGED_PW)
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form.getByText('Saved.')).toBeVisible()

  const fresh = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
  contexts.push(fresh)
  const old = await fresh.request.post('/api/auth/login', { headers: H, data: { email, password: MEMBER_PW } })
  expect(old.status()).toBe(401)
  const visitor = await fresh.newPage()
  await visitor.goto('/')
  const login = visitor.getByRole('main', { name: 'Log in' })
  await login.getByLabel('Email', { exact: true }).fill(email)
  await login.getByLabel('Password', { exact: true }).fill(CHANGED_PW)
  await login.getByRole('button', { name: 'Log in' }).click()
  await expect(accountButton(visitor)).toBeVisible()
})

test('Linked sign-in methods > Last method refused, Link GitHub, sign in with it, and an identity of another account is refused', async ({
  browser,
  request,
}) => {
  const gh = { email: `sp-gh-other-${STAMP}@example.test`, id: 990100 + Math.floor(Math.random() * 800) }
  const mine = { email: `sp-gh-mine-${STAMP}@example.test`, id: gh.id + 1000 }
  try {
    // Another account that signs up with the GitHub identity `gh`.
    expect((await request.post(`${FAKE}/oauth-control`, { data: { email: gh.email, user_id: gh.id } })).ok()).toBe(true)
    const holderContext = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
    contexts.push(holderContext)
    const holder = await holderContext.newPage()
    await holder.goto('/')
    await holder.getByRole('main', { name: 'Log in' }).getByRole('link', { name: 'Continue with GitHub' }).click()
    await expect(accountButton(holder)).toBeVisible()
    const holderMe = await meOf(holder)
    created.push(holderMe.id)
    expect(holderMe.linked).toContain('github')

    // Scenario: Last method - GitHub is the holder's only way in.
    await holder.request.put('/api/auth/timezone', { headers: H, data: { timezone: 'UTC' } })
    await holder.goto('/#/profile/security')
    await holder.reload()
    const holderMethods = profile(holder).getByRole('group', { name: 'Sign-in methods' })
    await expect(holderMethods).toContainText('GitHub')
    await holderMethods.getByRole('button', { name: 'Unlink GitHub' }).click()
    await expect(holderMethods.getByRole('alert')).toContainText('Add another method first')
    await shot(holder, 'profile-last-method')
    expect((await meOf(holder)).linked).toContain('github')

    // A member with a password only.
    const { page, email } = await newMember(browser, 'link')
    await page.goto('/#/profile/security')
    const methods = profile(page).getByRole('group', { name: 'Sign-in methods' })
    await expect(methods).toContainText('Password')
    await expect(methods.getByRole('link', { name: 'Link GitHub' })).toBeVisible()
    await expect(methods.getByRole('link', { name: 'Link Google' })).toHaveCount(0)

    // Scenario: Identity of another account - the provider still reports `gh`.
    await methods.getByRole('link', { name: 'Link GitHub' }).click()
    await expect(page).toHaveURL(/#\/profile\/security\?error=identity_taken/)
    await expect(methods.getByRole('alert')).toContainText('another Learning Hub account')
    await shot(page, 'profile-link-refused')
    expect((await meOf(page)).linked).not.toContain('github')
    expect((await meOf(holder)).linked).toContain('github')

    // Scenario: Link GitHub - with a free identity.
    expect((await request.post(`${FAKE}/oauth-control`, { data: { email: mine.email, user_id: mine.id } })).ok()).toBe(true)
    await methods.getByRole('link', { name: 'Link GitHub' }).click()
    await expect(page).toHaveURL(/#\/profile\/security\?linked=github/)
    await expect(methods.getByText('GitHub is linked.')).toBeVisible()
    await expect(methods.getByRole('button', { name: 'Unlink GitHub' })).toBeVisible()
    await shotBoth(page, 'profile-link-github')
    expect((await meOf(page)).linked).toContain('github')

    // Signing in with GitHub opens the same account.
    const visitorContext = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
    contexts.push(visitorContext)
    const visitor = await visitorContext.newPage()
    await visitor.goto('/')
    await visitor.getByRole('main', { name: 'Log in' }).getByRole('link', { name: 'Continue with GitHub' }).click()
    await expect(accountButton(visitor)).toBeVisible()
    expect((await meOf(visitor)).email).toBe(email)
  } finally {
    await request.post(`${FAKE}/oauth-control`, { data: {} })
  }
})

test('Sessions in Security > Revoke another session: it is signed out and disappears from the list', async ({ browser }) => {
  const { page, context, email } = await newMember(browser, 'sess')
  const second = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
  contexts.push(second)
  const login = await second.request.post('/api/auth/login', { headers: H, data: { email, password: MEMBER_PW } })
  expect(login.status(), await login.text()).toBe(200)
  expect((await second.request.get('/api/auth/me')).status()).toBe(200)

  await page.goto('/#/profile/security')
  const sessions = profile(page).getByRole('group', { name: 'Sessions' })
  await expect(sessions.getByRole('listitem')).toHaveCount(2)
  await expect(sessions.getByText('This session')).toBeVisible()
  await shotBoth(page, 'profile-sessions')
  await sessions.getByRole('button', { name: 'Revoke' }).click()
  await expect(sessions.getByRole('listitem')).toHaveCount(1)
  await expect(sessions.getByRole('button', { name: 'Revoke' })).toHaveCount(0)
  expect((await second.request.get('/api/auth/me')).status()).toBe(401)
  expect((await context.request.get('/api/auth/me')).status()).toBe(200)
})

// ---------------------------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------------------------

test('Preferences > Answer language and Default effort: saved with Save, the agent is asked for Vietnamese, a new chat on another device starts at High', async ({
  browser,
}) => {
  const { page, email } = await newMember(browser, 'prefs')
  const made = await page.request.post('/api/ai-providers', {
    headers: H,
    data: { name: `SP own ${STAMP}`, provider_type: 'local', model_name: 'fake-ok', base_url: `${FAKE}/v1`, config: {} },
  })
  expect(made.status(), await made.text()).toBe(201)

  await page.goto('/#/profile/preferences')
  const form = profile(page).getByRole('form', { name: 'Preferences' })
  await expect(form.getByLabel('Answer language')).toHaveValue('auto')
  await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled()
  await form.getByLabel('Answer language').selectOption({ label: 'Vietnamese' })
  await form.getByLabel('Default effort').selectOption({ label: 'High' })
  await form.getByRole('button', { name: 'Cancel' }).click()
  await expect(form.getByLabel('Answer language')).toHaveValue('auto')
  expect((await meOf(page)).preferences.answer_language).toBe('auto')

  await form.getByLabel('Answer language').selectOption({ label: 'Vietnamese' })
  await form.getByLabel('Default effort').selectOption({ label: 'High' })
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form.getByText('Saved.')).toBeVisible()
  await shotBoth(page, 'profile-preferences-saved')
  const prefs = (await meOf(page)).preferences
  expect(prefs).toEqual({ answer_language: 'vi', default_effort: 'high' })

  // Scenario: Answer language - the model's instructions ask for Vietnamese.
  await page.goto('/')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await box.fill('[[echo-system]] Vietnamese')
  await box.press('Enter')
  await expect(agent.getByText('SYSTEM has=yes')).toBeVisible({ timeout: 30_000 })

  // Scenario: Default effort - another device (a fresh browser) shows High in a new chat.
  const other = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
  contexts.push(other)
  const login = await other.request.post('/api/auth/login', { headers: H, data: { email, password: MEMBER_PW } })
  expect(login.status(), await login.text()).toBe(200)
  const device = await other.newPage()
  await device.goto('/')
  const panel = device.getByRole('complementary', { name: 'Agent' })
  await panel.getByRole('button', { name: 'Message options' }).click()
  await panel.getByRole('menuitem', { name: /Effort/ }).click()
  await expect(panel.getByRole('group', { name: 'Effort' }).getByRole('menuitemradio', { name: 'High' })).toBeChecked()
  await shot(device, 'profile-default-effort')
})

// ---------------------------------------------------------------------------------------------
// Delete account, Delete all notes
// ---------------------------------------------------------------------------------------------

test('Delete account > Member deletes their account: signed out, cannot sign in again', async ({ browser, playwright }) => {
  const { page, email } = await newMember(browser, 'delete')
  await page.goto('/#/profile')
  const form = profile(page).getByRole('form', { name: 'Delete account' })
  await expect(form.getByRole('button', { name: 'Delete account' })).toBeDisabled()
  await form.getByLabel(`Type ${email} to confirm`).fill('wrong@example.test')
  await expect(form.getByRole('button', { name: 'Delete account' })).toBeDisabled()
  await form.getByLabel(`Type ${email} to confirm`).fill(email)
  await shot(page, 'profile-delete-account')
  await form.getByRole('button', { name: 'Delete account' }).click()
  await expect(page.getByRole('main', { name: 'Log in' })).toBeVisible()
  expect((await page.request.get('/api/auth/me')).status()).toBe(401)

  const other = await playwright.request.newContext({ baseURL: APP, storageState: SIGNED_OUT })
  try {
    const login = await other.post('/api/auth/login', { headers: H, data: { email, password: MEMBER_PW } })
    expect(login.status()).toBe(401)
  } finally {
    await other.dispose()
  }
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    const users = (await (await admin.get('/api/admin/users')).json()) as Array<{ email: string }>
    expect(users.find((u) => u.email === email)).toBeUndefined()
  } finally {
    await admin.dispose()
  }
})

test('Delete account > Admin cannot: Delete account is not offered and the route refuses the admin', async ({ page }) => {
  await page.goto('/#/profile')
  await expect(profile(page).getByRole('heading', { level: 1, name: 'General' })).toBeVisible()
  await expect(profile(page).getByRole('group', { name: 'Email' })).toContainText(OWNER.email)
  await expect(profile(page).getByRole('heading', { name: 'Delete account' })).toHaveCount(0)
  await expect(profile(page).getByRole('button', { name: 'Delete account' })).toHaveCount(0)
  const refused = await page.request.delete('/api/auth/account', { headers: H, data: { confirm_email: OWNER.email } })
  expect(refused.status()).toBe(422)
  expect((await page.request.get('/api/auth/me')).status()).toBe(200)
})

test('Delete all notes > Two users imported the same file: A deletes all notes, A keeps the lessons, B keeps the note', async ({ browser }) => {
  const a = await newMember(browser, 'notesA')
  const b = await newMember(browser, 'notesB')
  const title = `SP shared note ${STAMP}`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>same bytes for both ${STAMP}</p></body></html>`
  const importFor = async (member: typeof a) => {
    const res = await member.page.request.post('/api/notes/import', {
      headers: H,
      multipart: { files: { name: 'shared.html', mimeType: 'text/html', buffer: Buffer.from(html) } },
    })
    expect(res.status(), await res.text()).toBe(200)
  }
  await importFor(a)
  await importFor(b)
  const lesson = await a.page.request.put('/api/lessons/devops/terraform', { headers: H, data: { body: `A lesson ${STAMP}` } })
  expect(lesson.status(), await lesson.text()).toBe(200)
  const bNotes = (await (await b.page.request.get('/api/notes')).json()) as Array<{ id: string }>
  expect(bNotes).toHaveLength(1)

  await a.page.goto('/#/settings/data')
  const card = a.page.getByRole('article', { name: 'Delete all notes' })
  await expect(card.getByRole('button', { name: 'Delete all notes' })).toBeDisabled()
  await card.getByLabel('Type DELETE to confirm').fill('delete')
  await expect(card.getByRole('button', { name: 'Delete all notes' })).toBeDisabled()
  await card.getByLabel('Type DELETE to confirm').fill('DELETE')
  await card.getByRole('button', { name: 'Delete all notes' }).scrollIntoViewIfNeeded()
  await shotBoth(a.page, 'data-delete-all-notes')
  await card.getByRole('button', { name: 'Delete all notes' }).click()
  await expect(card.getByText('All notes deleted.')).toBeVisible()

  expect(await (await a.page.request.get('/api/notes')).json()).toEqual([])
  const kept = await a.page.request.get('/api/lessons/devops/terraform')
  expect(JSON.stringify(await kept.json())).toContain(`A lesson ${STAMP}`)
  const stillThere = await b.page.request.get(`/api/notes/${bNotes[0].id}/original`)
  expect(stillThere.status()).toBe(200)
  expect(await stillThere.text()).toContain(`same bytes for both ${STAMP}`)
  expect(await (await b.page.request.get('/api/notes')).json()).toHaveLength(1)
})
