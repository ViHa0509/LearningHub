/**
 * End-to-end checks for the claude-code-provider change. The backend runs the fake `claude`
 * (e2e/fake_claude.py, set through LH_CLAUDE_BIN) which calls the real MCP tool server; the
 * fallback provider points at the fake OpenAI-compatible server (e2e/fake_llm.py, port 8002).
 * Models of the fake: sonnet (search + read), fake-write (write the lesson), fake-429,
 * fake-auth, fake-slow. Each test creates its own providers and removes them afterwards.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const TYPE = 'Claude Code (subscription)'
const NOTE_TITLE = 'Redis eviction policies'
const LESSON = 'backend/caching'

let counter = 0
const unique = (label: string) => `${label} ${Date.now().toString(36)}${counter++}`
const created: string[] = []

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

async function makeClaude(
  request: APIRequestContext,
  label: string,
  model: string,
  config: Record<string, unknown> = {},
) {
  const name = unique(label)
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name, provider_type: 'claude-code', model_name: model, config },
  })
  expect(res.status(), await res.text()).toBe(201)
  const body = await res.json()
  created.push(body.id)
  return { id: body.id as string, name }
}

async function makeLocal(request: APIRequestContext, label: string, model: string) {
  const name = unique(label)
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name, provider_type: 'local', model_name: model, base_url: FAKE, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  const body = await res.json()
  created.push(body.id)
  return { id: body.id as string, name }
}

async function assign(request: APIRequestContext, agent: string, primary: string | null, fallback: string | null) {
  const res = await request.put(`${API}/api/agents/${agent}/provider`, {
    headers: H,
    data: { primary_provider_id: primary, fallback_provider_id: fallback },
  })
  expect(res.status(), await res.text()).toBe(200)
}

async function deleteNotes(request: APIRequestContext) {
  const all = await (await request.get(`${API}/api/notes`)).json()
  for (const n of all) {
    if (n.title === NOTE_TITLE) await request.delete(`${API}/api/notes/${n.id}`, { headers: H })
  }
}

test.afterEach(async ({ request }) => {
  for (const agent of ['assistant', 'lesson-writer']) {
    await request.put(`${API}/api/agents/${agent}/provider`, {
      headers: H,
      data: { primary_provider_id: null, fallback_provider_id: null },
    })
  }
  while (created.length > 0) {
    await request.delete(`${API}/api/ai-providers/${created.pop()}`, { headers: H })
  }
  await request.put(`${API}/api/lessons/${LESSON}`, { headers: H, data: { body: '', source: 'user' } })
  await deleteNotes(request)
})

test.describe('Manage provider configurations: Claude Code configuration', () => {
  test('Create a Claude Code provider without a key; only the timeout is offered', async ({ page, request }) => {
    const name = unique('Claude subscription')
    await page.goto('/#/settings/providers/new')
    const form = page.getByRole('region', { name: 'Provider configuration' })
    await form.getByRole('radio', { name: TYPE, exact: true }).check({ force: true })
    await expect(form.getByLabel('Setup token (optional)')).toBeVisible()
    await expect(form.getByLabel('Base URL')).toHaveCount(0)
    await expect(form.getByLabel('Temperature', { exact: true })).toHaveCount(0)
    await expect(form.getByLabel('Top p', { exact: true })).toHaveCount(0)
    await expect(form.getByLabel('Max tokens', { exact: true })).toHaveCount(0)
    await expect(form.getByLabel('Timeout (seconds)')).toBeVisible()
    await shot(page, 'claude-code-form')

    await form.getByLabel('Name', { exact: true }).fill(name)
    await form.getByLabel('Model', { exact: true }).fill('sonnet')
    await form.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page).toHaveURL(/#\/settings\/providers\/[0-9a-f-]+$/)
    const list = await (await request.get(`${API}/api/ai-providers`)).json()
    const row = list.find((p: { name: string }) => p.name === name)
    expect(row.provider_type).toBe('claude-code')
    expect(row.has_key).toBe(false)
    created.push(row.id)

    await page.goto('/#/settings')
    const card = page.getByRole('article', { name })
    await expect(card).toContainText(TYPE)
    await expect(card).toContainText('sonnet')
    await expect(card).toContainText('Active')
    await shot(page, 'claude-code-list')
  })

  test('Base URL and sampling parameters are refused naming the field', async ({ request }) => {
    const base = { name: unique('Bad claude'), provider_type: 'claude-code', model_name: 'sonnet' }
    const url = await request.post(`${API}/api/ai-providers`, {
      headers: H,
      data: { ...base, base_url: 'http://localhost:1/v1', config: {} },
    })
    expect(url.status()).toBe(422)
    expect(JSON.stringify((await url.json()).detail)).toContain('base_url')
    const temp = await request.post(`${API}/api/ai-providers`, {
      headers: H,
      data: { ...base, config: { temperature: 0.5 } },
    })
    expect(temp.status()).toBe(422)
    const text = JSON.stringify((await temp.json()).detail)
    expect(text).toContain('temperature')
    expect(text).toMatch(/not supported/i)
    const types = await (await request.get(`${API}/api/ai-providers/types`)).json()
    const claude = types.find((t: { type: string }) => t.type === 'claude-code')
    expect(claude.params).toEqual(['timeout'])
  })
})

test.describe('Limits and errors are categorized: Test Connection', () => {
  const cases: Array<[string, string, string, Record<string, unknown>]> = [
    ['sonnet', 'ok', 'Connected', {}],
    ['fake-auth', 'auth_failed', 'Key rejected', {}],
    ['fake-429', 'rate_limited', 'Rate limited', {}],
    ['fake-slow', 'timeout', 'Timed out', { timeout: 1 }],
  ]
  for (const [model, status, label, config] of cases) {
    test(`Test Connection result ${status} for ${model}`, async ({ page, request }) => {
      const p = await makeClaude(request, `CC ${status}`, model, config)
      await page.goto(`/#/settings/providers/${p.id}`)
      const section = page.getByRole('region', { name: 'Test connection' })
      await section.getByRole('button', { name: 'Test Connection' }).click()
      const result = section.locator(`[data-status="${status}"]`)
      await expect(result).toContainText(label, { timeout: 20_000 })
      await shot(page, `claude-code-test-${status}`)
      const row = await (await request.get(`${API}/api/ai-providers/${p.id}`)).json()
      expect(row.last_test.status).toBe(status)
    })
  }
})

test.describe('The agent can run on the Claude Code CLI', () => {
  // Each answer starts the fake CLI and the app's tool server: slow on a loaded machine.
  test.slow()
  test('Answer from notes through the CLI shows the tool trace', async ({ page, request }) => {
    const imported = await request.post(`${API}/api/notes/import`, {
      headers: H,
      multipart: {
        files: {
          name: 'redis-eviction.html',
          mimeType: 'text/html',
          buffer: readFileSync(join(import.meta.dirname, 'fixtures', 'redis-eviction.html')),
        },
      },
    })
    expect(imported.ok()).toBeTruthy()
    const p = await makeClaude(request, 'Claude assistant', 'sonnet')
    await assign(request, 'assistant', p.id, null)
    await page.goto('/')
    const agent = page.getByRole('complementary', { name: 'Agent' })
    const box = agent.getByRole('textbox', { name: 'Message the agent' })
    await box.fill('what did I learn about redis eviction?')
    await box.press('Enter')
    await expect(agent.getByText('FAKE-CLAUDE-ANSWER')).toBeVisible({ timeout: 60_000 })
    await expect(agent.getByText(`${p.name} · sonnet`, { exact: true })).toBeVisible()
    await agent.getByText('Used 2 tools').click()
    await expect(agent.getByText(/Searched notes for 'redis'/)).toBeVisible()
    await expect(agent.getByText(`Read note '${NOTE_TITLE}'`)).toBeVisible()
    await shot(page, 'claude-code-answer')
  })

  test('Lesson written through the CLI is saved with source agent and shown', async ({ page, request }) => {
    const p = await makeClaude(request, 'Claude writer', 'fake-write')
    await assign(request, 'lesson-writer', p.id, null)
    await page.goto(`/#/lesson/${LESSON}`)
    await page.getByRole('button', { name: 'Draft with agent' }).click()
    const agent = page.getByRole('complementary', { name: 'Agent' })
    await expect(agent.getByText(`I wrote the lesson for ${LESSON}.`)).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('lesson-body')).toContainText('Drafted by the fake CLI')
    const lesson = await (await request.get(`${API}/api/lessons/${LESSON}`)).json()
    expect(lesson.source).toBe('agent')
    expect(lesson.body).toContain('Caching keeps hot data close.')
    await shot(page, 'claude-code-lesson')
  })

  test('A user-written lesson is not overwritten through the CLI', async ({ request }) => {
    const mine = await request.put(`${API}/api/lessons/${LESSON}`, {
      headers: H,
      data: { body: 'My own words about caching.', source: 'user' },
    })
    expect(mine.ok()).toBeTruthy()
    const p = await makeClaude(request, 'Claude writer 2', 'fake-write')
    await assign(request, 'lesson-writer', p.id, null)
    const res = await request.post(`${API}/api/agent/chat`, {
      headers: H,
      data: { agent_id: 'lesson-writer', messages: [{ role: 'user', content: `Draft this lesson (${LESSON}).` }] },
    })
    expect(res.status(), await res.text()).toBe(200)
    expect((await res.json()).changed_lessons ?? []).toEqual([])
    const lesson = await (await request.get(`${API}/api/lessons/${LESSON}`)).json()
    expect(lesson.source).toBe('user')
    expect(lesson.body).toBe('My own words about caching.')
  })
})

test.describe('Limits and errors are categorized: chat', () => {
  test.slow()
  test('Usage limit with a fallback assigned: the fallback answers and is marked', async ({ page, request }) => {
    const primary = await makeClaude(request, 'Claude limited', 'fake-429')
    const fallback = await makeLocal(request, 'Backup', 'fake-ok')
    await assign(request, 'assistant', primary.id, fallback.id)
    await page.goto('/')
    const agent = page.getByRole('complementary', { name: 'Agent' })
    const box = agent.getByRole('textbox', { name: 'Message the agent' })
    await box.fill('hello')
    await box.press('Enter')
    await expect(agent.getByText('OK from fake')).toBeVisible({ timeout: 60_000 })
    await expect(agent.getByText(`${fallback.name} · fake-ok (fallback)`)).toBeVisible()
    await shot(page, 'claude-code-fallback')
  })

  test('Timeout stops the run and is reported as a timeout', async ({ page, request }) => {
    const p = await makeClaude(request, 'Claude slow', 'fake-slow', { timeout: 1 })
    await assign(request, 'assistant', p.id, null)
    const res = await request.post(`${API}/api/agent/chat`, {
      headers: H,
      data: { agent_id: 'assistant', messages: [{ role: 'user', content: 'hello' }] },
    })
    expect(res.status()).toBe(502)
    expect(JSON.stringify(await res.json())).toContain('timeout')
    await page.goto('/')
    const agent = page.getByRole('complementary', { name: 'Agent' })
    const box = agent.getByRole('textbox', { name: 'Message the agent' })
    await box.fill('hello')
    await box.press('Enter')
    await expect(agent.getByRole('alert').filter({ hasText: /timeout|did not answer/i })).toBeVisible({
      timeout: 60_000,
    })
    await shot(page, 'claude-code-timeout')
  })

  test('Not signed in is reported as auth failed without a fallback', async ({ request }) => {
    const p = await makeClaude(request, 'Claude out', 'fake-auth')
    await assign(request, 'assistant', p.id, null)
    const res = await request.post(`${API}/api/agent/chat`, {
      headers: H,
      data: { agent_id: 'assistant', messages: [{ role: 'user', content: 'hello' }] },
    })
    expect(res.status()).toBe(502)
    expect(JSON.stringify(await res.json())).toContain('auth_failed')
  })
})
