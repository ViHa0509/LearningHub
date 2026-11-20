/**
 * Spec checks for the change user-timezone (openspec/changes/user-timezone/specs/accounts): the
 * "Your time zone" dialog for a member without a zone (Save, Not now, Escape, not asked again),
 * Settings -> Account, the API refusals (unknown name, missing header), and times shown in the
 * user's zone (or the browser's zone while there is none).
 *
 * Every test makes its own fresh member through the sign-up API in a browser context of its own
 * (the owner has a zone since owner.setup.ts, so the dialog never covers the other tests) and the
 * members are deleted in afterAll. Browser zones and the locale are fixed per context. The model
 * is the fake OpenAI-compatible server on port 8002.
 *
 * Not testable end to end: the spec example of a conversation saved at 23:30 UTC (the server
 * stamps the real time, so a fixed instant cannot be arranged); the same rule is checked here
 * with the real time of a chat and the zone formatted by the test.
 */
import { expect as baseExpect, request as playwrightRequest, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { OWNER_STATE } from '../playwright.config.ts'

test.describe.configure({ mode: 'serial', timeout: 120_000 })
const expect = baseExpect.configure({ timeout: 20_000 })

const APP = 'http://127.0.0.1:5174'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const STAMP = Date.now().toString(36)
const PASSWORD = 'e2e-member-password-1'

const emails: string[] = []
const contexts: BrowserContext[] = []
let counter = 0

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

/** A fresh member signed in (through the sign-up API) in a browser of its own, set to `timezoneId`. */
async function newMember(browser: Browser, timezoneId: string) {
  const email = `tz-${STAMP}-${counter++}@example.test`
  emails.push(email)
  const context = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT, timezoneId, locale: 'en-US' })
  contexts.push(context)
  const signup = await context.request.post('/api/auth/signup', {
    headers: H,
    data: { email, password: PASSWORD, display_name: 'TZ Member' },
  })
  expect(signup.status(), await signup.text()).toBe(201)
  const page = await context.newPage()
  return { email, context, page }
}

const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Your time zone' })
const meOf = async (page: Page) => (await (await page.request.get('/api/auth/me')).json()) as { timezone: string | null }

test.afterAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    const users = (await (await admin.get('/api/admin/users')).json()) as Array<{ id: string; email: string }>
    for (const email of emails) {
      const found = users.find((u) => u.email === email)
      if (found) await admin.delete(`/api/admin/users/${found.id}`, { headers: H, data: { confirm_email: email } })
    }
  } finally {
    await admin.dispose()
    for (const context of contexts) await context.close()
  }
})

test('Each user chooses a time zone > Asked after sign-in: the dialog proposes the browser zone and Save stores it; not asked again after signing in again', async ({
  browser,
}) => {
  const { email, context, page } = await newMember(browser, 'Europe/Berlin')
  await page.goto('/')
  const dialog = dialogOf(page)
  await expect(dialog).toBeVisible()
  const select = dialog.getByLabel('Time zone', { exact: true })
  await expect(select).toHaveValue('Europe/Berlin')
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Not now' })).toBeVisible()
  // Nothing is stored until Save is clicked.
  expect((await meOf(page)).timezone).toBeNull()

  await page.emulateMedia({ colorScheme: 'light' })
  await shot(page, 'timezone-dialog')
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, 'timezone-dialog-dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(dialog).toBeVisible()
  await shot(page, 'timezone-dialog-phone')
  await page.setViewportSize({ width: 1440, height: 900 })

  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)
  expect((await meOf(page)).timezone).toBe('Europe/Berlin')

  // Scenario: Not asked again - sign out and in again: no dialog.
  await page.getByRole('button', { name: /^Account menu:/ }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page.getByRole('main', { name: 'Log in' })).toBeVisible()
  const login = await context.request.post('/api/auth/login', { headers: H, data: { email, password: PASSWORD } })
  expect(login.status(), await login.text()).toBe(200)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'What do you want to learn?' })).toBeVisible()
  await expect(dialogOf(page)).toHaveCount(0)
})

