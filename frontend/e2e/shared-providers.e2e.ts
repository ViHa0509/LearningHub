/**
 * Spec checks for the change shared-providers (openspec/changes/shared-providers/specs/ai-providers
 * and specs/agent-providers): the admin shares a configuration with all users, members cannot share
 * or see it, a member without a configuration of their own runs the agents on it (read-only setup
 * as the admin made it), the daily limit and its message, the warning when the shared configuration
 * is withdrawn, and the backup never carrying `shared`.
 *
 * The admin is the account owner.setup.ts creates; members are made through the sign-up API in a
 * browser context of their own (zone UTC, locale en-US, a time zone already set so the zone dialog
 * stays away). All providers point at the fake OpenAI-compatible server on port 8002 (every model is
 * "fake-ok", so the provider NAME tells which configuration answered). The daily limit is the
 * backend default, 10 (LH_SHARED_DAILY_LIMIT is not set for the e2e backend); the 10 requests are
 * sent through the chat API, the next one through the chat UI.
 *
 * Not testable end to end (covered by backend/tests/test_shared_providers.py):
 *   - "Next day" (a member over the limit yesterday): the UTC day cannot be moved in a running server;
 *   - "no model is called" when over the limit, and two requests at once at the limit: not observable
 *     from the browser (the answer is the only evidence).
 *   - lesson drafting as the member: the lesson-writer's choice is checked through the chat route's
 *     agent_id and GET /api/agents instead of a full lesson draft.
 */
import { expect as baseExpect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { OWNER_STATE } from '../playwright.config.ts'

test.describe.configure({ mode: 'serial', timeout: 180_000 })
const expect = baseExpect.configure({ timeout: 30_000 })

const APP = 'http://127.0.0.1:5174'
const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const SIGNED_OUT = { cookies: [], origins: [] }
const STAMP = Date.now().toString(36)
const PASSWORD = 'e2e-member-password-1'
const LIMIT = 10
const LIMIT_MESSAGE = `Daily limit reached: you have used today's ${LIMIT} requests on the shared provider. Add your own provider in Settings, or try again tomorrow.`
const WITHDRAWN = 'The shared provider is no longer available. Add your own provider to keep using the agents.'
const NO_PROVIDER = 'No AI provider is configured.'

const MAIN = `SP Claude main ${STAMP}`
const FAST = `SP Claude fast ${STAMP}`
const PRIVATE = `SP Local qwen ${STAMP}`
const NAMES = [MAIN, FAST, PRIVATE]

let counter = 0
const ids: Record<string, string> = {}
const memberEmails: string[] = []
const contexts: BrowserContext[] = []

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

interface Overrides {
  shared?: boolean
  is_active?: boolean
}

function body(name: string, extra: Overrides = {}) {
  return { name, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {}, ...extra }
}

async function create(request: APIRequestContext, name: string, extra: Overrides = {}) {
  const res = await request.post(`${API}/api/ai-providers`, { headers: H, data: body(name, extra) })
  expect(res.status(), await res.text()).toBe(201)
  ids[name] = (await res.json()).id
  return ids[name]
}

async function update(request: APIRequestContext, name: string, extra: Overrides) {
  const res = await request.put(`${API}/api/ai-providers/${ids[name]}`, { headers: H, data: body(name, extra) })
  expect(res.status(), await res.text()).toBe(200)
}

async function assign(request: APIRequestContext, agent: string, primary: string | null) {
  const res = await request.put(`${API}/api/agents/${agent}/provider`, {
    headers: H,
    data: { primary_provider_id: primary ? ids[primary] : null, fallback_provider_id: null },
  })
  expect(res.status(), await res.text()).toBe(200)
}

async function webSearch(request: APIRequestContext, agent: string, on: boolean) {
  const res = await request.put(`${API}/api/agents/${agent}/settings`, { headers: H, data: { web_search: on } })
  expect(res.status(), await res.text()).toBe(200)
}

/** The admin's setup as the tests start: MAIN, FAST and PRIVATE exist, active and not shared; no assignment. */
async function resetAdmin(request: APIRequestContext) {
  await assign(request, 'assistant', null)
  await assign(request, 'lesson-writer', null)
  await webSearch(request, 'assistant', false)
  await webSearch(request, 'lesson-writer', false)
  for (const name of NAMES) if (ids[name]) await update(request, name, { shared: false, is_active: true })
}

interface ApiAgent {
  id: string
  effective: { name: string; model_name: string; shared: boolean; last_test_status: unknown } | null
  effective_reason: string
  web_search: boolean
  primary: unknown
  fallback: unknown
}
interface SharedStatus {
  mode: string
  used_today: number
  daily_limit: number
  resets_at: string
  withdrawn: boolean
}

async function agentsOf(request: APIRequestContext): Promise<ApiAgent[]> {
  const res = await request.get(`${API}/api/agents`)
  expect(res.status(), await res.text()).toBe(200)
  return res.json()
}

async function sharedOf(request: APIRequestContext): Promise<SharedStatus> {
  const res = await request.get(`${API}/api/agents/shared`)
  expect(res.status(), await res.text()).toBe(200)
  return res.json()
}

/** One agent request through the chat API (it takes the count when the user is in shared mode). */
function chatApi(request: APIRequestContext, agent = 'assistant') {
  return request.post(`${API}/api/agent/chat`, {
    headers: H,
    data: { agent_id: agent, messages: [{ role: 'user', content: `QC-shared hello ${STAMP}` }] },
  })
}

async function chatOk(request: APIRequestContext, agent = 'assistant') {
  const res = await chatApi(request, agent)
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as { provider: { name: string } }
}

/** A fresh member without a configuration: signed in in a browser context of its own, zone set. */
async function newMember(browser: Browser, tag: string) {
  const email = `sp-${tag}-${STAMP}-${counter++}@example.test`
  memberEmails.push(email)
  const context = await browser.newContext({ baseURL: APP, storageState: SIGNED_OUT, timezoneId: 'UTC', locale: 'en-US' })
  contexts.push(context)
  const signup = await context.request.post('/api/auth/signup', {
    headers: H,
    data: { email, password: PASSWORD, display_name: 'SP Member' },
  })
  expect(signup.status(), await signup.text()).toBe(201)
  const zone = await context.request.put('/api/auth/timezone', { headers: H, data: { timezone: 'UTC' } })
  expect(zone.status(), await zone.text()).toBe(200)
  const page = await context.newPage()
  return { email, context, page, request: context.request }
}

function agentCard(page: Page, name: string) {
  return page.getByRole('region', { name: 'Agent providers' }).getByRole('article', { name })
}

async function openChat(page: Page) {
  await page.goto('/')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  return { agent, box: agent.getByRole('textbox', { name: 'Message the agent' }) }
}

test.beforeAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    await create(admin, MAIN)
    await create(admin, FAST)
    await create(admin, PRIVATE)
  } finally {
    await admin.dispose()
  }
})

