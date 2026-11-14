/**
 * Spec checks for the change multi-user (openspec/changes/multi-user/specs/accounts): the admin
 * invites a member from Settings -> Users (no SMTP: the link is shown on the page with Copy, and
 * the mail lands in the outbox), the member accepts in a browser of their own, data stays separate
 * per user, members see no admin-only features, disable / enable / delete, used and revoked
 * invitation links, and GitHub sign-in through the fake provider with and without an invitation.
 *
 * The admin is the account owner.setup.ts creates (the default storage state). Every account,
 * note and provider made here is removed in afterAll, so later files see only the admin's data.
 */
import { expect as baseExpect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { OWNER, OWNER_STATE } from '../playwright.config.ts'
import { nextOutboxToken, latestOutboxToken } from './outbox.ts'

// Several browsers per test (admin and member): slow under the full suite's load.
test.describe.configure({ mode: 'serial', timeout: 180_000 })
// Two signed-in browsers and their reloads: the backend answers in seconds under the full suite's load.
const expect = baseExpect.configure({ timeout: 30_000 })

const APP = 'http://127.0.0.1:5174'
const FAKE = 'http://127.0.0.1:8002'
const FAKE_LLM = `${FAKE}/v1`
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const STAMP = Date.now().toString(36)

const MEMBER = { email: `member-${STAMP}@example.test`, password: 'e2e-member-password-1', name: 'E2E Member' }
const GH_INVITED = `gh-member-${STAMP}@example.test`
const GH_STRANGER = `gh-stranger-${STAMP}@example.test`
const REVOKED = `revoked-${STAMP}@example.test`

const INVITE_GONE = 'This invitation has expired or was already used.'
const CLAUDE_CODE = 'Claude Code (subscription)'

const ADMIN_NOTE_TITLE = `QC-members admin note ${STAMP}`
const MEMBER_NOTE_TITLE = `QC-members member note ${STAMP}`

interface ApiNote {
  id: string
  title: string
}
interface ApiUser {
  id: string
  email: string
  role: string
  disabled: boolean
}

/** Filled while the serial tests run; afterAll cleans up from these. */
const state: {
  memberContext: BrowserContext | null
  memberPage: Page | null
  adminNote: ApiNote | null
  memberNote: ApiNote | null
  adminProvider: string | null
  inviteToken: string | null
} = { memberContext: null, memberPage: null, adminNote: null, memberNote: null, adminProvider: null, inviteToken: null }

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

function freshBrowser(browser: Browser) {
  return browser.newContext({ baseURL: APP, storageState: SIGNED_OUT })
}

function noteHtml(title: string, marker: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${marker}</p></body></html>`
}

async function importNote(request: APIRequestContext, title: string, html: string, outcome = 'created') {
  const res = await request.post('/api/notes/import', {
    headers: H,
    multipart: { files: { name: `${title.replace(/ /g, '_')}.html`, mimeType: 'text/html', buffer: Buffer.from(html) } },
  })
  expect(res.status(), await res.text()).toBe(200)
  const body = await res.json()
  expect(body.results[0].outcome).toBe(outcome)
  const note = body.results[0].note as ApiNote
  const linked = await request.patch(`/api/notes/${note.id}`, { headers: H, data: { node_id: 'backend/redis' } })
  expect(linked.status(), await linked.text()).toBe(200)
  return (await linked.json()) as ApiNote
}

async function users(request: APIRequestContext): Promise<ApiUser[]> {
  const res = await request.get('/api/admin/users')
  expect(res.status()).toBe(200)
  return res.json()
}

async function userByEmail(request: APIRequestContext, email: string): Promise<ApiUser | undefined> {
  return (await users(request)).find((u) => u.email === email)
}

function usersRow(page: Page, email: string) {
  // By the exact email cell: one address can be part of another (member-x@ in gh-member-x@).
  return page
    .getByRole('region', { name: 'All users' })
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: email, exact: true }) })
}

/** Opens Settings -> Users and waits until the users table has loaded (slow under the full suite's load). */
async function openUsers(page: Page) {
  await page.goto('/#/settings/users')
  await expect(usersRow(page, OWNER.email)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Pending invitations' }).getByRole('heading')).toBeVisible()
}

/** The member's page, signed in in its own browser (made by the accept test). */
function memberPage(): Page {
  expect(state.memberPage, 'the member accepted the invitation first').not.toBeNull()
  return state.memberPage!
}

test.afterAll(async ({ playwright }) => {
  // Cleanup must finish even when the backend is slow, or later files see this file's data.
  test.setTimeout(120_000)
  // A request context with the admin's session.
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    for (const email of [MEMBER.email, GH_INVITED, GH_STRANGER]) {
      const found = (await (await admin.get('/api/admin/users')).json() as ApiUser[]).find((u) => u.email === email)
      if (found) await admin.delete(`/api/admin/users/${found.id}`, { headers: H, data: { confirm_email: email } })
    }
    const pending = (await (await admin.get('/api/admin/invitations')).json()) as Array<{ id: string; email: string }>
    for (const invitation of pending) {
      if (invitation.email.endsWith(`${STAMP}@example.test`)) {
        await admin.delete(`/api/admin/invitations/${invitation.id}`, { headers: H })
      }
    }
    if (state.adminNote) await admin.delete(`/api/notes/${state.adminNote.id}`, { headers: H })
    if (state.adminProvider) await admin.delete(`/api/ai-providers/${state.adminProvider}`, { headers: H })
    await admin.post(`${FAKE}/oauth-control`, { data: {} })
  } finally {
    await admin.dispose()
    await state.memberContext?.close()
  }
})

test('the admin invites a member from Settings -> Users; the link shows with Copy and the mail is in the outbox', async ({
  page,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP })
  const previous = latestOutboxToken('invite')
  await page.goto('/#/settings')
  const nav = page.getByRole('navigation', { name: 'Settings sections' })
  await expect(nav.getByRole('link')).toHaveText(['AI providers', 'Users', 'Sign-in', 'Data & sync'])
  await nav.getByRole('link', { name: 'Users' }).click()
  await expect(page).toHaveURL(/#\/settings\/users$/)
  const usersPage = page.getByRole('region', { name: 'Users' })
  await expect(usersPage.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible()
  // The admin's own row: marked "You", no actions.
  const own = usersRow(page, OWNER.email)
  await expect(own).toContainText('Admin')
  await expect(own.getByText('You', { exact: true })).toBeVisible()
  await expect(own.getByRole('button')).toHaveCount(0)

  const invite = page.getByRole('region', { name: 'Invite' })
  const send = invite.getByRole('button', { name: 'Send invitation' })
  await expect(send).toBeDisabled()
  await invite.getByLabel('Email', { exact: true }).fill(MEMBER.email)
  await expect(send).toBeEnabled()
  await send.click()

  const sent = invite.getByRole('status')
  await expect(sent).toContainText(`Invitation sent to ${MEMBER.email}`)
  await expect(sent).toContainText(`No email server is set up: send this link to ${MEMBER.email}.`)
  const linkBox = invite.getByLabel('Invitation link', { exact: true })
  const link = await linkBox.inputValue()
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:5174\/#\/auth\/invite\?token=[A-Za-z0-9_-]+$/)
  await invite.getByRole('button', { name: 'Copy' }).click()
  await expect(invite.getByText('Copied', { exact: true })).toBeVisible()
  expect(await page.evaluate('navigator.clipboard.readText()')).toBe(link)

  // The pending invitation is listed, with Revoke.
  const pending = page.getByRole('region', { name: 'Pending invitations' })
  await expect(pending.getByText(MEMBER.email, { exact: true })).toBeVisible()
  await expect(pending.getByRole('button', { name: `Revoke ${MEMBER.email}` })).toBeVisible()
  await shot(page, 'users-invited')

  // The mail went to the outbox (no SMTP) and carries the same link.
  const token = await nextOutboxToken('invite', previous)
  expect(link.endsWith(`token=${token}`)).toBe(true)
  state.inviteToken = token

  // Inviting an email that already has an account is refused.
  const taken = await page.request.post('/api/admin/invitations', { headers: H, data: { email: OWNER.email } })
  expect(taken.status()).toBe(409)
})

test('the member accepts in a fresh browser, sets a password and lands signed in as Member; the link works once', async ({
  browser,
}) => {
  expect(state.inviteToken).not.toBeNull()
  const context = await freshBrowser(browser)
  state.memberContext = context
  const page = await context.newPage()
  state.memberPage = page
  await page.goto(`/#/auth/invite?token=${state.inviteToken}`)
  const card = page.getByRole('main', { name: 'Join Learning Hub' })
  await expect(card.getByRole('heading', { name: 'Join Learning Hub' })).toBeVisible()
  await expect(card.getByText(`You were invited as ${MEMBER.email}`)).toBeVisible()
  // GitHub is configured on this server: offered with the verified-email hint.
  await expect(card.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible()
  await expect(card.getByText(`Use an account whose verified email is ${MEMBER.email}.`)).toBeVisible()
  await shot(page, 'invite-accept')

  await card.getByLabel('Display name (optional)', { exact: true }).fill(MEMBER.name)
  await card.getByLabel('Password', { exact: true }).fill(MEMBER.password)
  await card.getByLabel('Confirm password', { exact: true }).fill(MEMBER.password)
  await card.getByRole('button', { name: 'Create account' }).click()

  const account = page.getByRole('button', { name: `Account menu: ${MEMBER.name}` })
  await expect(account).toBeVisible({ timeout: 30_000 })
  await expect(page).not.toHaveURL(/token=/)
  await account.click()
  await expect(page.getByText(MEMBER.email, { exact: true })).toBeVisible()
  await expect(page.locator('.account-popover').getByText('Member', { exact: true })).toBeVisible()
  await shot(page, 'account-menu-member')
  await page.keyboard.press('Escape')

  const me = await (await page.request.get('/api/auth/me')).json()
  expect(me).toMatchObject({ email: MEMBER.email, role: 'member', display_name: MEMBER.name })

  // Used once: the same link, in another browser, is refused and creates nothing.
  const other = await freshBrowser(browser)
  try {
    const again = await other.newPage()
    await again.goto(`/#/auth/invite?token=${state.inviteToken}`)
    const refused = again.getByRole('main', { name: 'Invitation not accepted' })
    await expect(refused.getByRole('alert')).toHaveText(INVITE_GONE)
    await expect(refused.getByRole('link', { name: 'Back to log in' })).toBeVisible()
    await shot(again, 'invite-used')
    expect((await again.request.get(`/api/auth/invitation?token=${state.inviteToken}`)).status()).toBe(404)
    const reuse = await again.request.post('/api/auth/invitation/accept', {
      headers: H,
      data: { token: state.inviteToken, password: 'another-password-123' },
    })
    expect(reuse.status()).toBe(404)
    expect((await again.request.get('/api/auth/me')).status()).toBe(401)
  } finally {
    await other.close()
  }
})

test('a revoked invitation link is refused', async ({ page, browser }) => {
  const previous = latestOutboxToken('invite')
  const created = await page.request.post('/api/admin/invitations', { headers: H, data: { email: REVOKED } })
  expect(created.status(), await created.text()).toBe(201)
  const token = await nextOutboxToken('invite', previous)

  await openUsers(page)
  const pending = page.getByRole('region', { name: 'Pending invitations' })
  page.once('dialog', (dialog) => void dialog.accept())
  await pending.getByRole('button', { name: `Revoke ${REVOKED}` }).click()
  await expect(pending.getByText(REVOKED, { exact: true })).toHaveCount(0)

  const other = await freshBrowser(browser)
  try {
    const visitor = await other.newPage()
    await visitor.goto(`/#/auth/invite?token=${token}`)
    const refused = visitor.getByRole('main', { name: 'Invitation not accepted' })
    await expect(refused.getByRole('alert')).toHaveText(INVITE_GONE)
    expect((await visitor.request.get('/api/auth/me')).status()).toBe(401)
  } finally {
    await other.close()
  }
  expect(await userByEmail(page.request, REVOKED)).toBeUndefined()
})

test('a member sees no Users and no Sign-in in Settings, gets "Admin only" on a direct visit, 403 from the admin routes, and no Claude Code type', async () => {
  const page = memberPage()
  await page.goto('/#/settings')
  const nav = page.getByRole('navigation', { name: 'Settings sections' })
  await expect(nav.getByRole('link')).toHaveText(['AI providers', 'Data & sync'])
  // The member's own provider list is empty (the admin's providers are not theirs).
  await expect(page.getByText('No providers yet. Add one to use the agent.')).toBeVisible()
  expect(await (await page.request.get('/api/ai-providers')).json()).toEqual([])
  await shot(page, 'settings-member')

  for (const address of ['/#/settings/users', '/#/settings/sign-in']) {
    await page.goto(address)
    const refused = page.getByRole('region', { name: 'Admin only' })
    await expect(refused.getByRole('heading', { name: 'Admin only' })).toBeVisible()
    await expect(refused.getByText('Only the admin can open this page.')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Users' })).toHaveCount(0)
  }
  await shot(page, 'settings-admin-only')

  for (const path of ['/api/admin/users', '/api/admin/invitations']) {
    expect((await page.request.get(path)).status()).toBe(403)
  }
  expect(
    (await page.request.post('/api/admin/invitations', { headers: H, data: { email: `x-${STAMP}@example.test` } })).status(),
  ).toBe(403)

  // The provider form offers no Claude Code type; the API refuses it.
  await page.goto('/#/settings/providers/new')
  const types = page.getByRole('radiogroup', { name: 'Provider type' })
  await expect(types.getByRole('radio').first()).toBeAttached()
  await expect(types.getByRole('radio', { name: CLAUDE_CODE, exact: true })).toHaveCount(0)
  const listed = (await (await page.request.get('/api/ai-providers/types')).json()) as Array<{ type: string }>
  expect(listed.map((t) => t.type)).not.toContain('claude-code')
  const refused = await page.request.post('/api/ai-providers', {
    headers: H,
    data: { name: `CC ${STAMP}`, provider_type: 'claude-code', model_name: 'sonnet', config: {} },
  })
  expect(refused.status()).toBe(403)
})

test("notes are separate: the admin's note is not in the member's list and opens as not found, and the other way round", async ({
  page,
}) => {
  const member = memberPage()
  const html = noteHtml(ADMIN_NOTE_TITLE, `shared content ${STAMP}`)
  state.adminNote = await importNote(page.request, ADMIN_NOTE_TITLE, html)

  // The member lists their notes: the admin's is not there, and its id answers 404.
  const memberNotes = (await (await member.request.get('/api/notes')).json()) as ApiNote[]
  expect(memberNotes.map((n) => n.id)).not.toContain(state.adminNote.id)
  expect((await member.request.get(`/api/notes/${state.adminNote.id}`)).status()).toBe(404)
  const rename = await member.request.patch(`/api/notes/${state.adminNote.id}`, { headers: H, data: { title: 'Taken' } })
  expect(rename.status()).toBe(404)
  expect((await member.request.delete(`/api/notes/${state.adminNote.id}`, { headers: H })).status()).toBe(404)

  await member.goto('/')
  const list = member.getByRole('complementary', { name: 'Learned items' })
  // Loaded (the list waits for the notes and every roadmap; slow under the full suite's load):
  // the member has no notes of their own yet.
  await expect(list.getByRole('heading', { name: 'Nothing learned yet' })).toBeVisible({ timeout: 30_000 })
  await expect(list.getByRole('button', { name: ADMIN_NOTE_TITLE, exact: true })).toHaveCount(0)
  await member.goto(`/#/note/${state.adminNote.id}`)
  await expect(member.getByRole('region', { name: 'Note not found' })).toBeVisible({ timeout: 30_000 })
  await shot(member, 'member-admin-note-not-found')

  // The member imports the same file through the dialog: not a duplicate for them.
  await member.goto('/')
  await member.getByRole('button', { name: 'Import HTML or PDF files' }).click()
  const dialog = member.getByRole('dialog', { name: 'Import HTML or PDF files' })
  const sameName = `${ADMIN_NOTE_TITLE.replace(/ /g, '_')}.html`
  await dialog.getByLabel('HTML or PDF files').setInputFiles({ name: sameName, mimeType: 'text/html', buffer: Buffer.from(html) })
  await dialog.getByRole('combobox', { name: `Roadmap node for ${sameName}` }).selectOption('backend/redis')
  await dialog.getByRole('button', { name: 'Done' }).click()
  // Done saves the node first; under the full suite's load the import and save take seconds.
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect(list.getByRole('button', { name: ADMIN_NOTE_TITLE, exact: true })).toBeVisible({ timeout: 30_000 })
  const mine = ((await (await member.request.get('/api/notes')).json()) as ApiNote[]).find(
    (n) => n.title === ADMIN_NOTE_TITLE,
  )
  expect(mine).toBeDefined()
  expect(mine!.id).not.toBe(state.adminNote.id)
  // Renamed, so the two users' notes are told apart below.
  const renamed = await member.request.patch(`/api/notes/${mine!.id}`, { headers: H, data: { title: MEMBER_NOTE_TITLE } })
  expect(renamed.status()).toBe(200)
  state.memberNote = { id: mine!.id, title: MEMBER_NOTE_TITLE }

  // The admin does not see the member's note; its id opens as not found.
  const adminNotes = (await (await page.request.get('/api/notes')).json()) as ApiNote[]
  expect(adminNotes.map((n) => n.id)).not.toContain(state.memberNote.id)
  expect(adminNotes.map((n) => n.title)).toContain(ADMIN_NOTE_TITLE)
  expect((await page.request.get(`/api/notes/${state.memberNote.id}`)).status()).toBe(404)
  await page.goto('/')
  const adminList = page.getByRole('complementary', { name: 'Learned items' })
  await expect(adminList.getByRole('button', { name: ADMIN_NOTE_TITLE, exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(adminList.getByRole('button', { name: MEMBER_NOTE_TITLE, exact: true })).toHaveCount(0)
  await page.goto(`/#/note/${state.memberNote.id}`)
  await expect(page.getByRole('region', { name: 'Note not found' })).toBeVisible({ timeout: 30_000 })

  // Deleting the admin's note leaves the member's copy of the same file readable.
  expect((await page.request.delete(`/api/notes/${state.adminNote.id}`, { headers: H })).status()).toBe(204)
  state.adminNote = null
  const original = await member.request.get(`/api/notes/${state.memberNote.id}/original`)
  expect(original.status()).toBe(200)
  expect(await original.text()).toContain(`shared content ${STAMP}`)
  // The admin's note again, for the delete test (admin data must survive the member's delete).
  state.adminNote = await importNote(page.request, ADMIN_NOTE_TITLE, html)

  // Lessons are per user too: what the member writes is not the admin's lesson.
  const written = await member.request.put('/api/lessons/devops/terraform', {
    headers: H,
    data: { body: `Member lesson ${STAMP}` },
  })
  expect(written.status(), await written.text()).toBe(200)
  const adminLesson = await (await page.request.get('/api/lessons/devops/terraform')).json()
  expect(JSON.stringify(adminLesson)).not.toContain(`Member lesson ${STAMP}`)
})

test("the member chats with their own provider; the admin's provider is not visible to them", async ({ page }) => {
  const member = memberPage()
  const adminProvider = await page.request.post('/api/ai-providers', {
    headers: H,
    data: { name: `Admin private ${STAMP}`, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE_LLM, config: {} },
  })
  expect(adminProvider.status(), await adminProvider.text()).toBe(201)
  state.adminProvider = (await adminProvider.json()).id

  const own = await member.request.post('/api/ai-providers', {
    headers: H,
    data: { name: `Member own ${STAMP}`, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE_LLM, config: {} },
  })
  expect(own.status(), await own.text()).toBe(201)
  const ownId = (await own.json()).id as string
  const listed = (await (await member.request.get('/api/ai-providers')).json()) as Array<{ id: string; name: string }>
  expect(listed.map((p) => p.id)).toEqual([ownId])
  expect((await member.request.get(`/api/ai-providers/${state.adminProvider}`)).status()).toBe(404)
  // Assigning the admin's provider is refused; the member's own one works.
  const foreign = await member.request.put('/api/agents/assistant/provider', {
    headers: H,
    data: { primary_provider_id: state.adminProvider, fallback_provider_id: null },
  })
  expect(foreign.status()).toBe(404)
  const assigned = await member.request.put('/api/agents/assistant/provider', {
    headers: H,
    data: { primary_provider_id: ownId, fallback_provider_id: null },
  })
  expect(assigned.status(), await assigned.text()).toBe(200)

  // Created through the API: reload so the page reads the lists again.
  await member.goto('/#/settings')
  await member.reload()
  await expect(member.getByText(`Member own ${STAMP}`).first()).toBeVisible()
  await expect(member.getByText(`Admin private ${STAMP}`)).toHaveCount(0)

  await member.goto('/')
  const agent = member.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await box.fill('Hello from the member')
  await box.press('Enter')
  const log = agent.getByRole('log', { name: 'Conversation' })
  await expect(log.getByText('OK from fake')).toBeVisible({ timeout: 30_000 })
  await expect(log.locator('.agent-caption')).toContainText(`Member own ${STAMP} · fake-ok`)
  await shot(member, 'member-chat')
})

test('disabling the member shows them the login page and refuses their sign-in; enabling lets them back in', async ({
  page,
}) => {
  const member = memberPage()
  await openUsers(page)
  const row = usersRow(page, MEMBER.email)
  await expect(row).toContainText('Member')
  await expect(row).toContainText('Active')
  page.once('dialog', (dialog) => void dialog.accept())
  await row.getByRole('button', { name: `Disable ${MEMBER.email}` }).click()
  await expect(row).toContainText('Disabled')
  await expect(row.getByRole('button', { name: `Enable ${MEMBER.email}` })).toBeVisible()
  await shot(page, 'users-disabled')

  // The member's next request is answered 401, and the app shows the login page.
  expect((await member.request.get('/api/notes')).status()).toBe(401)
  await member.goto('/#/settings')
  const login = member.getByRole('main', { name: 'Log in' })
  await expect(login.getByRole('heading', { name: 'Log in' })).toBeVisible({ timeout: 30_000 })
  await expect(member.getByRole('button', { name: `Account menu: ${MEMBER.name}` })).toHaveCount(0)

  // Signing in again is refused.
  await login.getByLabel('Email', { exact: true }).fill(MEMBER.email)
  await login.getByLabel('Password', { exact: true }).fill(MEMBER.password)
  await login.getByRole('button', { name: 'Log in' }).click()
  await expect(login.getByRole('alert')).toContainText('This account is disabled')
  expect((await member.request.get('/api/auth/me')).status()).toBe(401)
  await shot(member, 'login-disabled')

  // Enabled again: the member can sign in.
  page.once('dialog', (dialog) => void dialog.accept())
  await row.getByRole('button', { name: `Enable ${MEMBER.email}` }).click()
  await expect(row).toContainText('Active')
  await login.getByRole('button', { name: 'Log in' }).click()
  await expect(member.getByRole('button', { name: `Account menu: ${MEMBER.name}` })).toBeVisible({ timeout: 30_000 })
  expect((await member.request.get('/api/notes')).status()).toBe(200)
})

test('GitHub sign-in: an invited email becomes a member; an email without an invitation signs up a member too', async ({
  page,
  browser,
}) => {
  const previous = latestOutboxToken('invite')
  const created = await page.request.post('/api/admin/invitations', { headers: H, data: { email: GH_INVITED } })
  expect(created.status(), await created.text()).toBe(201)
  await nextOutboxToken('invite', previous)

  try {
    // Invited: the fake GitHub reports that verified email with a new GitHub user id.
    expect((await page.request.post(`${FAKE}/oauth-control`, { data: { email: GH_INVITED, user_id: 880001 } })).ok()).toBe(true)
    const invited = await freshBrowser(browser)
    try {
      const visitor = await invited.newPage()
      await visitor.goto('/#/')
      await visitor.getByRole('main', { name: 'Log in' }).getByRole('link', { name: 'Continue with GitHub' }).click()
      await expect(visitor.getByRole('button', { name: /^Account menu: / })).toBeVisible({ timeout: 30_000 })
      const me = await (await visitor.request.get('/api/auth/me')).json()
      expect(me).toMatchObject({ email: GH_INVITED, role: 'member' })
      expect(me.linked).toContain('github')
    } finally {
      await invited.close()
    }
    const ghUser = await userByEmail(page.request, GH_INVITED)
    expect(ghUser?.role).toBe('member')
    const pending = (await (await page.request.get('/api/admin/invitations')).json()) as Array<{ email: string }>
    expect(pending.map((i) => i.email)).not.toContain(GH_INVITED)

    // Not invited (open-signup): a member account is created for the verified email.
    expect((await page.request.post(`${FAKE}/oauth-control`, { data: { email: GH_STRANGER, user_id: 880002 } })).ok()).toBe(true)
    const stranger = await freshBrowser(browser)
    try {
      const visitor = await stranger.newPage()
      await visitor.goto('/#/')
      await visitor.getByRole('main', { name: 'Log in' }).getByRole('link', { name: 'Continue with GitHub' }).click()
      await expect(visitor.getByRole('button', { name: /^Account menu: / })).toBeVisible({ timeout: 30_000 })
      expect(await (await visitor.request.get('/api/auth/me')).json()).toMatchObject({ email: GH_STRANGER, role: 'member' })
    } finally {
      await stranger.close()
    }
    expect((await userByEmail(page.request, GH_STRANGER))?.role).toBe('member')
  } finally {
    await page.request.post(`${FAKE}/oauth-control`, { data: {} })
  }

  // A password sign-up with that email is refused now that the account exists.
  const signup = await page.request.post('/api/auth/signup', {
    headers: H,
    data: { email: GH_STRANGER, password: 'stranger-password-1' },
  })
  expect(signup.status()).toBe(409)
  expect((await signup.json()).detail).toBe('An account with this email already exists')
})

test("deleting the member after typing their email removes them; the admin's data stays", async ({ page }) => {
  const member = memberPage()
  expect(state.adminNote).not.toBeNull()
  await openUsers(page)
  const row = usersRow(page, MEMBER.email)
  await row.getByRole('button', { name: `Delete ${MEMBER.email}` }).click()
  const box = page.getByRole('dialog', { name: `Delete ${MEMBER.email}` })
  const confirm = box.getByRole('button', { name: 'Delete user' })
  await expect(confirm).toBeDisabled()
  await box.getByLabel('Type the email to confirm').fill('wrong@example.test')
  await expect(confirm).toBeDisabled()
  await box.getByLabel('Type the email to confirm').fill(MEMBER.email)
  await expect(confirm).toBeEnabled()
  await shot(page, 'users-delete')
  await confirm.click()
  await expect(usersRow(page, MEMBER.email)).toHaveCount(0)
  expect(await userByEmail(page.request, MEMBER.email)).toBeUndefined()

  // The member's session and login are gone.
  expect((await member.request.get('/api/notes')).status()).toBe(401)
  const again = await member.request.post('/api/auth/login', {
    headers: H,
    data: { email: MEMBER.email, password: MEMBER.password },
  })
  expect(again.status()).toBe(401)

  // The admin's note is intact and still opens.
  const note = await page.request.get(`/api/notes/${state.adminNote!.id}`)
  expect(note.status()).toBe(200)
  expect((await note.json()).title).toBe(ADMIN_NOTE_TITLE)
  const original = await page.request.get(`/api/notes/${state.adminNote!.id}/original`)
  expect(original.status()).toBe(200)
  expect((await page.request.get(`/api/ai-providers/${state.adminProvider}`)).status()).toBe(200)
})
