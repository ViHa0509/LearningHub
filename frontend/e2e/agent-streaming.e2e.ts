/**
 * Spec checks for the change agent-streaming (openspec/changes/agent-streaming/specs/agent-chat/spec.md):
 * the answer grows while written, steps show while the tools run, the stored chat equals the panel,
 * an error during the run leaves no partial answer, and a check before the run answers the same 429.
 *
 * The provider is the fake OpenAI-compatible server on port 8002 (e2e/fake_llm.py). "[[slowstream]]"
 * in the question sends the answer words 0.4 s apart. "[[slow-tool:<marker>]]" makes the model call
 * search_notes, wait 4 s, call it again and answer "SLOW done" (so the first step ends well before
 * the answer text starts).
 *
 * Not e2e-testable: "Text the model writes before a tool call does not stay" (the fake model never
 * writes text before a tool call; unit test of the stream collector) and "Claude Code may answer only
 * at the end" (backend pytest). A failure after partial text (the fake fails before any text) is also
 * a backend unit test; here the error arrives before the first word.
 */
import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { OWNER_STATE } from '../playwright.config.ts'

const API = 'http://127.0.0.1:8001'
const APP = 'http://127.0.0.1:5174'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const NDJSON = 'application/x-ndjson'
const ANSWER_TIMEOUT = 30_000
const PREFIX = 'QC-stream'
const STAMP = Date.now().toString(36)
const MEMBER_SECRET = `${randomUUID()}-Aa1`
const LIMIT = 10
const LIMIT_MESSAGE = `Daily limit reached: you have used today's ${LIMIT} requests on the shared provider. Add your own provider in Settings, or try again tomorrow.`

let counter = 0
const unique = (text: string) => `${text}-${STAMP}${counter++}`
const memberEmails: string[] = []

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

async function sessionsOf(request: APIRequestContext) {
  const res = await request.get(`${API}/api/agent/sessions?limit=200`)
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { sessions: Array<{ id: string; title: string }> }).sessions.filter((s) => s.title.startsWith(PREFIX))
}

test.afterEach(async ({ request }) => {
  for (const s of await sessionsOf(request)) await request.delete(`${API}/api/agent/sessions/${s.id}`, { headers: H })
  await request.put(`${API}/api/agents/assistant/provider`, { headers: H, data: { primary_provider_id: null, fallback_provider_id: null } })
  const list = (await (await request.get(`${API}/api/ai-providers`)).json()) as Array<{ id: string; name: string }>
  for (const p of list.filter((x) => x.name.startsWith(PREFIX))) {
    await request.delete(`${API}/api/ai-providers/${p.id}`, { headers: H })
  }
})

test.afterAll(async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: APP, storageState: OWNER_STATE })
  try {
    const users = (await (await admin.get('/api/admin/users')).json()) as Array<{ id: string; email: string }>
    for (const email of memberEmails) {
      const found = users.find((u) => u.email === email)
      if (found) await admin.delete(`/api/admin/users/${found.id}`, { headers: H, data: { confirm_email: email } })
    }
  } finally {
    await admin.dispose()
  }
})

async function makeProvider(request: APIRequestContext, model: string, extra: Record<string, unknown> = {}) {
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name: unique(`${PREFIX} ${model}`), provider_type: 'local', model_name: model, base_url: FAKE, config: {}, ...extra },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as { id: string; name: string }
}

/** A provider with the given fake model assigned to the assistant, then the chat panel ready. */
async function openChat(page: Page, request: APIRequestContext, model = 'fake-ok') {
  const p = await makeProvider(request, model)
  const assigned = await request.put(`${API}/api/agents/assistant/provider`, {
    headers: H,
    data: { primary_provider_id: p.id, fallback_provider_id: null },
  })
  expect(assigned.status(), await assigned.text()).toBe(200)
  await page.goto('/')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await expect(box).toBeVisible()
  return { p, agent, box, log: agent.getByRole('log', { name: 'Conversation' }) }
}

const isChat = (r: Request) => r.url().endsWith('/api/agent/chat') && r.method() === 'POST'

