/**
 * Spec checks for the change notifications (openspec/changes/notifications/specs/notifications):
 * the bell and its list, private and safe text, arrival without reload, and the triggers the e2e
 * setup can make: new member, lesson ready, shared limit, provider problem, field published,
 * new sign-in, restore and sync upload.
 *
 * The admin is the account owner.setup.ts creates; members are made through the sign-up API in a
 * browser context of their own (time zone UTC, so the zone dialog stays away). Providers point at the
 * fake LLM server (port 8002; the fake model names fake-401 / fake-429 give an invalid key and a rate
 * limit). The lesson trigger is "[[lesson:<node>]]" in e2e/fake_llm.py. The shared daily limit is the
 * backend default (read from GET /api/agents/shared). The admin account collects notices from every
 * other file of the suite, so each test starts with the admin's notices all read.
 *
 * Not testable end to end (covered by backend/tests/test_notifications_*.py):
 *   - "Over 200" / 90 days retention (200 rows per user; the clock cannot move in a running server);
 *   - "99+" (needs 100 unread rows: covered by NotificationBell.test.tsx);
 *   - Knowledge Hub reconnect: the fake KH is reachable only through the KH connect flow (kh-connector.e2e.ts),
 *     whose state this file would have to disturb; backend/tests/test_notifications_triggers.py covers it;
 *   - the 10-minute new-account window is worked around by backdating the member's created_at directly
 *     in the e2e database (a clock cannot be moved in a running server).
 */