test.beforeEach(async ({ request }) => {
  await resetAdmin(request)
})

test.afterAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    for (const agent of ['assistant', 'lesson-writer']) {
      await admin.put(`${API}/api/agents/${agent}/provider`, { headers: H, data: { primary_provider_id: null, fallback_provider_id: null } })
      await admin.put(`${API}/api/agents/${agent}/settings`, { headers: H, data: { web_search: false } })
    }
    // Names, not remembered ids: a restore can give them new ids.
    const list = (await (await admin.get(`${API}/api/ai-providers`)).json()) as Array<{ id: string; name: string }>
    for (const p of list.filter((x) => x.name.includes(`SP `) && x.name.endsWith(STAMP))) {
      await admin.delete(`${API}/api/ai-providers/${p.id}`, { headers: H })
    }
    const users = (await (await admin.get('/api/admin/users')).json()) as Array<{ id: string; email: string }>
    for (const email of memberEmails) {
      const found = users.find((u) => u.email === email)
      if (found) await admin.delete(`/api/admin/users/${found.id}`, { headers: H, data: { confirm_email: email } })
    }
    const sessions = (await (await admin.get(`${API}/api/agent/sessions?limit=200`)).json()) as { sessions: Array<{ id: string; title: string }> }
    for (const s of sessions.sessions.filter((x) => x.title.startsWith('QC-shared'))) {
      await admin.delete(`${API}/api/agent/sessions/${s.id}`, { headers: H })
    }
  } finally {
    await admin.dispose()
    for (const context of contexts) await context.close()
  }
})

// ---------------------------------------------------------------- ai-providers

