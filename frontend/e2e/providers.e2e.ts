/**
 * End-to-end checks for the ai-provider-management change: provider configurations,
 * agents and fallback, chat with a provider, the header guard. Every provider points
 * at the fake OpenAI-compatible server on port 8002 (e2e/fake_llm.py), never a real one.
 * Each test creates its own providers (unique names) and removes them afterwards.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const KEY = 'sk-test-abcd1234'
const NO_SUCH_ID = '00000000-0000-4000-8000-000000000000'

let counter = 0
const unique = (label: string) => `${label} ${Date.now().toString(36)}${counter++}`

interface Created {
  id: string
  name: string
}
const created: string[] = []

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

/** Creates a local provider through the API; it is deleted in afterEach. */
async function makeProvider(
  request: APIRequestContext,
  label: string,
  model: string,
  extra: Record<string, unknown> = {},
): Promise<Created> {
  const name = unique(label)
  const res = await request.post(`${API}/api/ai-providers`, {
    headers: H,
    data: { name, provider_type: 'local', model_name: model, base_url: FAKE, config: {}, ...extra },
  })
  expect(res.status(), await res.text()).toBe(201)
  const body = await res.json()
  created.push(body.id)
  return { id: body.id, name }
}

async function assign(request: APIRequestContext, agent: string, primary: string | null, fallback: string | null) {
  const res = await request.put(`${API}/api/agents/${agent}/provider`, {
    headers: H,
    data: { primary_provider_id: primary, fallback_provider_id: fallback },
  })
  expect(res.status(), await res.text()).toBe(200)
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
})

/** Fills the new-provider form; the type radio is chosen first because it resets the defaults. */
async function fillNew(
  page: Page,
  v: { type: string; name: string; model: string; key?: string; baseUrl?: string },
) {
  await page.goto('/#/settings/providers/new')
  const form = page.getByRole('region', { name: 'Provider configuration' })
  await form.getByRole('radio', { name: v.type, exact: true }).check({ force: true })
  await form.getByLabel('Name', { exact: true }).fill(v.name)
  await form.getByLabel('Model', { exact: true }).fill(v.model)
  if (v.key !== undefined) await form.getByLabel('API key').fill(v.key)
  if (v.baseUrl !== undefined) await form.getByLabel('Base URL').fill(v.baseUrl)
  return form
}

/** Registers a provider created through the UI for cleanup. */
async function trackByName(request: APIRequestContext, name: string) {
  const list = await (await request.get(`${API}/api/ai-providers`)).json()
  const found = list.find((p: { name: string }) => p.name === name)
  if (found) created.push(found.id)
  return found
}

test.describe('Manage provider configurations', () => {
  test('Create and list, Edit keeps the key, Deactivate', async ({ page, request }) => {
    const name = unique('Claude main')
    const form = await fillNew(page, { type: 'Local', name, model: 'fake-ok', key: KEY, baseUrl: FAKE })
    await form.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page).toHaveURL(/#\/settings\/providers\/[0-9a-f-]+$/)
    const row = await trackByName(request, name)
    await expect(form.getByRole('heading', { level: 1, name })).toBeVisible()
    await expect(form.getByLabel('API key')).toHaveAttribute('placeholder', 'Saved key (…1234), type to replace')
    await expect(form.getByRole('region', { name: 'Provider information' })).toContainText('Not tested yet')

    // Create and list
    await page.goto('/#/settings')
    const card = page.getByRole('article', { name })
    await expect(card).toContainText('Local · fake-ok')
    await expect(card).toContainText('Active')
    await expect(card).toContainText('Not tested yet')
    await shot(page, 'providers-list')

    // Edit keeps the key: change the temperature, leave the key field empty
    await card.getByRole('link', { name }).click()
    await form.getByLabel('Temperature', { exact: true }).fill('0.2')
    await form.getByRole('button', { name: 'Save Changes' }).click()
    await expect(form.getByText('Saved.')).toBeVisible()
    await page.reload()
    await expect(form.getByLabel('Temperature', { exact: true })).toHaveValue('0.2')
    await expect(form.getByLabel('API key')).toHaveAttribute('placeholder', 'Saved key (…1234), type to replace')
    const stored = await (await request.get(`${API}/api/ai-providers/${row.id}`)).json()
    expect(stored.has_key).toBe(true)
    expect(stored.key_hint).toBe('…1234')

    // Deactivate: the provider and its key are kept, but chat refuses to use it
    await form.getByLabel('Active').uncheck()
    await form.getByRole('button', { name: 'Save Changes' }).click()
    await expect(form.getByText('Saved.')).toBeVisible()
    await page.goto('/#/settings')
    await expect(page.getByRole('article', { name })).toContainText('Inactive')
    const chat = await request.post(`${API}/api/agent/chat`, {
      headers: H,
      data: { agent_id: 'assistant', provider_id: row.id, messages: [{ role: 'user', content: 'hi' }] },
    })
    expect(chat.status()).toBe(409)
    const after = await (await request.get(`${API}/api/ai-providers/${row.id}`)).json()
    expect(after.has_key).toBe(true)
    expect(after.is_active).toBe(false)
  })

  test('Duplicate name is refused with a message that the name is taken', async ({ page, request }) => {
    const first = await makeProvider(request, 'Twin', 'fake-ok')
    const form = await fillNew(page, { type: 'Local', name: first.name, model: 'fake-ok', baseUrl: FAKE })
    await form.getByRole('button', { name: 'Save Changes' }).click()
    await expect(form.getByRole('alert').filter({ hasText: /already taken/ })).toBeVisible()
    await expect(page).toHaveURL(/providers\/new$/)
    await shot(page, 'providers-duplicate-name')
    const list = await (await request.get(`${API}/api/ai-providers`)).json()
    expect(list.filter((p: { name: string }) => p.name === first.name)).toHaveLength(1)
  })
})