test('Each user chooses a time zone > Not now: "Not now" and Escape store nothing, the dialog stays away while signed in and returns after the next sign-in', async ({
  browser,
}) => {
  const { email, context, page } = await newMember(browser, 'Europe/Berlin')
  await page.goto('/')
  await expect(dialogOf(page)).toBeVisible()
  await dialogOf(page).getByRole('button', { name: 'Not now' }).click()
  await expect(dialogOf(page)).toHaveCount(0)
  expect((await meOf(page)).timezone).toBeNull()

  // It does not come back while the member stays signed in: another page, a reload.
  await page.goto('/#/settings/agents')
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible()
  await expect(dialogOf(page)).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible()
  await expect(dialogOf(page)).toHaveCount(0)
  expect((await meOf(page)).timezone).toBeNull()

  // It is shown again after the next sign-in.
  await page.getByRole('button', { name: /^Account menu:/ }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page.getByRole('main', { name: 'Log in' })).toBeVisible()
  const login = await context.request.post('/api/auth/login', { headers: H, data: { email, password: PASSWORD } })
  expect(login.status(), await login.text()).toBe(200)
  await page.goto('/')
  await expect(dialogOf(page)).toBeVisible()

  // Escape closes it the same way: nothing stored.
  await page.keyboard.press('Escape')
  await expect(dialogOf(page)).toHaveCount(0)
  expect((await meOf(page)).timezone).toBeNull()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'What do you want to learn?' })).toBeVisible()
  await expect(dialogOf(page)).toHaveCount(0)
})

test('Each user chooses a time zone > Change in Settings: Account saves a new zone and it is still shown after a reload', async ({
  browser,
}) => {
  const { page } = await newMember(browser, 'Europe/Berlin')
  await page.goto('/#/settings/account')
  await dialogOf(page).getByRole('button', { name: 'Save' }).click()
  await expect(dialogOf(page)).toHaveCount(0)

  const account = page.getByRole('region', { name: 'Account' })
  await expect(account.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible()
  const select = account.getByLabel('Time zone', { exact: true })
  await expect(select).toHaveValue('Europe/Berlin')
  // The Save rule: disabled until something changed.
  await expect(account.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect(account.getByRole('button', { name: 'Cancel' })).toBeDisabled()

  await select.selectOption('Asia/Tokyo')
  await expect(account.getByRole('button', { name: 'Save' })).toBeEnabled()
  // Cancel returns the field to the stored zone without saving.
  await account.getByRole('button', { name: 'Cancel' }).click()
  await expect(select).toHaveValue('Europe/Berlin')
  expect((await meOf(page)).timezone).toBe('Europe/Berlin')

  await select.selectOption('Asia/Tokyo')
  await page.emulateMedia({ colorScheme: 'light' })
  await shot(page, 'settings-account')
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, 'settings-account-dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await account.getByRole('button', { name: 'Save' }).click()
  await expect(account.getByText('Saved.')).toBeVisible()
  expect((await meOf(page)).timezone).toBe('Asia/Tokyo')

  await page.reload()
  await expect(page.getByRole('region', { name: 'Account' }).getByLabel('Time zone', { exact: true })).toHaveValue('Asia/Tokyo')
  await expect(dialogOf(page)).toHaveCount(0)
})

test('Each user chooses a time zone > Unknown name and Missing header: the API refuses and nothing changes', async ({ browser }) => {
  const { page } = await newMember(browser, 'Europe/Berlin')
  const ok = await page.request.put('/api/auth/timezone', { headers: H, data: { timezone: 'Europe/Paris' } })
  expect(ok.status(), await ok.text()).toBe(200)
  expect((await ok.json()).timezone).toBe('Europe/Paris')

  for (const bad of ['Mars/Olympus_Mons', '', 'x'.repeat(65)]) {
    const refused = await page.request.put('/api/auth/timezone', { headers: H, data: { timezone: bad } })
    expect(refused.status(), `name "${bad.slice(0, 20)}"`).toBe(422)
  }
  const none = await page.request.put('/api/auth/timezone', { headers: H, data: { timezone: null } })
  expect(none.status()).toBe(422)

  const noHeader = await page.request.put('/api/auth/timezone', { data: { timezone: 'Asia/Tokyo' } })
  expect(noHeader.status()).toBe(403)
  expect((await meOf(page)).timezone).toBe('Europe/Paris')

  // A signed-out client has no session.
  const anonymous = await playwrightRequest.newContext({ baseURL: APP, storageState: SIGNED_OUT })
  try {
    expect((await anonymous.put('/api/auth/timezone', { headers: H, data: { timezone: 'Asia/Tokyo' } })).status()).toBe(401)
  } finally {
    await anonymous.dispose()
  }
})

/** A working local provider for the member, then one chat message; returns the chat's last activity. */
async function chatOnce(page: Page): Promise<string> {
  const made = await page.request.post('/api/ai-providers', {
    headers: H,
    data: { name: `TZ own ${STAMP}-${counter++}`, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {} },
  })
  expect(made.status(), await made.text()).toBe(201)
  await page.goto('/')
  // A member without a zone is asked first: "Not now" keeps it without one.
  if (await dialogOf(page).isVisible()) await dialogOf(page).getByRole('button', { name: 'Not now' }).click()
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await expect(box).toBeVisible()
  await box.fill(`QC-tz hello ${STAMP}`)
  await box.press('Enter')
  await expect(agent.getByText('OK from fake')).toBeVisible({ timeout: 30_000 })
  const list = (await (await page.request.get('/api/agent/sessions?limit=20')).json()) as { sessions: Array<{ last_message_at: string }> }
  expect(list.sessions.length).toBeGreaterThan(0)
  return list.sessions[0].last_message_at
}

const inZone = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso))

