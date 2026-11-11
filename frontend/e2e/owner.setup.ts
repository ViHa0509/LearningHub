/**
 * Runs before every other e2e test (project "setup"): the database is empty after the global
 * setup, so this creates the Owner through the create-owner page, opens the verification link
 * from the outbox in the same browser, and saves that browser's signed-in state, which the "app"
 * project uses for all its tests.
 */
import { expect, test as setup } from '@playwright/test'
import { OWNER, OWNER_STATE } from '../playwright.config.ts'
import { nextOutboxToken } from './outbox.ts'

export { outboxToken } from './outbox.ts'

const H = { 'X-LearningHub': '1' }

setup('create the Owner and save its session', async ({ request, page }) => {
  const status = await (await request.get('/api/auth/status')).json()
  expect(status.auth_required).toBe(true)
  expect(status.has_owner).toBe(false)

  // First visit (spec: "First visit"): the app offers to create the owner account, with email
  // and password, GitHub (configured on the fake provider) or Google (not configured).
  await page.goto('/')
  const create = page.getByRole('main', { name: 'Create the admin account' })
  await expect(create.getByRole('heading', { name: 'Create the admin account' })).toBeVisible()
  for (const label of ['Email', 'Password', 'Confirm password']) {
    await expect(create.getByLabel(label, { exact: true })).toBeVisible()
  }
  await expect(create.getByRole('button', { name: 'Create account' })).toBeEnabled()
  await expect(create.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible()
  await expect(create.getByRole('button', { name: 'Continue with Google' })).toBeDisabled()
  await page.screenshot({ path: 'e2e-results/screens/auth-create-owner.png', fullPage: true })

  // The Owner is created through that form, in this browser, which is then signed in.
  await create.getByLabel('Display name (optional)', { exact: true }).fill(OWNER.name)
  await create.getByLabel('Email', { exact: true }).fill(OWNER.email)
  await create.getByLabel('Password', { exact: true }).fill(OWNER.password)
  await create.getByLabel('Confirm password', { exact: true }).fill(OWNER.password)
  await create.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: `Account menu: ${OWNER.name}` })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'What do you want to learn?' })).toBeVisible()
  const refused = await request.post('/api/auth/signup', {
    headers: H,
    data: { email: 'second@example.test', password: 'second-owner-password' },
  })
  expect(refused.status()).toBe(403)

  // The sign-up email's link, opened in a browser (spec: "Verify email"). This is the only fresh
  // verification link of the run: once verified, a resend sends none.
  const token = await nextOutboxToken('verify')
  await page.goto(`/#/auth/verify?token=${token}`)
  await expect(page.getByRole('heading', { name: 'Your email is verified' })).toBeVisible()
  await expect(page.getByText('You can now sign in with an email link.')).toBeVisible()
  // The token leaves the address bar once used.
  await expect(page).toHaveURL(/#\/auth\/verify$/)
  await page.screenshot({ path: 'e2e-results/screens/auth-verify-email.png', fullPage: true })
  const me = await (await page.request.get('/api/auth/me')).json()
  expect(me.email).toBe(OWNER.email)
  expect(me.display_name).toBe(OWNER.name)
  expect(me.email_verified).toBe(true)

  // The saved state is this browser's (the session cookie), as for an Owner coming back to the app.
  await page.goto('/#/')
  await expect(page.getByRole('button', { name: `Account menu: ${OWNER.name}` })).toBeVisible({ timeout: 15_000 })
  await page.context().storageState({ path: OWNER_STATE })
})