test('Share a configuration > Admin shares: ticking "Shared with all users" and saving shows a Shared badge in the list; no switch for Claude Code', async ({
  page,
}) => {
  await page.goto(`/#/settings/providers/${ids[MAIN]}`)
  const form = page.getByRole('region', { name: 'Provider configuration' })
  const box = form.getByRole('checkbox', { name: 'Shared with all users' })
  await expect(box).toBeVisible()
  await expect(box).not.toBeChecked()
  await expect(form).toContainText(`Other users can run the agents on this key without adding their own (${LIMIT} requests a day each).`)
  await box.check()
  await shotBoth(page, 'shared-provider-form')
  await form.getByRole('button', { name: 'Save Changes' }).click()
  await expect(form.getByText('Saved.')).toBeVisible()

  await page.goto('/#/settings')
  const main = page.getByRole('article', { name: MAIN })
  await expect(main.getByText('Shared', { exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: FAST }).getByText('Shared', { exact: true })).toHaveCount(0)
  await shotBoth(page, 'shared-provider-list')

  // The new-provider form has no switch once Claude Code is chosen.
  await page.goto('/#/settings/providers/new')
  const types = page.getByRole('radiogroup', { name: 'Provider type' })
  await expect(types.getByRole('radio').first()).toBeAttached()
  await expect(page.getByRole('checkbox', { name: 'Shared with all users' })).toBeVisible()
  await types.getByRole('radio', { name: 'Claude Code (subscription)', exact: true }).check({ force: true })
  await expect(page.getByRole('checkbox', { name: 'Shared with all users' })).toHaveCount(0)
})

test('Share a configuration > Claude Code cannot be shared: the API refuses and says so', async ({ request }) => {
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name: `SP cc ${STAMP}`, provider_type: 'claude-code', model_name: 'sonnet', config: {}, shared: true },
  })
  expect(res.status(), await res.text()).toBe(422)
  expect(await res.text()).toContain('Claude Code cannot be shared')
  const list = (await (await request.get(`${API}/api/ai-providers`)).json()) as Array<{ name: string }>
  expect(list.map((p) => p.name)).not.toContain(`SP cc ${STAMP}`)
})

test('Share a configuration > Member cannot share, and Hidden from other users: a shared configuration is not listed and every call by id answers 404', async ({
  browser,
  request,
}) => {
  await update(request, MAIN, { shared: true })
  const member = await newMember(browser, 'hidden')
  const m = member.request

  const refused = await m.post(`${API}/api/ai-providers`, { headers: H, data: body(`SP member own ${STAMP}`, { shared: true }) })
  expect(refused.status(), await refused.text()).toBe(403)
  expect(await (await m.get(`${API}/api/ai-providers`)).json()).toEqual([])

  // Their own private configuration stays private; making it shared by update is refused too.
  const own = await m.post(`${API}/api/ai-providers`, { headers: H, data: body(`SP member own ${STAMP}`) })
  expect(own.status(), await own.text()).toBe(201)
  const ownId = (await own.json()).id as string
  const upd = await m.put(`${API}/api/ai-providers/${ownId}`, { headers: H, data: body(`SP member own ${STAMP}`, { shared: true }) })
  expect(upd.status(), await upd.text()).toBe(403)
  const stored = (await (await m.get(`${API}/api/ai-providers/${ownId}`)).json()) as { shared: boolean }
  expect(stored.shared).toBe(false)
  expect((await m.delete(`${API}/api/ai-providers/${ownId}`, { headers: H })).status()).toBe(204)

  // The shared one: not in the list, 404 for read, test, models, update and delete.
  const list = (await (await m.get(`${API}/api/ai-providers`)).json()) as Array<{ name: string }>
  expect(list.map((p) => p.name)).not.toContain(MAIN)
  const id = ids[MAIN]
  expect((await m.get(`${API}/api/ai-providers/${id}`)).status()).toBe(404)
  expect((await m.post(`${API}/api/ai-providers/${id}/test`, { headers: H })).status()).toBe(404)
  expect((await m.get(`${API}/api/ai-providers/${id}/models`)).status()).toBe(404)
  expect((await m.put(`${API}/api/ai-providers/${id}`, { headers: H, data: body(MAIN) })).status()).toBe(404)
  expect((await m.delete(`${API}/api/ai-providers/${id}`, { headers: H })).status()).toBe(404)
  // Untouched: the admin still has it, shared.
  const mine = (await (await request.get(`${API}/api/ai-providers/${id}`)).json()) as { shared: boolean }
  expect(mine.shared).toBe(true)
})

