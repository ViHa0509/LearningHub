/**
 * Spec checks for the change chat-session-history (openspec/changes/chat-session-history/specs):
 * the first message creates a chat, History lists the chats, a past chat is reopened and continued
 * with its stored history, New chat, rename, delete of the open chat, the open chat after a reload,
 * the chat history in backup and restore, and no access without a session.
 *
 * The provider is the fake OpenAI-compatible server on port 8002 (e2e/fake_llm.py): "[[history]]"
 * answers with how many user messages the model received. Every chat made here is removed again.
 * Two users with separate chats are checked in backend/tests/test_chat_sessions.py.
 */
import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test'
import { createHash } from 'node:crypto'

test.describe.configure({ mode: 'serial' })

const API = 'http://127.0.0.1:8001'
const APP = 'http://127.0.0.1:5174'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const ANSWER_TIMEOUT = 20_000
const PREFIX = 'QC-hist'
const LABEL = 'History main'

let counter = 0
const unique = (text: string) => `${PREFIX} ${text} ${Date.now().toString(36)}${counter++}`

interface ChatBody {
  session_id?: string
  retry_from?: string
  messages: { role: string; content: string; display?: string }[]
}
interface ApiSession {
  id: string
  title: string
  message_count: number
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    // A 404 for a chat that is gone is expected in the reload test; the browser logs it.
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`)
  })
  return errors
}

async function sessions(request: APIRequestContext): Promise<ApiSession[]> {
  const res = await request.get(`${API}/api/agent/sessions?limit=200`)
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { sessions: ApiSession[] }).sessions
}

const mine = async (request: APIRequestContext) => (await sessions(request)).filter((s) => s.title.startsWith(PREFIX))

async function removeProviders(request: APIRequestContext) {
  for (const agent of ['assistant', 'lesson-writer']) {
    await request.put(`${API}/api/agents/${agent}/provider`, {
      headers: H,
      data: { primary_provider_id: null, fallback_provider_id: null },
    })
  }
  const list = (await (await request.get(`${API}/api/ai-providers`)).json()) as Array<{ id: string; name: string }>
  for (const p of list.filter((x) => x.name.startsWith(LABEL))) {
    await request.delete(`${API}/api/ai-providers/${p.id}`, { headers: H })
  }
}

test.afterEach(async ({ request }) => {
  for (const s of await mine(request)) await request.delete(`${API}/api/agent/sessions/${s.id}`, { headers: H })
  await removeProviders(request)
})

async function makeProvider(request: APIRequestContext) {
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name: `${LABEL} ${Date.now().toString(36)}${counter++}`, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  const provider = (await res.json()) as { id: string; name: string }
  const assigned = await request.put(`${API}/api/agents/assistant/provider`, {
    headers: H,
    data: { primary_provider_id: provider.id, fallback_provider_id: null },
  })
  expect(assigned.status(), await assigned.text()).toBe(200)
  return provider
}

/** A working provider for the assistant, then the app on the home page with the chat ready. */
async function openChat(page: Page, request: APIRequestContext) {
  const provider = await makeProvider(request)
  await page.goto('/')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await expect(box).toBeVisible()
  return { provider, agent, box, log: agent.getByRole('log', { name: 'Conversation' }) }
}

const isChat = (r: Request) => r.url().endsWith('/api/agent/chat') && r.method() === 'POST'

/** Types a message, sends it with Enter and returns the request body it sent. */
async function send(page: Page, box: ReturnType<Page['getByRole']>, text: string): Promise<ChatBody> {
  await box.fill(text)
  const req = page.waitForRequest(isChat)
  await box.press('Enter')
  return (await req).postDataJSON() as ChatBody
}

test('History: the first message creates a chat; reopen and continue, New chat, rename, delete the open chat', async ({
  page,
  request,
}) => {
  const errors = watchErrors(page)
  const { provider, agent, box, log } = await openChat(page, request)
  const newChat = agent.getByRole('button', { name: 'New chat' })
  const historyToggle = agent.getByRole('button', { name: 'History' })
  const history = agent.getByRole('region', { name: 'Chat history' })
  await expect(newChat).toBeDisabled()
  await expect(historyToggle).toHaveAttribute('aria-pressed', 'false')

  // Scenario: First message creates a session.
  const jwt = unique('what is JWT?')
  const first = await send(page, box, jwt)
  expect(first.session_id).toBeUndefined()
  expect(first.messages).toEqual([{ role: 'user', content: jwt, display: jwt }])
  await expect(log.getByText('OK from fake')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  let stored = await mine(request)
  expect(stored.map((s) => [s.title, s.message_count])).toEqual([[jwt.slice(0, 60), 2]])
  const jwtId = stored[0].id

  // Scenario: New chat - the conversation is emptied, the next message starts another chat.
  await expect(newChat).toBeEnabled()
  await newChat.click()
  await expect(log).not.toContainText(jwt)
  await expect(box).toBeFocused()
  const redis = unique('redis')
  expect((await send(page, box, redis)).session_id).toBeUndefined()
  await expect(log.getByText('OK from fake')).toBeVisible({ timeout: ANSWER_TIMEOUT })

  // History lists both, newest activity first, and marks the open one.
  await historyToggle.click()
  await expect(historyToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(box).toBeHidden()
  const rows = history.locator('.history-row').filter({ hasText: PREFIX })
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText(redis)
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true')
  await expect(rows.nth(1)).toContainText(jwt.slice(0, 60))
  await expect(rows.nth(1)).toContainText('2 messages')
  await expect(rows.nth(1)).not.toHaveAttribute('aria-current', 'true')
  await page.emulateMedia({ colorScheme: 'light' })
  await shot(page, 'chat-history')
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, 'chat-history-dark')
  await page.emulateMedia({ colorScheme: 'light' })

  // Scenario: Reopen and continue - the chat is shown as it was and the model gets its history.
  await rows.nth(1).click()
  await expect(history).toHaveCount(0)
  await expect(log.locator('.agent-bubble.user')).toHaveText(jwt)
  await expect(log.getByText('OK from fake')).toBeVisible()
  await expect(log.locator('.agent-caption')).toHaveText(`${provider.name} · fake-ok · Medium`)
  const followUp = await send(page, box, '[[history]] and how does it expire?')
  expect(followUp.session_id).toBe(jwtId)
  expect(followUp.messages).toHaveLength(1)
  await expect(log.getByText(`HISTORY user-messages=2 first=${jwt.slice(0, 60)}`)).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await shot(page, 'chat-history-reopened')
  stored = await mine(request)
  expect(stored.map((s) => [s.id, s.message_count])[0]).toEqual([jwtId, 4])

  // Scenario: Rename in the list - Save is off until the title changes; Escape keeps the title.
  await historyToggle.click()
  await expect(rows.nth(0)).toContainText('4 messages')
  await history.getByRole('button', { name: `Rename ${jwt.slice(0, 60)}` }).click()
  const field = history.getByRole('textbox', { name: 'Chat title' })
  await expect(field).toBeFocused()
  await expect(history.getByRole('button', { name: 'Save' })).toBeDisabled()
  await field.fill('something else')
  await field.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(rows.nth(0)).toContainText(jwt.slice(0, 60))
  const renamed = unique('JWT expiry')
  await history.getByRole('button', { name: `Rename ${jwt.slice(0, 60)}` }).click()
  await field.fill(renamed)
  await shot(page, 'chat-history-rename')
  await history.getByRole('button', { name: 'Save' }).click()
  await expect(rows.nth(0)).toContainText(renamed)
  expect((await mine(request))[0].title).toBe(renamed)

  // Scenario: Delete the open chat - asks first; then the row is gone and the panel is a new chat.
  await history.getByRole('button', { name: `Delete ${renamed}` }).click()
  const confirm = history.getByRole('alertdialog', { name: 'Confirm delete' })
  await expect(confirm).toBeVisible()
  await shot(page, 'chat-history-delete')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(rows).toHaveCount(2)
  await history.getByRole('button', { name: `Delete ${renamed}` }).click()
  await history.getByRole('button', { name: 'Yes, delete' }).click()
  await expect(rows).toHaveCount(1)
  expect((await request.get(`${API}/api/agent/sessions/${jwtId}`)).status()).toBe(404)
  await historyToggle.click()
  await expect(log).not.toContainText(jwt)
  await expect(log).not.toContainText('HISTORY')
  await expect(newChat).toBeDisabled()
  expect(errors).toEqual([])
})

test('The open chat survives a reload; a remembered chat that is gone starts a new chat without an error', async ({
  page,
  request,
}) => {
  const errors = watchErrors(page)
  const { agent, box, log } = await openChat(page, request)
  const question = unique('reload')
  await send(page, box, question)
  await expect(log.getByText('OK from fake')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  const [chat] = await mine(request)

  // Scenario: Reload.
  await page.reload()
  await expect(log.locator('.agent-bubble.user')).toHaveText(question, { timeout: ANSWER_TIMEOUT })
  await expect(log.getByText('OK from fake')).toBeVisible()
  const next = await send(page, box, '[[history]] again')
  expect(next.session_id).toBe(chat.id)
  await expect(log.getByText(/HISTORY user-messages=2/)).toBeVisible({ timeout: ANSWER_TIMEOUT })
  expect((await mine(request))[0].message_count).toBe(4)

  // Scenario: Remembered chat is gone.
  expect((await request.delete(`${API}/api/agent/sessions/${chat.id}`, { headers: H })).status()).toBe(204)
  await page.reload()
  await expect(box).toBeVisible()
  await expect(box).toBeEnabled({ timeout: ANSWER_TIMEOUT })
  await expect(log).not.toContainText(question)
  await expect(agent.getByRole('alert')).toHaveCount(0)
  await expect(agent.getByRole('button', { name: 'New chat' })).toBeDisabled()
  expect(errors).toEqual([])
})

test('History on a phone: the list fits the agent drawer without sideways scroll', async ({ page, request }) => {
  await makeProvider(request)
  const created = await request.post(`${API}/api/agent/chat`, {
    headers: H,
    data: { agent_id: 'assistant', messages: [{ role: 'user', content: unique('a fairly long first question on a phone screen') }] },
  })
  expect(created.status(), await created.text()).toBe(200)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('#agent-drawer-button').click()
  const agent = page.getByRole('dialog', { name: 'Agent' })
  await agent.getByRole('button', { name: 'History' }).click()
  const row = agent.locator('.history-row').filter({ hasText: PREFIX })
  await expect(row).toBeVisible()
  const box = (await row.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow).toBeLessThanOrEqual(0)
  await shot(page, 'chat-history-phone')
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, 'chat-history-phone-dark')
})

test('Backup and restore carry the chat history', async ({ request }) => {
  await makeProvider(request)
  const question = unique('kept in the backup')
  const created = await request.post(`${API}/api/agent/chat`, {
    headers: H,
    data: { agent_id: 'assistant', messages: [{ role: 'user', content: question }] },
  })
  expect(created.status(), await created.text()).toBe(200)
  const before = (await created.json()) as { session: { id: string; title: string } }

  const backup = await request.get(`${API}/api/data/backup`)
  expect(backup.status()).toBe(200)
  const file = await backup.body()

  // The chat is deleted, then the backup is restored: it is back, under a new id.
  expect((await request.delete(`${API}/api/agent/sessions/${before.session.id}`, { headers: H })).status()).toBe(204)
  expect(await mine(request)).toEqual([])
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
  const finished = await request.post(`${API}/api/data/restore/upload/${upload_id}/finish`, {
    headers: H,
    data: { parts, sha256: createHash('sha256').update(file).digest('hex'), confirm: 'REPLACE' },
  })
  expect(finished.status(), await finished.text()).toBe(200)
  const counts = ((await finished.json()) as { counts: Record<string, number> }).counts
  expect(counts.chat_sessions).toBeGreaterThanOrEqual(1)
  expect(counts.chat_messages).toBeGreaterThanOrEqual(2)

  const restored = await mine(request)
  expect(restored.map((s) => [s.title, s.message_count])).toEqual([[question.slice(0, 60), 2]])
  expect(restored[0].id).not.toBe(before.session.id)
  const detail = (await (await request.get(`${API}/api/agent/sessions/${restored[0].id}`)).json()) as {
    messages: { role: string; content: string }[]
  }
  expect(detail.messages.map((m) => [m.role, m.content])).toEqual([
    ['user', question],
    ['assistant', 'OK from fake'],
  ])
})

test('Chat sessions need a signed-in session', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: APP, storageState: { cookies: [], origins: [] } })
  expect((await anonymous.get(`${API}/api/agent/sessions`)).status()).toBe(401)
  expect((await anonymous.get(`${API}/api/agent/sessions/00000000-0000-0000-0000-000000000000`)).status()).toBe(401)
  await anonymous.dispose()
})
