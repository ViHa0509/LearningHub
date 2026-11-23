/**
 * Spec checks for the change agent-stop (openspec/changes/agent-stop/specs/agent-chat/spec.md):
 * Stop while the agent works, no tool call after the stop, the stopped turn in History, Retry on it.
 *
 * The provider is the fake OpenAI-compatible server on port 8002 (e2e/fake_llm.py). The trigger
 * "[[slow-tool:<marker>]]" makes the model ask for one search_notes call at once, wait 4 seconds in
 * its second call and then ask for a second search_notes call; GET /slow-control counts the model
 * calls per marker. Not e2e-testable here (covered by backend pytest): A lesson written before the
 * stop stays, Claude Code run stopped, Another user's run, Stop after the answer came.
 */
import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test'

const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const ANSWER_TIMEOUT = 20_000
const PREFIX = 'QC-stop'
const LABEL = 'Stop main'

let counter = 0
const unique = (text: string) => `${text}-${Date.now().toString(36)}${counter++}`

interface ApiSession {
  id: string
  title: string
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

async function mine(request: APIRequestContext): Promise<ApiSession[]> {
  const res = await request.get(`${API}/api/agent/sessions?limit=200`)
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { sessions: ApiSession[] }).sessions.filter((s) => s.title.startsWith(PREFIX))
}

test.afterEach(async ({ request }) => {
  for (const s of await mine(request)) await request.delete(`${API}/api/agent/sessions/${s.id}`, { headers: H })
  await request.put(`${API}/api/agents/assistant/provider`, {
    headers: H,
    data: { primary_provider_id: null, fallback_provider_id: null },
  })
  const list = (await (await request.get(`${API}/api/ai-providers`)).json()) as Array<{ id: string; name: string }>
  for (const p of list.filter((x) => x.name.startsWith(LABEL))) {
    await request.delete(`${API}/api/ai-providers/${p.id}`, { headers: H })
  }
})

async function openChat(page: Page, request: APIRequestContext) {
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name: `${LABEL} ${unique('p')}`, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  const provider = (await res.json()) as { id: string }
  const assigned = await request.put(`${API}/api/agents/assistant/provider`, {
    headers: H,
    data: { primary_provider_id: provider.id, fallback_provider_id: null },
  })
  expect(assigned.status(), await assigned.text()).toBe(200)
  await page.goto('/')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await expect(box).toBeVisible()
  return { agent, box, log: agent.getByRole('log', { name: 'Conversation' }) }
}

const isChat = (r: Request) => r.url().endsWith('/api/agent/chat') && r.method() === 'POST'

/** Sends a slow question and waits until the model is in its second (slow) call, so one tool ran. */
async function askSlow(page: Page, request: APIRequestContext, box: ReturnType<Page['getByRole']>) {
  const marker = unique('m')
  const text = `${PREFIX} slow question [[slow-tool:${marker}]]`
  await box.fill(text)
  const req = page.waitForRequest(isChat)
  await box.press('Enter')
  const body = (await req).postDataJSON() as { run_id?: string }
  await expect
    .poll(async () => ((await (await request.get('http://127.0.0.1:8002/slow-control')).json()) as Record<string, number>)[marker] ?? 0, {
      timeout: ANSWER_TIMEOUT,
    })
    .toBeGreaterThanOrEqual(2)
  return { marker, text, runId: body.run_id }
}

const slowCalls = async (request: APIRequestContext, marker: string) =>
  ((await (await request.get('http://127.0.0.1:8002/slow-control')).json()) as Record<string, number>)[marker]

test('Stop a slow answer, no tool call after the stop, Send available again', async ({ page, request }) => {
  const { agent, box, log } = await openChat(page, request)
  const { marker, text, runId } = await askSlow(page, request, box)
  expect(runId).toBeTruthy()

  // Ask a question: while the agent works the panel shows Stop instead of Send.
  const stop = agent.getByRole('button', { name: 'Stop' })
  await expect(stop).toBeVisible()
  await expect(agent.getByRole('button', { name: 'Send' })).toHaveCount(0)
  await expect(log).toContainText(text)

  const stopCall = page.waitForResponse((r) => r.url().includes(`/api/agent/runs/${runId}/stop`))
  await stop.click()
  expect((await stopCall).status()).toBe(204)
  await expect(agent.getByText('Stopping…').first()).toBeVisible()
  await expect(stop).toBeDisabled()

  await expect(log.getByText('Stopped by you.')).toBeVisible({ timeout: ANSWER_TIMEOUT })
  await expect(log.getByText('Stopped', { exact: true })).toBeVisible()
  // Only the first tool call is in the trace; the second was not run and the model not called again.
  await expect(log.getByText('Used 1 tool')).toBeVisible()
  await log.getByText('Used 1 tool').click()
  await expect(log.getByText(`Searched notes for '${marker}-1'`)).toBeVisible()
  await expect(log.getByText(`${marker}-2`)).toHaveCount(0)
  await expect(log.getByText('SLOW done')).toHaveCount(0)
  expect(await slowCalls(request, marker)).toBe(2)

  // The panel no longer shows that the agent works, and Send is back.
  await expect(agent.getByRole('button', { name: 'Stop' })).toHaveCount(0)
  await box.fill('next question')
  await expect(agent.getByRole('button', { name: 'Send' })).toBeEnabled()

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await shot(page, `agent-stop-stopped-${scheme}`)
  }
  await page.emulateMedia({ colorScheme: 'light' })
})

test('Stopped turn in history, then Retry replaces the stopped answer', async ({ page, request }) => {
  const { agent, box, log } = await openChat(page, request)
  const { marker, text } = await askSlow(page, request, box)
  await agent.getByRole('button', { name: 'Stop' }).click()
  await expect(log.getByText('Stopped by you.')).toBeVisible({ timeout: ANSWER_TIMEOUT })

  // Leave the chat and open it again from History.
  await agent.getByRole('button', { name: 'New chat' }).click()
  await expect(log).not.toContainText(text)
  await agent.getByRole('button', { name: 'History' }).click()
  const history = agent.getByRole('region', { name: 'Chat history' })
  await history.locator('.history-row').filter({ hasText: PREFIX }).first().click()
  await expect(log.locator('.agent-bubble.user')).toHaveText(text)
  await expect(log.getByText('Stopped by you.')).toBeVisible()
  await expect(log.getByText('Stopped', { exact: true })).toBeVisible()
  await expect(log.getByText('Used 1 tool')).toBeVisible()
  await shot(page, 'agent-stop-history-light')

  // Retry sends the question again; its new answer replaces the stopped one.
  const again = page.waitForRequest(isChat)
  await log.getByRole('button', { name: 'Retry' }).click()
  const retried = (await again).postDataJSON() as { messages: { content: string }[]; run_id?: string }
  expect(retried.messages.at(-1)?.content).toBe(text)
  expect(retried.run_id).toBeTruthy()
  await expect(log.getByText('SLOW done')).toBeVisible({ timeout: 30_000 })
  await expect(log.getByText('Stopped by you.')).toHaveCount(0)
  await expect(log.getByText('Stopped', { exact: true })).toHaveCount(0)
  await expect(log.getByText(text)).toHaveCount(1)
  await expect(log.getByText('Used 2 tools')).toBeVisible()
  expect(await slowCalls(request, marker)).toBeGreaterThanOrEqual(5)
  await shot(page, 'agent-stop-retried-light')
})