test('Share a configuration > Unshare: members without a configuration can no longer run the agents', async ({ browser, request }) => {
  await update(request, MAIN, { shared: true })
  const member = await newMember(browser, 'unshare')
  await chatOk(member.request)
  await update(request, MAIN, { shared: false })
  const refused = await chatApi(member.request)
  expect(refused.status(), await refused.text()).toBe(409)
})

// ---------------------------------------------------------------- agent-providers

test('Provider resolution > Shared configuration for a user without one: the member is answered by it; Settings shows the read-only setup, the count, and no key data', async ({
  browser,
  request,
}) => {
  await update(request, MAIN, { shared: true })
  const member = await newMember(browser, 'mode')
  const { page, request: m } = member

  const status = await sharedOf(m)
  expect(status).toMatchObject({ mode: 'shared', used_today: 0, daily_limit: LIMIT, withdrawn: false })
  expect(Date.parse(status.resets_at)).toBeGreaterThan(Date.now())
  const agents = await agentsOf(m)
  const assistant = agents.find((a) => a.id === 'assistant')!
  expect(assistant.effective_reason).toBe('shared')
  expect(assistant.primary).toBeNull()
  expect(assistant.fallback).toBeNull()
  expect(assistant.effective).toMatchObject({ name: MAIN, model_name: 'fake-ok', shared: true, last_test_status: null })
  // No key hint, base URL, parameters or owner data reach the member.
  const raw = JSON.stringify(agents)
  expect(raw).not.toContain('key_hint')
  expect(raw).not.toContain('127.0.0.1:8002')
  expect(raw).not.toContain('owner@example.test')

  // Settings -> Agents: read-only rows and the count.
  await page.goto('/#/settings/agents')
  const region = page.getByRole('region', { name: 'Agent providers' })
  for (const name of ['Learning assistant', 'Lesson writer', 'Topic outline']) {
    const card = agentCard(page, name)
    await expect(card).toContainText(`Uses ${MAIN} (fake-ok), shared by the admin`)
    await expect(card).toContainText('Internet search: off')
    await expect(card.getByRole('combobox')).toHaveCount(0)
    await expect(card.getByRole('checkbox')).toHaveCount(0)
    await expect(card.getByRole('button')).toHaveCount(0)
  }
  await expect(region.getByRole('status').filter({ hasText: `0 of ${LIMIT} requests used today` })).toBeVisible()
  await expect(region.getByRole('img', { name: 'Warning' })).toHaveCount(0)
  await shotBoth(page, 'shared-agents-member')

  // The providers page: the same lines above the empty list.
  await page.goto('/#/settings')
  await expect(page.getByText(`Uses ${MAIN} (fake-ok), shared by the admin`).first()).toBeVisible()
  await expect(page.getByText(`0 of ${LIMIT} requests used today`)).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(0)
  await shotBoth(page, 'shared-providers-member')

  // The chat: the normal composer, no hint, and the shared configuration answers.
  const { agent, box } = await openChat(page)
  await expect(box).toBeVisible()
  await expect(page.getByText(NO_PROVIDER)).toHaveCount(0)
  await box.fill(`QC-shared via ui ${STAMP}`)
  await box.press('Enter')
  await expect(agent.getByText('OK from fake')).toBeVisible()
  await expect(agent.locator('.agent-caption').last()).toContainText(`${MAIN} · fake-ok`)
  await shotBoth(page, 'shared-chat-member')
  expect((await sharedOf(m)).used_today).toBe(1)
})

test('Provider resolution > Own configuration wins over a shared one: the member with an active configuration of their own is answered by it', async ({
  browser,
  request,
}) => {
  await update(request, MAIN, { shared: true })
  const member = await newMember(browser, 'own')
  const own = await member.request.post(`${API}/api/ai-providers`, { headers: H, data: body(`SP My key ${STAMP}`) })
  expect(own.status(), await own.text()).toBe(201)
  expect((await sharedOf(member.request)).mode).toBe('own')
  expect((await chatOk(member.request)).provider.name).toBe(`SP My key ${STAMP}`)
  expect((await sharedOf(member.request)).used_today).toBe(0)
  // The usual controls are back.
  await member.page.goto('/#/settings/agents')
  await expect(agentCard(member.page, 'Learning assistant').getByRole('combobox').first()).toBeVisible()
})