import { expect as baseExpect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { E2E_ENV, OWNER_STATE, venvBin } from '../playwright.config.ts'

test.describe.configure({ mode: 'serial', timeout: 180_000 })
const expect = baseExpect.configure({ timeout: 20_000 })

const APP = 'http://127.0.0.1:5174'
const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const STAMP = Date.now().toString(36)
const MEMBER_PW = `${STAMP}-member-pw-1`
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'

let counter = 0
const emails: string[] = []
const contexts: BrowserContext[] = []
const providerNames = new Set<string>()
const fieldTitles: string[] = []

interface Note {
  id: string
  kind: string
  params: Record<string, unknown>
  link: string
  read_at: string | null
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

async function shotBoth(page: Page, name: string) {
  await page.emulateMedia({ colorScheme: 'light' })
  await shot(page, name)
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, `${name}-dark`)
  await page.emulateMedia({ colorScheme: 'light' })
}

const bell = (page: Page) => page.getByRole('button', { name: 'Notifications' })
const bellList = (page: Page) => page.getByRole('dialog', { name: 'Notification list' })

async function openBell(page: Page) {
  await bell(page).click()
  await expect(bellList(page)).toBeVisible()
  return bellList(page)
}

async function notes(request: APIRequestContext): Promise<Note[]> {
  const res = await request.get(`${API}/api/notifications`)
  expect(res.status(), await res.text()).toBe(200)
  return res.json()
}

async function ofKind(request: APIRequestContext, kind: string): Promise<Note[]> {
  return (await notes(request)).filter((n) => n.kind === kind)
}

async function unread(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${API}/api/notifications/unread-count`)
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { count: number }).count
}

async function readAll(request: APIRequestContext) {
  const res = await request.post(`${API}/api/notifications/read-all`, { headers: H })
  expect(res.status(), await res.text()).toBe(200)
}

/** A fresh member: signed in in a browser context of their own, zone set. */
async function newMember(browser: Browser, tag: string, displayName = 'NT Member') {
  const email = `notif-${tag}-${STAMP}-${counter++}@example.test`
  emails.push(email)
  const context = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT, timezoneId: 'UTC', locale: 'en-US' })
  contexts.push(context)
  const signup = await context.request.post('/api/auth/signup', { headers: H, data: { email, password: MEMBER_PW, display_name: displayName } })
  expect(signup.status(), await signup.text()).toBe(201)
  const zone = await context.request.put('/api/auth/timezone', { headers: H, data: { timezone: 'UTC' } })
  expect(zone.status(), await zone.text()).toBe(200)
  const page = await context.newPage()
  return { email, context, page, request: context.request }
}

async function makeProvider(request: APIRequestContext, name: string, model = 'fake-ok', extra: Record<string, unknown> = {}) {
  providerNames.add(name)
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name, provider_type: 'local', model_name: model, base_url: FAKE, config: {}, ...extra },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id as string
}

function chat(request: APIRequestContext, content: string, agent = 'assistant') {
  return request.post(`${API}/api/agent/chat`, { headers: H, data: { agent_id: agent, messages: [{ role: 'user', content }] } })
}

/** Test-only database access: make an account look old (the new-account window cannot be waited out). */
function backdate(email: string) {
  const code = [
    'import os, sqlalchemy as sa',
    "e = sa.create_engine(os.environ['LH_DATABASE_URL'])",
    'with e.begin() as c:',
    "    c.execute(sa.text(\"UPDATE users SET created_at = now() - interval '1 day' WHERE email = :e\"), {'e': os.environ['QC_EMAIL']})",
  ].join(String.fromCharCode(10))
  execFileSync(venvBin('python'), ['-c', code], { env: { ...process.env, ...E2E_ENV, QC_EMAIL: email }, stdio: 'pipe' })
}

test.beforeEach(async ({ request }) => {
  await readAll(request)
})

test.afterAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    const providers = (await (await admin.get(`${API}/api/ai-providers`)).json()) as Array<{ id: string; name: string }>
    for (const p of providers.filter((x) => providerNames.has(x.name))) await admin.delete(`${API}/api/ai-providers/${p.id}`, { headers: H })
    const fields = (await (await admin.get(`${API}/api/fields`)).json()) as Array<{ id: string; title: string }>
    for (const f of fields.filter((x) => fieldTitles.includes(x.title))) await admin.delete(`${API}/api/fields/${f.id}`, { headers: H })
    const users = (await (await admin.get('/api/admin/users')).json()) as Array<{ id: string; email: string }>
    for (const u of users.filter((x) => emails.includes(x.email))) {
      await admin.delete(`/api/admin/users/${u.id}`, { headers: H, data: { confirm_email: u.email } })
    }
  } finally {
    await admin.dispose()
    for (const context of contexts) await context.close()
  }
})

// ---------------------------------------------------------------- bell and list

test('New member + Unread count + New notifications appear without reload + Open a notification: the open admin page shows the bell count within about a minute; the item opens Settings > Users and is read', async ({
  page,
  request,
  browser,
}) => {
  const name = `NT Joiner ${STAMP}`
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'What do you want to learn?' })).toBeVisible()
  await expect(bell(page)).toBeVisible()
  await expect(bell(page)).toHaveAccessibleDescription('')

  // The page stays open (no reload, no navigation): the 60 s poll finds the new notice.
  const member = await newMember(browser, 'join', name)
  await expect(bell(page)).toHaveAccessibleDescription('1', { timeout: 75_000 })

  const list = await openBell(page)
  const item = list.getByRole('button', { name: `Unread: New member: ${name} (${member.email}) joined` })
  await expect(item).toBeVisible()
  await shotBoth(page, 'notifications-bell-list')

  // The new member has no notice about their own joining.
  expect((await ofKind(member.request, 'new_member')).length).toBe(0)

  await item.click()
  await expect(page).toHaveURL(/#\/settings\/users$/)
  await expect(bell(page)).toHaveAccessibleDescription('')
  expect(await unread(request)).toBe(0)
  const again = await openBell(page)
  await expect(again.getByRole('button', { name: `New member: ${name} (${member.email}) joined` })).toBeVisible()
  await expect(again.getByRole('button', { name: /^Unread:/ })).toHaveCount(0)
  await shot(page, 'notifications-bell-read')
})

test("Notifications are private and safe > Markup in a name: shown literally and no image is loaded; another user's id answers 404", async ({
  page,
  request,
  browser,
}) => {
  const markup = '<img src=x onerror=alert(1)>'
  const requested: string[] = []
  const dialogs: string[] = []
  page.on('request', (r) => requested.push(new URL(r.url()).pathname))
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })
  const member = await newMember(browser, 'markup', markup)
  await page.goto('/')
  await expect(bell(page)).toHaveAccessibleDescription('1')
  const list = await openBell(page)
  await expect(list.getByRole('button', { name: `Unread: New member: ${markup} (${member.email}) joined` })).toBeVisible()
  await expect(list.locator('img')).toHaveCount(0)
  await shotBoth(page, 'notifications-markup-name')
  expect(requested.filter((p) => p === '/x')).toEqual([])
  expect(dialogs).toEqual([])

  // Another user's notification id: 404, and the admin's one stays unread.
  const [mine] = await ofKind(request, 'new_member')
  const refused = await member.request.post(`${API}/api/notifications/${mine.id}/read`, { headers: H })
  expect(refused.status()).toBe(404)
  expect((await ofKind(request, 'new_member'))[0].read_at).toBeNull()
})

test('Bell and list > Mark all read and Load more: 21 unread notices show 20 first, Load more adds the rest, Mark all read clears the badge', async ({
  page,
  request,
  playwright,
}) => {
  const visitor = await playwright.request.newContext({ baseURL: APP, storageState: SIGNED_OUT })
  try {
    for (let i = 0; i < 21; i++) {
      const email = `notif-bulk-${STAMP}-${i}@example.test`
      emails.push(email)
      const res = await visitor.post('/api/auth/signup', { headers: H, data: { email, password: MEMBER_PW, display_name: `NT Bulk ${i}` } })
      expect(res.status(), await res.text()).toBe(201)
    }
  } finally {
    await visitor.dispose()
  }
  expect(await unread(request)).toBe(21)
  await page.goto('/')
  await expect(bell(page)).toHaveAccessibleDescription('21')
  const list = await openBell(page)
  // Newest first: the last one signed up is on top.
  await expect(list.getByRole('button', { name: /Unread: New member: NT Bulk/ })).toHaveCount(20)
  await expect(list.getByRole('button', { name: /^Unread: New member: NT Bulk 20 / })).toBeVisible()
  await expect(list.getByRole('button', { name: /^Unread: New member: NT Bulk 0 / })).toHaveCount(0)
  await shotBoth(page, 'notifications-load-more')
  await list.getByRole('button', { name: 'Load more' }).click()
  await expect(list.getByRole('button', { name: /Unread: New member: NT Bulk/ })).toHaveCount(21)
  await expect(list.getByRole('button', { name: 'Load more' })).toHaveCount(0)

  await list.getByRole('button', { name: 'Mark all read' }).click()
  await expect(bell(page)).toHaveAccessibleDescription('')
  await expect(list.getByRole('button', { name: /^Unread:/ })).toHaveCount(0)
  await expect(list.getByRole('button', { name: 'Mark all read' })).toBeDisabled()
  expect(await unread(request)).toBe(0)
  await shotBoth(page, 'notifications-all-read')
})

// ---------------------------------------------------------------- lesson ready

test('Lesson ready notification: the lesson writer writes a lesson through the fake model and the notice opens it', async ({ browser }) => {
  const member = await newMember(browser, 'lesson')
  await makeProvider(member.request, `NT lesson ${STAMP}`)
  const res = await chat(member.request, `Write it [[lesson:devops/docker]] ${STAMP}`, 'lesson-writer')
  expect(res.status(), await res.text()).toBe(200)
  const { page } = member
  await page.goto('/')
  await expect(bell(page)).toHaveAccessibleDescription('1')
  const list = await openBell(page)
  const item = list.getByRole('button', { name: /^Unread: Lesson ready: / })
  await expect(item).toBeVisible()
  await shotBoth(page, 'notifications-lesson-ready')
  await item.click()
  await expect(page).toHaveURL(/#\/lesson\/devops\/docker$/)
  await expect(page.getByRole('article', { name: /^Lesson:/ })).toContainText('A lesson written by the fake model.')
  await expect(bell(page)).toHaveAccessibleDescription('')
})

// ---------------------------------------------------------------- shared limit

test('Shared limit notifications: a member gets one notice at 80% and one at the limit, the admin none', async ({ request, browser }) => {
  const name = `NT shared ${STAMP}`
  await makeProvider(request, name, 'fake-ok', { shared: true })
  const member = await newMember(browser, 'limit')
  const m = member.request
  const status = (await (await m.get(`${API}/api/agents/shared`)).json()) as { daily_limit: number }
  const limit = status.daily_limit
  const at80 = Math.ceil(0.8 * limit)

  for (let i = 1; i <= at80 - 1; i++) expect((await chat(m, `QC-notif limit ${STAMP}`)).status()).toBe(200)
  expect(await ofKind(m, 'shared_limit')).toHaveLength(0)
  expect((await chat(m, `QC-notif limit ${STAMP}`)).status()).toBe(200)
  const eighty = await ofKind(m, 'shared_limit')
  expect(eighty).toHaveLength(1)
  expect(eighty[0].params).toMatchObject({ used: at80, limit })
  // The next request adds none.
  expect((await chat(m, `QC-notif limit ${STAMP}`)).status()).toBe(200)
  expect(await ofKind(m, 'shared_limit')).toHaveLength(1)

  await member.page.goto('/')
  await openBell(member.page)
  await expect(
    bellList(member.page).getByRole('button', { name: new RegExp(`^Unread: You used ${at80} of ${limit} shared requests today; resets .+`) }),
  ).toBeVisible()
  await shotBoth(member.page, 'notifications-limit-80')

  // The rest of the day's requests: the one that reaches the limit adds the second notice.
  for (let i = at80 + 2; i <= limit; i++) expect((await chat(m, `QC-notif limit ${STAMP}`)).status()).toBe(200)
  expect(await ofKind(m, 'shared_limit')).toHaveLength(2)
  expect((await chat(m, `QC-notif limit ${STAMP}`)).status()).toBe(429)
  expect(await ofKind(m, 'shared_limit')).toHaveLength(2)
  await member.page.reload()
  await openBell(member.page)
  await expect(
    bellList(member.page).getByRole('button', { name: new RegExp(`^Unread: You reached the shared limit of ${limit} requests; resets .+`) }),
  ).toBeVisible()
  await shotBoth(member.page, 'notifications-limit-reached')

  // The admin makes many requests and gets none.
  for (let i = 0; i < limit + 1; i++) expect((await chat(request, `QC-notif admin ${STAMP}`)).status()).toBe(200)
  expect(await ofKind(request, 'shared_limit')).toHaveLength(0)
})

// ---------------------------------------------------------------- provider problem

test('Provider problem notification: an invalid key gives one notice that opens the provider and survives the failed request', async ({ browser }) => {
  const member = await newMember(browser, 'badkey')
  const name = `NT badkey ${STAMP}`
  const id = await makeProvider(member.request, name, 'fake-401')
  expect((await chat(member.request, `QC-notif badkey ${STAMP}`)).status()).not.toBe(200)
  expect((await chat(member.request, `QC-notif badkey ${STAMP}`)).status()).not.toBe(200)
  const found = await ofKind(member.request, 'provider_problem')
  expect(found).toHaveLength(1)
  expect(found[0].link).toBe(`#/settings/providers/${id}`)
  expect(JSON.stringify(found[0].params)).not.toContain('Incorrect API key')

  const { page } = member
  await page.goto('/')
  await expect(bell(page)).toHaveAccessibleDescription('1')
  const list = await openBell(page)
  const item = list.getByRole('button', { name: `Unread: Provider '${name}' failed (invalid key)` })
  await expect(item).toBeVisible()
  await shotBoth(page, 'notifications-provider-invalid')
  await item.click()
  await expect(page).toHaveURL(new RegExp(`#/settings/providers/${id}$`))
})