test('The answer is streamed while it is written > Answer grows while written: part of it shows first, the full answer once at the end with Copy and Retry', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  const { box, log } = await openChat(page, request)
  await box.fill(`${PREFIX} [[markdown]] [[slowstream]] compare tokens`)
  const req = page.waitForRequest(isChat)
  await box.press('Enter')
  expect((await req).headers()['accept']).toContain(NDJSON)

  // The first part is on screen while the rest is still to come: the bubble is busy, no Copy or Retry yet.
  await expect(log.getByText('Here is a comparison:')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(log.getByRole('table')).toHaveCount(0)
  await expect(log.locator('[aria-busy="true"]')).toHaveCount(1)
  await expect(log.getByRole('button', { name: 'Copy answer' })).toHaveCount(0)
  await expect(log.getByRole('button', { name: 'Retry' })).toHaveCount(0)
  await expect(log.getByText('Thinking…')).toHaveCount(0)
  await shotBoth(page, 'agent-streaming-partial')

  // At the end: the whole answer once, with Copy and Retry; the busy mark is gone.
  await expect(log.getByRole('table')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(log.getByText('<b>not bold</b>')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(log.getByRole('button', { name: 'Copy answer' })).toBeVisible()
  await expect(log.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(log.locator('[aria-busy="true"]')).toHaveCount(0)
  await expect(log.getByText('Here is a comparison:')).toHaveCount(1)
  await expect(log.getByRole('table').getByRole('row')).toHaveCount(3)
  await shotBoth(page, 'agent-streaming-final')
})

test('The answer is streamed while it is written > Steps show while the tools run, and Same result as before: History shows the same answer and steps', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  const { agent, box, log } = await openChat(page, request)
  const marker = unique('m')
  const question = `${PREFIX} steps ${marker} [[slow-tool:${marker}]] [[slowstream]]`
  await box.fill(question)
  await box.press('Enter')

  // The first tool ended; the model waits 4 s before its next call, so no answer text exists yet.
  await expect(log.getByText('Used 1 tool')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(log.getByText('SLOW done')).toHaveCount(0)
  await expect(log.getByRole('button', { name: 'Copy answer' })).toHaveCount(0)
  await shotBoth(page, 'agent-streaming-steps')

  // The answer starts after the second tool; the run ends with both steps.
  await expect(log.getByText('SLOW done')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(log.getByText('Used 2 tools')).toBeVisible()
  await expect(log.getByRole('button', { name: 'Copy answer' })).toBeVisible()
  await expect(log.locator('[aria-busy="true"]')).toHaveCount(0)
  await log.getByText('Used 2 tools').click()
  const steps = log.locator('.agent-steps li')
  await expect(steps).toHaveCount(2)
  const panelSteps = await steps.allTextContents()
  expect(panelSteps[0]).toContain(marker)

  // Same result as before: the stored chat, reopened from History, has the same answer and steps.
  await agent.getByRole('button', { name: 'New chat' }).click()
  await expect(log).not.toContainText('SLOW done')
  await agent.getByRole('button', { name: 'History' }).click()
  const history = agent.getByRole('region', { name: 'Chat history' })
  await history.locator('.history-row').filter({ hasText: `${PREFIX} steps ${marker}` }).click()
  await expect(history).toHaveCount(0)
  await expect(log.locator('.agent-bubble.user')).toHaveText(question)
  await expect(log.getByText('SLOW done')).toHaveCount(1)
  await expect(log.getByText('Used 2 tools')).toBeVisible()
  await log.getByText('Used 2 tools').click()
  await expect(log.locator('.agent-steps li')).toHaveText(panelSteps)
  await expect(log.getByRole('button', { name: 'Copy answer' })).toBeVisible()
  await shotBoth(page, 'agent-streaming-history')
})

test('The answer is streamed while it is written > Error during the run: no answer stays, the question shows the error with Retry, nothing is stored', async ({
  page,
  request,
}) => {
  const { box, log } = await openChat(page, request, 'fake-500')
  const question = `${PREFIX} will fail ${unique('q')}`
  await box.fill(question)
  const req = page.waitForRequest(isChat)
  await box.press('Enter')
  expect((await req).headers()['accept']).toContain(NDJSON)

  await expect(log.getByRole('alert')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(log.locator('.agent-bubble.user')).toHaveText(question)
  await expect(log.locator('.agent-error-row').getByRole('button', { name: 'Retry' })).toBeVisible()
  // No assistant bubble, no Copy, no thinking mark stays; the box is usable again.
  await expect(log.locator('.agent-bubble.assistant:not(.agent-error)')).toHaveCount(0)
  await expect(log.getByRole('button', { name: 'Copy answer' })).toHaveCount(0)
  await expect(log.getByText('Thinking…')).toHaveCount(0)
  await expect(log.locator('[aria-busy="true"]')).toHaveCount(0)
  await expect(box).toBeEnabled()
  await shotBoth(page, 'agent-streaming-error')
  expect(await sessionsOf(request)).toEqual([])
})

test('The answer is streamed while it is written > Error before the run: over the daily limit the stream route answers 429 with the same message and no stream starts', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000)
  const shared = await makeProvider(request, 'fake-ok', { shared: true })
  const email = `qc-stream-${STAMP}@example.test`
  memberEmails.push(email)
  const context = await browser.newContext({ baseURL: APP, storageState: { cookies: [], origins: [] }, timezoneId: 'UTC', locale: 'en-US' })
  try {
    const signup = await context.request.post('/api/auth/signup', { headers: H, data: { email, password: MEMBER_SECRET, display_name: 'QC Stream' } })
    expect(signup.status(), await signup.text()).toBe(201)
    const m = context.request
    const ask = (headers: Record<string, string>) =>
      m.post(`${API}/api/agent/chat`, {
        headers: { ...H, ...headers },
        data: { agent_id: 'assistant', messages: [{ role: 'user', content: `${PREFIX} hello` }] },
      })
    for (let i = 0; i < LIMIT; i++) {
      const ok = await ask({})
      expect(ok.status(), await ok.text()).toBe(200)
    }
    const plain = await ask({})
    expect(plain.status()).toBe(429)
    const streamed = await ask({ Accept: NDJSON })
    expect(streamed.status()).toBe(429)
    expect(streamed.headers()['content-type']).not.toContain('ndjson')
    expect((await streamed.json()).detail).toBe(LIMIT_MESSAGE)
    expect((await plain.json()).detail).toBe(LIMIT_MESSAGE)

    // In the panel the question shows the same message with Retry, and no answer.
    const page = await context.newPage()
    await page.goto('/')
    const agent = page.getByRole('complementary', { name: 'Agent' })
    const box = agent.getByRole('textbox', { name: 'Message the agent' })
    await box.fill(`${PREFIX} over the limit`)
    await box.press('Enter')
    const alert = agent.getByRole('alert').filter({ hasText: 'Daily limit reached' })
    await expect(alert).toContainText(LIMIT_MESSAGE, { timeout: ANSWER_TIMEOUT })
    await expect(agent.getByRole('log', { name: 'Conversation' }).locator('.agent-error-row').getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(agent.getByRole('button', { name: 'Copy answer' })).toHaveCount(0)
    await shotBoth(page, 'agent-streaming-limit')
  } finally {
    await context.close()
    await request.delete(`${API}/api/ai-providers/${shared.id}`, { headers: H })
  }
})