test('Provider resolution > No shared configuration and Shared configuration switched off: the request is refused with a conflict error that points to Settings', async ({
  browser,
  request,
}) => {
  const member = await newMember(browser, 'none')
  const none = await chatApi(member.request)
  expect(none.status(), await none.text()).toBe(409)
  expect(await none.text()).toContain('Settings')

  await update(request, MAIN, { shared: true, is_active: false })
  const off = await chatApi(member.request)
  expect(off.status(), await off.text()).toBe(409)
  expect(await off.text()).toContain('Settings')
  expect((await sharedOf(member.request)).mode).toBe('none')
})

test("Shared agent setup > Agent follows the admin's assignment, Private assignment is skipped and Internet search follows the admin", async ({
  browser,
  request,
}) => {
  await update(request, MAIN, { shared: true })
  await update(request, FAST, { shared: true })
  const member = await newMember(browser, 'setup')
  const m = member.request
  const effective = async (agent: string) => (await agentsOf(m)).find((a) => a.id === agent)!

  // The admin's lesson writer uses "fast": the member's lesson writer runs on it, and answers.
  await assign(request, 'lesson-writer', FAST)
  expect((await effective('lesson-writer')).effective?.name).toBe(FAST)
  expect((await chatOk(m, 'lesson-writer')).provider.name).toBe(FAST)
  // The assistant has no assignment of the admin's: the first shared configuration, "main".
  expect((await effective('assistant')).effective?.name).toBe(MAIN)

  // The admin's assignment is private: it is skipped, the first shared one is used.
  await assign(request, 'lesson-writer', PRIVATE)
  const skipped = await effective('lesson-writer')
  expect(skipped.effective?.name).toBe(MAIN)
  expect(skipped.effective?.shared).toBe(true)
  expect((await chatOk(m, 'lesson-writer')).provider.name).toBe(MAIN)

  // Internet search follows the admin's switch for that agent.
  expect((await effective('assistant')).web_search).toBe(false)
  await webSearch(request, 'assistant', true)
  expect((await effective('assistant')).web_search).toBe(true)
  await member.page.goto('/#/settings/agents')
  await expect(agentCard(member.page, 'Learning assistant')).toContainText('Internet search: on')
  await expect(agentCard(member.page, 'Lesson writer')).toContainText('Internet search: off')
})

test('Shared setup is read-only > Assigning the shared configuration is refused as an unknown provider', async ({ browser, request }) => {
  await update(request, MAIN, { shared: true })
  const member = await newMember(browser, 'assign')
  const res = await member.request.put(`${API}/api/agents/assistant/provider`, {
    headers: H,
    data: { primary_provider_id: ids[MAIN], fallback_provider_id: null },
  })
  expect(res.status(), await res.text()).toBe(404)
  // The same refusal as for an id that exists nowhere: the shared row is "unknown" to the member.
  const nowhere = '00000000-0000-4000-8000-000000000000'
  const other = await member.request.put(`${API}/api/agents/assistant/provider`, {
    headers: H,
    data: { primary_provider_id: nowhere, fallback_provider_id: null },
  })
  expect(other.status()).toBe(404)
  expect((await res.text()).replace(ids[MAIN], 'ID')).toBe((await other.text()).replace(nowhere, 'ID'))
  // The agent still runs on the shared configuration, unchanged.
  expect((await agentsOf(member.request)).find((a) => a.id === 'assistant')!.effective_reason).toBe('shared')
})