test('Provider problem notification: a rate limited primary with a fallback gives both answers from the fallback and one notice', async ({ browser }) => {
  const member = await newMember(browser, 'fallback')
  const primary = `NT primary ${STAMP}`
  const primaryId = await makeProvider(member.request, primary, 'fake-429')
  const backupId = await makeProvider(member.request, `NT backup ${STAMP}`)
  const set = await member.request.put(`${API}/api/agents/assistant/provider`, {
    headers: H,
    data: { primary_provider_id: primaryId, fallback_provider_id: backupId },
  })
  expect(set.status(), await set.text()).toBe(200)
  for (let i = 0; i < 2; i++) {
    const res = await chat(member.request, `QC-notif fallback ${STAMP}`)
    expect(res.status(), await res.text()).toBe(200)
    expect(((await res.json()) as { provider: { name: string } }).provider.name).toBe(`NT backup ${STAMP}`)
  }
  expect(await ofKind(member.request, 'provider_problem')).toHaveLength(1)
  await member.page.goto('/')
  const list = await openBell(member.page)
  await expect(list.getByRole('button', { name: `Unread: Provider '${primary}' failed (rate limited); the fallback answered` })).toBeVisible()
  await shotBoth(member.page, 'notifications-provider-fallback')
})

// ---------------------------------------------------------------- field published

