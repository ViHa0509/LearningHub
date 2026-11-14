/**
 * Spec checks for the change open-signup (openspec/changes/open-signup/specs/accounts): after the admin
 * exists, a visitor signs up on the Sign up page, lands signed in as a member with none of the admin's
 * data, and a used email is refused. The account is removed again afterwards.
 */
import { expect, test, type Page } from '@playwright/test'
import { OWNER, OWNER_STATE } from '../playwright.config.ts'

const APP = 'http://127.0.0.1:5174'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const STAMP = Date.now().toString(36)
const NEW = { email: `signup-${STAMP}@example.test`, password: 'signup-password-1', name: 'New Member' }
const NOTE_TITLE = `QC-signup admin note ${STAMP}`

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.afterAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    const users = (await (await admin.get('/api/admin/users')).json()) as Array<{ id: string; email: string }>
    const found = users.find((u) => u.email === NEW.email)
    if (found) await admin.delete(`/api/admin/users/${found.id}`, { headers: H, data: { confirm_email: NEW.email } })
    const notes = (await (await admin.get('/api/notes')).json()) as Array<{ id: string; title: string }>
    for (const note of notes.filter((n) => n.title === NOTE_TITLE)) await admin.delete(`/api/notes/${note.id}`, { headers: H })
  } finally {
    await admin.dispose()
  }
})

test('Sign up page: a visitor creates a member account, lands in the app and sees none of the admin data', async ({
  page,
  browser,
}) => {
  // The admin has a note the new member must not see.
  const imported = await page.request.post('/api/notes/import', {
    headers: H,
    multipart: { files: { name: 'signup-note.html', mimeType: 'text/html', buffer: Buffer.from(`<title>${NOTE_TITLE}</title><p>x</p>`) } },
  })
  expect(imported.status(), await imported.text()).toBe(200)

  const context = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
  try {
    const visitor = await context.newPage()
    await visitor.goto('/#/')
    const login = visitor.getByRole('main', { name: 'Log in' })
    await login.getByRole('link', { name: 'Create an account' }).click()
    const form = visitor.getByRole('main', { name: 'Sign up' })
    await expect(form).toBeVisible()
    await expect(form.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible()
    await visitor.emulateMedia({ colorScheme: 'light' })
    await shot(visitor, 'signup-page')
    await visitor.emulateMedia({ colorScheme: 'dark' })
    await shot(visitor, 'signup-page-dark')
    await visitor.emulateMedia({ colorScheme: 'light' })

    // Scenario: Email already used.
    await form.getByLabel('Email').fill(OWNER.email)
    await form.getByLabel('Password', { exact: true }).fill(NEW.password)
    await form.getByLabel('Confirm password').fill(NEW.password)
    await form.getByRole('button', { name: 'Create account' }).click()
    await expect(form.getByRole('alert')).toHaveText('An account with this email already exists')

    // Scenario: Sign up with a password.
    await form.getByLabel('Display name (optional)').fill(NEW.name)
    await form.getByLabel('Email').fill(NEW.email)
    await form.getByRole('button', { name: 'Create account' }).click()
    await expect(visitor.getByRole('button', { name: `Account menu: ${NEW.name}` })).toBeVisible({ timeout: 30_000 })
    const me = await (await visitor.request.get('/api/auth/me')).json()
    expect(me).toMatchObject({ email: NEW.email, role: 'member', email_verified: false })
    const notes = (await (await visitor.request.get('/api/notes')).json()) as Array<{ title: string }>
    expect(notes.map((n) => n.title)).not.toContain(NOTE_TITLE)
    await expect(visitor.getByRole('complementary', { name: 'Learned items' })).not.toContainText(NOTE_TITLE)
    // A member sees no admin-only settings.
    expect((await visitor.request.get('/api/admin/users')).status()).toBe(403)
  } finally {
    await context.close()
  }
})