test('Daily limit > Count shown, Over the limit, Another user and Admin is not counted', async ({ browser, request }) => {
  await update(request, MAIN, { shared: true })
  const first = await newMember(browser, 'limit')
  const second = await newMember(browser, 'other')
  const m = first.request

  // Count shown: 3 requests today -> "3 of 10" in Settings -> Agents.
  for (let i = 0; i < 3; i++) await chatOk(m)
  await first.page.goto('/#/settings/agents')
  await expect(
    first.page.getByRole('region', { name: 'Agent providers' }).getByRole('status').filter({ hasText: `3 of ${LIMIT} requests used today` }),
  ).toBeVisible()

  // Use the rest of the day's requests.
  for (let i = 3; i < LIMIT; i++) await chatOk(m)
  expect((await sharedOf(m)).used_today).toBe(LIMIT)

  // Over the limit: the chat shows the message and when it resets (in the member's zone).
  const status = await sharedOf(m)
  const resets = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(status.resets_at))
  const { agent, box } = await openChat(first.page)
  await expect(box).toBeVisible()
  await box.fill(`QC-shared over the limit ${STAMP}`)
  await box.press('Enter')
  const alert = agent.getByRole('alert').filter({ hasText: 'Daily limit reached' })
  await expect(alert).toHaveText(`${LIMIT_MESSAGE} It resets ${resets}.`)
  await shotBoth(first.page, 'shared-chat-over-limit')
  const api = await chatApi(m)
  expect(api.status()).toBe(429)
  expect((await api.json()).detail).toBe(LIMIT_MESSAGE)
  await first.page.goto('/#/settings/agents')
  await expect(first.page.getByRole('status').filter({ hasText: `${LIMIT} of ${LIMIT} requests used today` })).toBeVisible()

  // Another user: answered, with a count of their own.
  expect((await chatOk(second.request)).provider.name).toBe(MAIN)
  expect((await sharedOf(second.request)).used_today).toBe(1)

  // Admin is not counted: the admin chats and has no count and no limit.
  const adminBefore = await sharedOf(request)
  expect(adminBefore.mode).toBe('own')
  for (let i = 0; i < 2; i++) await chatOk(request)
  const adminAfter = await sharedOf(request)
  expect(adminAfter.used_today).toBe(0)
})