test.describe('Required fields and parameter ranges are validated', () => {
  test('Missing key names the API key field', async ({ page }) => {
    const form = await fillNew(page, { type: 'OpenAI', name: unique('No key'), model: 'gpt-x' })
    await form.getByRole('button', { name: 'Save Changes' }).click()
    await expect(form.getByLabel('API key')).toHaveAttribute('aria-invalid', 'true')
    await expect(form.getByRole('alert').filter({ hasText: /key/i })).toBeVisible()
    await expect(page).toHaveURL(/providers\/new$/)
    await shot(page, 'providers-missing-key')
  })

  test('Out of range temperature names the temperature field', async ({ page }) => {
    const form = await fillNew(page, { type: 'Local', name: unique('Hot'), model: 'fake-ok', baseUrl: FAKE })
    await form.getByLabel('Temperature', { exact: true }).fill('3')
    await form.getByRole('button', { name: 'Save Changes' }).click()
    await expect(form.getByLabel('Temperature', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(form.getByRole('alert').filter({ hasText: /temperature|between|0.*2/i })).toBeVisible()
    await expect(page).toHaveURL(/providers\/new$/)
    await shot(page, 'providers-out-of-range')
  })

  test('API refuses missing and out-of-range values naming the field', async ({ request }) => {
    const bad = await request.post(`${API}/api/ai-providers`, {
      headers: H,
      data: { name: unique('Bad'), provider_type: 'local', model_name: 'm', base_url: FAKE, config: { temperature: 3 } },
    })
    expect(bad.status()).toBe(422)
    expect(JSON.stringify((await bad.json()).detail)).toContain('temperature')
    const nokey = await request.post(`${API}/api/ai-providers`, {
      headers: H,
      data: { name: unique('Bad'), provider_type: 'anthropic', model_name: 'm', config: {} },
    })
    expect(nokey.status()).toBe(422)
    expect(JSON.stringify((await nokey.json()).detail)).toContain('api_key')
  })
})

test.describe('Only parameters the type supports are offered and sent', () => {
  test('Unsupported parameter is refused and the types list the supported parameters', async ({ request }) => {
    const res = await request.post(`${API}/api/ai-providers`, {
      headers: H,
      data: {
        name: unique('Anth'),
        provider_type: 'anthropic',
        model_name: 'claude-x',
        api_key: KEY,
        config: { frequency_penalty: 0.5 },
      },
    })
    expect(res.status()).toBe(422)
    const text = JSON.stringify((await res.json()).detail)
    expect(text).toContain('frequency_penalty')
    expect(text).toMatch(/not supported/i)

    const types = await (await request.get(`${API}/api/ai-providers/types`)).json()
    const byType = Object.fromEntries(types.map((t: { type: string }) => [t.type, t]))
    expect(Object.keys(byType).sort()).toEqual(['anthropic', 'claude-code', 'custom', 'gemini', 'local', 'openai'])
    expect(byType.anthropic.params).toContain('top_k')
    expect(byType.anthropic.params).not.toContain('frequency_penalty')
    expect(byType.local.params).toContain('frequency_penalty')
  })
})

test.describe('API keys are encrypted and never exposed', () => {
  test('Key never returned by list, read, update, test, models, chat or agents', async ({ request }) => {
    const name = unique('Secret')
    const create = await request.post(`${API}/api/ai-providers`, {
      headers: H,
      data: { name, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, api_key: KEY, config: {} },
    })
    expect(create.status()).toBe(201)
    const out = await create.json()
    created.push(out.id)
    const texts = [await create.text()]
    texts.push(await (await request.get(`${API}/api/ai-providers`)).text())
    texts.push(await (await request.get(`${API}/api/ai-providers/${out.id}`)).text())
    const upd = await request.put(`${API}/api/ai-providers/${out.id}`, {
      headers: H,
      data: { name, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: { temperature: 0.5 } },
    })
    expect(upd.status()).toBe(200)
    texts.push(await upd.text())
    texts.push(await (await request.post(`${API}/api/ai-providers/${out.id}/test`, { headers: H })).text())
    texts.push(
      await (
        await request.post(`${API}/api/ai-providers/test`, {
          headers: H,
          data: { name, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {}, provider_id: out.id },
        })
      ).text(),
    )
    texts.push(await (await request.get(`${API}/api/ai-providers/${out.id}/models`)).text())
    texts.push(
      await (
        await request.post(`${API}/api/agent/chat`, {
          headers: H,
          data: { agent_id: 'assistant', provider_id: out.id, messages: [{ role: 'user', content: 'hi' }] },
        })
      ).text(),
    )
    texts.push(await (await request.get(`${API}/api/agents`)).text())
    for (const t of texts) expect(t).not.toContain(KEY)
    expect(texts[0]).toContain('…1234')
    expect(texts[3]).toContain('…1234')
  })
})

test.describe('Base URLs are checked against SSRF', () => {
  test('Metadata address is refused for a custom provider, a local server is accepted', async ({ page, request }) => {
    const form = await fillNew(page, {
      type: 'Custom (OpenAI-compatible)',
      name: unique('Meta'),
      model: 'm',
      key: KEY,
      baseUrl: 'http://169.254.169.254/v1',
    })
    await form.getByRole('button', { name: 'Save Changes' }).click()
    await expect(form.getByRole('alert').filter({ hasText: /only allowed for Local/ })).toBeVisible()
    await expect(page).toHaveURL(/providers\/new$/)
    await shot(page, 'providers-ssrf')

    const name = unique('Ollama box')
    await form.getByRole('radio', { name: 'Local', exact: true }).check({ force: true })
    await form.getByLabel('Name', { exact: true }).fill(name)
    await form.getByLabel('Base URL').fill('http://localhost:11434/v1')
    await form.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page).toHaveURL(/#\/settings\/providers\/[0-9a-f-]+$/)
    await trackByName(request, name)
  })
})

test.describe('Test a connection with a categorized result', () => {
  const cases: Array<[string, string, string, Record<string, unknown>]> = [
    ['fake-ok', 'ok', 'Connected', {}],
    ['fake-401', 'auth_failed', 'Key rejected', {}],
    ['fake-404', 'invalid_model', 'Unknown model', {}],
    ['fake-429', 'rate_limited', 'Rate limited', {}],
    ['fake-500', 'unavailable', 'Unavailable', {}],
    ['fake-slow', 'timeout', 'Timed out', { config: { timeout: 1 } }],
  ]
  for (const [model, status, label, extra] of cases) {
    test(`Result ${status} for ${model}`, async ({ page, request }) => {
      const p = await makeProvider(request, `T ${status}`, model, extra)
      await page.goto(`/#/settings/providers/${p.id}`)
      const section = page.getByRole('region', { name: 'Test connection' })
      await expect(page.getByRole('region', { name: 'Provider information' })).toContainText('Not tested yet')
      await section.getByRole('button', { name: 'Test Connection' }).click()
      const result = section.locator(`[data-status="${status}"]`)
      await expect(result).toContainText(label, { timeout: 15_000 })
      if (status === 'ok') {
        await expect(result).toContainText(/Latency: \d+ ms/)
        await expect(page.getByRole('region', { name: 'Provider information' })).not.toContainText('Not tested yet')
        await shot(page, 'providers-test-ok')
      } else {
        await expect(result).toContainText('Provider message')
        await shot(page, `providers-test-${status}`)
      }
      // The result is stored on the saved configuration.
      const row = await (await request.get(`${API}/api/ai-providers/${p.id}`)).json()
      expect(row.last_test.status).toBe(status)
      expect(row.last_success_at !== null).toBe(status === 'ok')
    })
  }

  test('Test before saving tests the unsaved settings and saves nothing', async ({ page, request }) => {
    const name = unique('Unsaved')
    const form = await fillNew(page, { type: 'Local', name, model: 'fake-429', baseUrl: FAKE })
    await form.getByRole('button', { name: 'Test Connection' }).click()
    await expect(form.locator('[data-status="rate_limited"]')).toBeVisible({ timeout: 15_000 })
    const list = await (await request.get(`${API}/api/ai-providers`)).json()
    expect(list.some((p: { name: string }) => p.name === name)).toBe(false)
    await expect(page).toHaveURL(/providers\/new$/)
  })
})

test.describe('List the provider models', () => {
  test('Load models offers the ids the provider returned', async ({ page, request }) => {
    const p = await makeProvider(request, 'Models', 'fake-ok')
    await page.goto(`/#/settings/providers/${p.id}`)
    const form = page.getByRole('region', { name: 'Provider configuration' })
    await form.getByRole('button', { name: 'Load models' }).click()
    await expect(form.getByText(/Loaded 6 models/)).toBeVisible()
    for (const id of ['fake-ok', 'fake-401', 'fake-404', 'fake-429', 'fake-500', 'fake-slow']) {
      await expect(page.locator(`datalist option[value="${id}"]`)).toHaveCount(1)
    }
    await shot(page, 'providers-load-models')
  })
})

test.describe('Changes to provider settings come from this app only', () => {
  test('Missing header is answered forbidden and stores nothing', async ({ request }) => {
    const name = unique('No header')
    const res = await request.post(`${API}/api/ai-providers`, {
      data: { name, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {} },
    })
    expect(res.status()).toBe(403)
    const list = await (await request.get(`${API}/api/ai-providers`)).json()
    expect(list.some((p: { name: string }) => p.name === name)).toBe(false)

    const p = await makeProvider(request, 'Guarded', 'fake-ok')
    expect((await request.delete(`${API}/api/ai-providers/${p.id}`)).status()).toBe(403)
    const put = await request.put(`${API}/api/agents/assistant/provider`, {
      data: { primary_provider_id: p.id, fallback_provider_id: null },
    })
    expect(put.status()).toBe(403)
    expect((await request.get(`${API}/api/ai-providers/${p.id}`)).status()).toBe(200)
  })
})

test.describe('Delete is safe', () => {
  test('Provider in use is refused naming the Learning assistant, an unused one is deleted', async ({
    page,
    request,
  }) => {
    const p = await makeProvider(request, 'In use', 'fake-ok')
    await assign(request, 'assistant', p.id, null)
    await page.goto(`/#/settings/providers/${p.id}`)
    const form = page.getByRole('region', { name: 'Provider configuration' })
    await form.getByRole('button', { name: 'Delete', exact: true }).click()
    await form.getByRole('button', { name: 'Yes, delete' }).click()
    await expect(form.getByRole('alert').filter({ hasText: 'Learning assistant' })).toBeVisible()
    await shot(page, 'providers-delete-refused')
    expect((await request.get(`${API}/api/ai-providers/${p.id}`)).status()).toBe(200)

    await assign(request, 'assistant', null, null)
    await form.getByRole('button', { name: 'Delete', exact: true }).click()
    await form.getByRole('button', { name: 'Yes, delete' }).click()
    await expect(page).toHaveURL(/#\/settings$/)
    await expect(page.getByRole('article', { name: p.name })).toHaveCount(0)
    expect((await request.get(`${API}/api/ai-providers/${p.id}`)).status()).toBe(404)
  })
})

test.describe('Agents are defined in code and assigned providers', () => {
  test('List agents', async ({ request }) => {
    const agents = await (await request.get(`${API}/api/agents`)).json()
    expect(agents.map((a: { id: string; name: string }) => [a.id, a.name])).toEqual(
      expect.arrayContaining([
        ['assistant', 'Learning assistant'],
        ['lesson-writer', 'Lesson writer'],
      ]),
    )
  })

  test('Different providers per agent are assigned in Settings', async ({ page, request }) => {
    const claude = await makeProvider(request, 'Claude main', 'fake-ok')
    const qwen = await makeProvider(request, 'Local qwen', 'fake-ok')
    await page.goto('/#/settings')
    const assistant = page.getByRole('article', { name: 'Learning assistant' })
    await assistant.getByLabel('Primary provider').selectOption({ label: claude.name })
    await assistant.getByLabel('Fallback provider').selectOption({ label: qwen.name })
    await assistant.getByRole('button', { name: 'Save' }).click()
    await expect(assistant.getByText('Saved.')).toBeVisible()
    const writer = page.getByRole('article', { name: 'Lesson writer' })
    await writer.getByLabel('Primary provider').selectOption({ label: qwen.name })
    await writer.getByRole('button', { name: 'Save' }).click()
    await expect(writer.getByText('Saved.')).toBeVisible()
    await shot(page, 'settings-agents')

    await page.reload()
    const assistantAfter = page.getByRole('article', { name: 'Learning assistant' })
    await expect(assistantAfter.getByLabel('Primary provider')).toHaveValue(claude.id)
    await expect(assistantAfter.getByLabel('Fallback provider')).toHaveValue(qwen.id)
    await expect(page.getByRole('article', { name: 'Lesson writer' }).getByLabel('Primary provider')).toHaveValue(
      qwen.id,
    )
    const agents = await (await request.get(`${API}/api/agents`)).json()
    const get = (id: string) => agents.find((a: { id: string }) => a.id === id)
    expect(get('assistant').primary.id).toBe(claude.id)
    expect(get('lesson-writer').primary.id).toBe(qwen.id)
    await expect(page.getByRole('article', { name: claude.name })).toContainText('Learning assistant (primary)')
  })

  test('Same provider twice and unknown provider are refused, nothing changes', async ({ request }) => {
    const a = await makeProvider(request, 'Same', 'fake-ok')
    const same = await request.put(`${API}/api/agents/assistant/provider`, {
      headers: H,
      data: { primary_provider_id: a.id, fallback_provider_id: a.id },
    })
    expect(same.status()).toBeGreaterThanOrEqual(400)
    expect(same.status()).toBeLessThan(500)
    const unknown = await request.put(`${API}/api/agents/assistant/provider`, {
      headers: H,
      data: { primary_provider_id: NO_SUCH_ID, fallback_provider_id: null },
    })
    expect(unknown.status()).toBeGreaterThanOrEqual(400)
    expect(unknown.status()).toBeLessThan(500)
    const agent = await (await request.get(`${API}/api/agents/assistant/provider`)).json()
    expect(agent.primary).toBeNull()
    expect(agent.fallback).toBeNull()
    expect((await request.get(`${API}/api/agents/nope/provider`)).status()).toBe(404)
  })
})

test.describe('Provider resolution and fallback through the API', () => {
  const ask = (request: APIRequestContext, data: Record<string, unknown> = {}) =>
    request.post(`${API}/api/agent/chat`, {
      headers: H,
      data: { agent_id: 'assistant', messages: [{ role: 'user', content: 'hello' }], ...data },
    })

  test('No assignment uses the first active provider, a switched-off primary is skipped', async ({ request }) => {
    const first = await makeProvider(request, 'First', 'fake-ok')
    const second = await makeProvider(request, 'Second', 'fake-ok')
    let res = await ask(request)
    expect(res.status()).toBe(200)
    expect((await res.json()).provider.id).toBe(first.id)

    await assign(request, 'assistant', second.id, null)
    res = await ask(request)
    expect((await res.json()).provider.id).toBe(second.id)

    const off = await request.put(`${API}/api/ai-providers/${second.id}`, {
      headers: H,
      data: {
        name: second.name,
        provider_type: 'local',
        model_name: 'fake-ok',
        base_url: FAKE,
        config: {},
        is_active: false,
      },
    })
    expect(off.status()).toBe(200)
    res = await ask(request)
    expect(res.status()).toBe(200)
    expect((await res.json()).provider.id).toBe(first.id)
  })

  test('Chat naming an unknown provider is refused with not found', async ({ request }) => {
    expect((await ask(request, { provider_id: NO_SUCH_ID })).status()).toBe(404)
  })

  test('Wrong key does not fall back, both failing names both providers', async ({ request }) => {
    const bad = await makeProvider(request, 'Bad key', 'fake-401')
    const good = await makeProvider(request, 'Good', 'fake-ok')
    await assign(request, 'assistant', bad.id, good.id)
    let res = await ask(request)
    expect(res.status()).toBe(502)
    const detail = JSON.stringify(await res.json())
    expect(detail).toContain('auth_failed')
    expect(detail).not.toContain(good.name)

    const slow = await makeProvider(request, 'Slow', 'fake-slow', { config: { timeout: 1 } })
    const down = await makeProvider(request, 'Down', 'fake-500')
    await assign(request, 'assistant', slow.id, down.id)
    res = await ask(request)
    expect(res.status()).toBe(502)
    const both = JSON.stringify(await res.json())
    for (const part of [slow.name, down.name, 'timeout', 'unavailable']) expect(both).toContain(part)
  })
})

test.describe('Chat panel with provider configurations', () => {
  test('Ask a question: the answer names the provider and model', async ({ page, request }) => {
    const p = await makeProvider(request, 'Claude main', 'fake-ok')
    await assign(request, 'assistant', p.id, null)
    await page.goto('/')
    const agent = page.getByRole('complementary', { name: 'Agent' })
    await expect(agent.getByRole('combobox', { name: 'Provider' })).toContainText(`Agent default (${p.name} · fake-ok)`)
    const box = agent.getByRole('textbox', { name: 'Message the agent' })
    await box.fill('What is caching?')
    await box.press('Enter')
    await expect(agent.getByRole('log', { name: 'Conversation' })).toContainText('What is caching?')
    await expect(agent.getByText('OK from fake')).toBeVisible({ timeout: 20_000 })
    await expect(agent.getByText(`${p.name} · fake-ok`, { exact: true })).toBeVisible()
    await expect(agent.getByText('(fallback)')).toHaveCount(0)
    await shot(page, 'chat-answer')
  })

  test('Rate limited primary: the answer comes from the fallback and is marked', async ({ page, request }) => {
    const primary = await makeProvider(request, 'Limited', 'fake-429')
    const fallback = await makeProvider(request, 'Backup', 'fake-ok')
    await assign(request, 'assistant', primary.id, fallback.id)
    await page.goto('/')
    const agent = page.getByRole('complementary', { name: 'Agent' })
    const box = agent.getByRole('textbox', { name: 'Message the agent' })
    await box.fill('hello')
    await box.press('Enter')
    await expect(agent.getByText('OK from fake')).toBeVisible({ timeout: 20_000 })
    await expect(agent.getByText(`${fallback.name} · fake-ok (fallback)`)).toBeVisible()
    await shot(page, 'chat-fallback')
  })

  test('Override for one conversation leaves the assignment unchanged', async ({ page, request }) => {
    const main = await makeProvider(request, 'Claude main', 'fake-401')
    const qwen = await makeProvider(request, 'Local qwen', 'fake-ok')
    await assign(request, 'assistant', main.id, null)
    await page.goto('/')
    const agent = page.getByRole('complementary', { name: 'Agent' })
    await agent.getByRole('combobox', { name: 'Provider' }).selectOption({ label: qwen.name })
    const box = agent.getByRole('textbox', { name: 'Message the agent' })
    await box.fill('hello')
    await box.press('Enter')
    await expect(agent.getByText('OK from fake')).toBeVisible({ timeout: 20_000 })
    await expect(agent.getByText(`${qwen.name} · fake-ok`, { exact: true })).toBeVisible()
    const state = await (await request.get(`${API}/api/agents/assistant/provider`)).json()
    expect(state.primary.id).toBe(main.id)
  })

  test('Error shown under the question and the user can send again', async ({ page, request }) => {
    const bad = await makeProvider(request, 'Rejecting', 'fake-401')
    await assign(request, 'assistant', bad.id, null)
    await page.goto('/')
    const agent = page.getByRole('complementary', { name: 'Agent' })
    const box = agent.getByRole('textbox', { name: 'Message the agent' })
    await box.fill('first try')
    await box.press('Enter')
    await expect(agent.getByRole('alert').filter({ hasText: /auth_failed|key|authentication/i })).toBeVisible({
      timeout: 20_000,
    })
    await shot(page, 'chat-error')
    await box.fill('second try')
    await expect(agent.getByRole('button', { name: 'Send' })).toBeEnabled()
    await box.press('Enter')
    await expect(agent.getByRole('log', { name: 'Conversation' })).toContainText('second try')
  })
})