test('Published field notification: every member gets one notice that opens the home page with the field in its tabs; the admin none; publishing again adds none', async ({
  request,
  browser,
}) => {
  const title = `NT Finance ${STAMP}`
  fieldTitles.push(title)
  const first = await newMember(browser, 'field1')
  const second = await newMember(browser, 'field2')
  const made = await request.post(`${API}/api/fields`, { headers: H, data: { title } })
  expect(made.status(), await made.text()).toBe(201)
  const field = (await made.json()) as { id: string }
  await readAll(request)

  const publish = async (published: boolean) => {
    const res = await request.patch(`${API}/api/fields/${field.id}`, { headers: H, data: { published } })
    expect(res.status(), await res.text()).toBe(200)
  }
  await publish(true)
  for (const m of [first, second]) {
    const found = await ofKind(m.request, 'field_published')
    expect(found).toHaveLength(1)
    expect(found[0].params).toMatchObject({ title })
  }
  expect(await ofKind(request, 'field_published')).toHaveLength(0)

  await publish(false)
  await publish(true)
  expect(await ofKind(first.request, 'field_published')).toHaveLength(1)

  const { page } = first
  await page.goto('/#/settings')
  await expect(bell(page)).toHaveAccessibleDescription('1')
  const list = await openBell(page)
  const item = list.getByRole('button', { name: `Unread: New field published: ${title}` })
  await expect(item).toBeVisible()
  await shotBoth(page, 'notifications-field-published')
  await item.click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('tab', { name: title, exact: true })).toBeVisible()
  await expect(bell(page)).toHaveAccessibleDescription('')
})