async function historyMeta(page: Page): Promise<string> {
  const agent = page.getByRole('complementary', { name: 'Agent' })
  await agent.getByRole('button', { name: 'History' }).click()
  const row = agent.getByRole('region', { name: 'Chat history' }).locator('.history-row').first()
  await expect(row).toBeVisible()
  return (await row.innerText()).replace(/\s+/g, ' ')
}

test('Times are shown in the user\'s time zone > Chosen zone: the chat history shows the time in the stored zone, not the browser zone', async ({
  browser,
}) => {
  // The browser is set to UTC; the member chose Asia/Tokyo (9 hours ahead, no daylight saving).
  const { page } = await newMember(browser, 'UTC')
  const set = await page.request.put('/api/auth/timezone', { headers: H, data: { timezone: 'Asia/Tokyo' } })
  expect(set.status(), await set.text()).toBe(200)
  const at = await chatOnce(page)
  const tokyo = inZone(at, 'Asia/Tokyo')
  const utc = inZone(at, 'UTC')
  expect(tokyo).not.toBe(utc)
  const meta = await historyMeta(page)
  expect(meta).toContain(tokyo)
  expect(meta).not.toContain(utc)
  await shot(page, 'timezone-history-chosen')
})

test('Times are shown in the user\'s time zone > No zone yet: the chat history shows the time in the browser zone', async ({ browser }) => {
  const { page } = await newMember(browser, 'America/New_York')
  const at = await chatOnce(page)
  // No zone stored (the dialog was closed with "Not now"): the browser's zone applies.
  expect((await meOf(page)).timezone).toBeNull()
  const meta = await historyMeta(page)
  expect(meta).toContain(inZone(at, 'America/New_York'))
  expect(inZone(at, 'America/New_York')).not.toBe(inZone(at, 'UTC'))
  await shot(page, 'timezone-history-browser')
})