test('Warning when withdrawn > Unshared, Switched off or deleted, Shared again: the same warning in Settings -> Agents, on the providers page and in the chat hint', async ({
  browser,
  request,
}) => {
  await update(request, MAIN, { shared: true })
  const member = await newMember(browser, 'withdrawn')
  const { page, request: m } = member
  await chatOk(m)
  expect(await sharedOf(m)).toMatchObject({ mode: 'shared', withdrawn: false })

  // The admin changed the server's state behind the open page: load it again, as a member coming back would.
  const visit = async (path: string) => {
    await page.goto(path)
    await page.reload()
  }
  // The page itself (the chat panel beside it shows its own hint, checked separately).
  const expectWarning = async (path: string, region: string) => {
    await visit(path)
    const warning = page.getByRole('region', { name: region, exact: true }).getByRole('status').filter({ has: page.getByRole('img', { name: 'Warning' }) })
    await expect(warning).toContainText(WITHDRAWN)
    await expect(warning.getByRole('img', { name: 'Warning' })).toBeVisible()
    return warning
  }

  // Unshared: Settings -> Agents, with a link to the providers page.
  await update(request, MAIN, { shared: false })
  expect(await sharedOf(m)).toMatchObject({ mode: 'none', withdrawn: true })
  const warning = await expectWarning('/#/settings/agents', 'Agents')
  await shotBoth(page, 'shared-withdrawn-agents')
  await warning.getByRole('link', { name: 'Go to AI providers' }).click()
  await expect(page).toHaveURL(/#\/settings$/)
  await expect(page.getByRole('heading', { name: 'AI providers', level: 1 })).toBeVisible()
  await expectWarning('/#/settings', 'Settings')
  await shotBoth(page, 'shared-withdrawn-providers')

  // The chat hint: "No AI provider is configured." with the same warning.
  await visit('/')
  const hint = page.getByRole('complementary', { name: 'Agent' })
  await expect(hint.getByText(NO_PROVIDER)).toBeVisible()
  await expect(hint.getByRole('img', { name: 'Warning' })).toBeVisible()
  await expect(hint).toContainText(WITHDRAWN)
  await shotBoth(page, 'shared-withdrawn-chat')

  // Shared again: the warning is gone and the agents answer.
  await update(request, MAIN, { shared: true })
  expect(await sharedOf(m)).toMatchObject({ mode: 'shared', withdrawn: false })
  await visit('/#/settings/agents')
  await expect(page.getByRole('img', { name: 'Warning' })).toHaveCount(0)
  await expect(agentCard(page, 'Learning assistant')).toContainText(`Uses ${MAIN}`)
  await chatOk(m)

  // Switched off: the warning is back.
  await update(request, MAIN, { shared: true, is_active: false })
  expect(await sharedOf(m)).toMatchObject({ mode: 'none', withdrawn: true })
  await expectWarning('/#/settings/agents', 'Agents')

  // Deleted: a configuration made only for this, shared, used once, deleted.
  await update(request, MAIN, { shared: false, is_active: true })
  const temp = `SP Claude temp ${STAMP}`
  const tempId = await create(request, temp, { shared: true })
  await chatOk(m)
  expect((await sharedOf(m)).withdrawn).toBe(false)
  const del = await request.delete(`${API}/api/ai-providers/${tempId}`, { headers: H })
  expect(del.status(), await del.text()).toBe(204)
  delete ids[temp]
  expect(await sharedOf(m)).toMatchObject({ mode: 'none', withdrawn: true })
  await expectWarning('/#/settings/agents', 'Agents')
})

test('Warning when withdrawn > Falls back to the user\'s own configuration: "My key" answers and the warning is gone', async ({
  browser,
  request,
}) => {
  await update(request, MAIN, { shared: true })
  const member = await newMember(browser, 'fallback')
  const { page, request: m } = member
  await chatOk(m)
  await update(request, MAIN, { shared: false })
  expect((await sharedOf(m)).withdrawn).toBe(true)

  const mine = `SP My key ${STAMP}`
  const made = await m.post(`${API}/api/ai-providers`, { headers: H, data: body(mine) })
  expect(made.status(), await made.text()).toBe(201)
  expect(await sharedOf(m)).toMatchObject({ mode: 'own', withdrawn: false })
  const { agent, box } = await openChat(page)
  await expect(box).toBeVisible()
  await box.fill(`QC-shared own ${STAMP}`)
  await box.press('Enter')
  await expect(agent.getByText('OK from fake')).toBeVisible()
  await expect(agent.locator('.agent-caption').last()).toContainText(`${mine} · fake-ok`)
  await page.goto('/#/settings/agents')
  await expect(page.getByRole('img', { name: 'Warning' })).toHaveCount(0)
})

test('Warning when withdrawn > User who never used it: the usual hint to add a provider, without the warning', async ({ browser }) => {
  const member = await newMember(browser, 'never')
  const { page, request: m } = member
  expect(await sharedOf(m)).toMatchObject({ mode: 'none', withdrawn: false })
  const { agent } = await openChat(page)
  await expect(agent.getByText(NO_PROVIDER)).toBeVisible()
  await expect(agent.getByRole('img', { name: 'Warning' })).toHaveCount(0)
  await expect(page.getByText(WITHDRAWN)).toHaveCount(0)
  await shotBoth(page, 'shared-never-used-chat')
  await page.goto('/#/settings/agents')
  await expect(page.getByRole('region', { name: 'Agent providers' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Warning' })).toHaveCount(0)
  await page.goto('/#/settings')
  await expect(page.getByText('No providers yet. Add one to use the agent.')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Warning' })).toHaveCount(0)
})

// Last: a restore replaces the admin's provider rows (ids may change), so no test follows it.
test('Share a configuration > Backup: a restored configuration is private', async ({ request }) => {
  await update(request, MAIN, { shared: true })
  const download = await request.get(`${API}/api/data/backup`)
  expect(download.status()).toBe(200)
  const file = Buffer.from(await download.body())

  const started = await request.post(`${API}/api/data/restore/upload`, { headers: H })
  expect(started.ok(), await started.text()).toBeTruthy()
  const { upload_id } = (await started.json()) as { upload_id: string }
  const size = 1024 * 1024
  const parts = Math.max(1, Math.ceil(file.length / size))
  for (let i = 0; i < parts; i++) {
    const put = await request.put(`${API}/api/data/restore/upload/${upload_id}/${i}`, {
      headers: { ...H, 'Content-Type': 'application/octet-stream' },
      data: file.subarray(i * size, (i + 1) * size),
    })
    expect(put.ok(), await put.text()).toBeTruthy()
  }
  const done = await request.post(`${API}/api/data/restore/upload/${upload_id}/finish`, {
    headers: H,
    data: { parts, sha256: createHash('sha256').update(file).digest('hex'), confirm: 'REPLACE' },
  })
  expect(done.status(), await done.text()).toBe(200)

  const list = (await (await request.get(`${API}/api/ai-providers`)).json()) as Array<{ id: string; name: string; shared: boolean }>
  const main = list.find((p) => p.name === MAIN)
  expect(main, 'the restored configuration exists').toBeDefined()
  expect(main!.shared).toBe(false)
  expect(list.filter((p) => p.shared)).toEqual([])
})