// ---------------------------------------------------------------- new sign-in

test('New sign-in notification: a new browser and system gives a notice that opens the sessions list; the same one again, and the first one, add none', async ({
  browser,
}) => {
  const member = await newMember(browser, 'device')
  // The sign-in that comes with creating the account is skipped: no notice yet.
  expect(await ofKind(member.request, 'new_sign_in')).toHaveLength(0)
  // The window for a new account is 10 minutes: make the account older directly in the e2e database.
  backdate(member.email)

  // Same browser and system as the sign-up session: no notice.
  const same = await member.request.post(`${API}/api/auth/login`, { headers: H, data: { email: member.email, password: MEMBER_PW } })
  expect(same.status(), await same.text()).toBe(200)
  expect(await ofKind(member.request, 'new_sign_in')).toHaveLength(0)

  // Firefox on Linux: a notice; the same again: still one.
  const other = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT, userAgent: FIREFOX_LINUX })
  contexts.push(other)
  for (let i = 0; i < 2; i++) {
    const res = await other.request.post(`${API}/api/auth/login`, { headers: H, data: { email: member.email, password: MEMBER_PW } })
    expect(res.status(), await res.text()).toBe(200)
  }
  const found = await ofKind(member.request, 'new_sign_in')
  expect(found).toHaveLength(1)
  expect(found[0].params).toMatchObject({ browser: 'Firefox', system: 'Linux' })

  const { page } = member
  await page.goto('/')
  await expect(bell(page)).toHaveAccessibleDescription('1')
  const list = await openBell(page)
  const item = list.getByRole('button', { name: /^Unread: New sign-in: Firefox on Linux, .+/ })
  await expect(item).toBeVisible()
  await shotBoth(page, 'notifications-new-sign-in')
  await item.click()
  await expect(page).toHaveURL(/#\/profile\/security$/)
})

// ---------------------------------------------------------------- restore (last: it replaces the admin's data)

test('Restore notification: a sync upload and a backup restore each give "Data restored from a backup" with the counts', async ({
  page,
  request,
}) => {
  // Sync upload to the e2e backend itself, as data-sync.e2e.ts does.
  const keyRes = await request.post(`${API}/api/data/sync-key`, { headers: H })
  expect(keyRes.status(), await keyRes.text()).toBeLessThan(300)
  const { key } = (await keyRes.json()) as { key: string }
  const sync = await request.post(`${API}/api/data/sync`, { headers: H, data: { target_url: API, key } })
  expect(sync.status(), await sync.text()).toBe(200)
  await request.delete(`${API}/api/data/sync-key`, { headers: H })
  const afterSync = await ofKind(request, 'restored')
  expect(afterSync).toHaveLength(1)
  expect(afterSync[0].link).toBe('#/')

  // Backup restore through the part routes.
  const file = Buffer.from(await (await request.get(`${API}/api/data/backup`)).body())
  const started = await request.post(`${API}/api/data/restore/upload`, { headers: H })
  expect(started.ok(), await started.text()).toBeTruthy()
  const { upload_id } = (await started.json()) as { upload_id: string }
  const put = await request.put(`${API}/api/data/restore/upload/${upload_id}/0`, {
    headers: { ...H, 'Content-Type': 'application/octet-stream' },
    data: file,
  })
  expect(put.ok(), await put.text()).toBeTruthy()
  const done = await request.post(`${API}/api/data/restore/upload/${upload_id}/finish`, {
    headers: H,
    data: { parts: 1, sha256: createHash('sha256').update(file).digest('hex'), confirm: 'REPLACE' },
  })
  expect(done.status(), await done.text()).toBe(200)
  const restored = await ofKind(request, 'restored')
  expect(restored).toHaveLength(2)
  const active = (await (await request.get(`${API}/api/notes`)).json()) as unknown[]
  const archived = (await (await request.get(`${API}/api/notes?archived=true`)).json()) as unknown[]
  expect(Number(restored[0].params.notes)).toBe(active.length + archived.length)

  await page.goto('/')
  const list = await openBell(page)
  const item = list.getByRole('button', { name: /^Unread: Data restored from a backup: \d+ notes, \d+ lessons/ }).first()
  await expect(item).toBeVisible()
  await shotBoth(page, 'notifications-restored')
  await item.click()
  await expect(page).toHaveURL(/#\/$/)
})
