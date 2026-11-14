/**
 * Spec checks for the change agent-web-search: the Internet search setting per agent in
 * Settings -> Agents (off by default, saved only with the card's Save, header guard), the
 * WebSearch tool shown in the trace when it is on with a Claude Code provider, and the note for
 * other provider types. The backend runs the fake `claude` (e2e/fake_claude.py, LH_CLAUDE_BIN):
 * it emits a synthetic WebSearch use only when started with `--tools WebSearch` and asked to
 * "search the web". Nothing is searched for real.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const API = 'http://127.0.0.1:8001'
const FAKE = 'http://127.0.0.1:8002/v1'
const H = { 'X-LearningHub': '1' }
const QUESTION = 'please search the web for redis eviction news'

let counter = 0
const unique = (label: string) => `${label} ${Date.now().toString(36)}${counter++}`
const created: string[] = []

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

async function makeProvider(
  request: APIRequestContext,
  label: string,
  type: 'claude-code' | 'local',
  model: string,
) {
  const name = unique(label)
  const data =
    type === 'claude-code'
      ? { name, provider_type: type, model_name: model, config: {} }
      : { name, provider_type: type, model_name: model, base_url: FAKE, config: {} }
  const res = await request.post(`${API}/api/ai-providers`, { headers: H, data })
  expect(res.status(), await res.text()).toBe(201)
  const body = await res.json()
  created.push(body.id)
  return { id: body.id as string, name }
}

async function assignAssistant(request: APIRequestContext, primary: string | null) {
  const res = await request.put(`${API}/api/agents/assistant/provider`, {
    headers: H,
    data: { primary_provider_id: primary, fallback_provider_id: null },
  })
  expect(res.status(), await res.text()).toBe(200)
}

async function webSearchOf(request: APIRequestContext, agent = 'assistant'): Promise<boolean> {
  const agents = (await (await request.get(`${API}/api/agents`)).json()) as Array<{ id: string; web_search: boolean }>
  return agents.find((a) => a.id === agent)!.web_search
}

async function ask(page: Page, text: string) {
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await box.fill(text)
  await box.press('Enter')
  await expect(agent.getByText('FAKE-CLAUDE-ANSWER')).toBeVisible({ timeout: 60_000 })
  return agent
}

test.afterEach(async ({ request }) => {
  for (const agent of ['assistant', 'lesson-writer']) {
    await request.put(`${API}/api/agents/${agent}/settings`, { headers: H, data: { web_search: false } })
    await request.put(`${API}/api/agents/${agent}/provider`, {
      headers: H,
      data: { primary_provider_id: null, fallback_provider_id: null },
    })
  }
  while (created.length > 0) {
    await request.delete(`${API}/api/ai-providers/${created.pop()}`, { headers: H })
  }
})

test.describe('Internet search per agent', () => {
  // Each answer starts the fake CLI and the app's tool server: slow on a loaded machine.
  test.slow()

  test('Off by default: the setting is off and the agent does not search the web', async ({ page, request }) => {
    expect(await webSearchOf(request, 'assistant')).toBe(false)
    expect(await webSearchOf(request, 'lesson-writer')).toBe(false)
    const p = await makeProvider(request, 'Claude web', 'claude-code', 'sonnet')
    await assignAssistant(request, p.id)

    await page.goto('/#/settings')
    const card = page.getByRole('article', { name: 'Learning assistant' })
    await expect(card.getByRole('checkbox', { name: 'Internet search' })).not.toBeChecked()
    await expect(card).not.toContainText('needs a Claude Code provider')

    await page.goto('/')
    const agent = await ask(page, QUESTION)
    await expect(agent.getByText('From the web')).toHaveCount(0)
    await agent.getByText(/^Used \d+ tools?$/).click()
    await expect(agent.getByText(/Searched notes for 'redis'/)).toBeVisible()
    await expect(agent.getByText(/Searched the web for/)).toHaveCount(0)
  })

  test('Setting needs Save and the app header', async ({ page, request }) => {
    const p = await makeProvider(request, 'Claude web', 'claude-code', 'sonnet')
    await assignAssistant(request, p.id)
    await page.goto('/#/settings')
    const card = page.getByRole('article', { name: 'Learning assistant' })
    const box = card.getByRole('checkbox', { name: 'Internet search' })
    await box.check()
    await expect(box).toBeChecked()
    expect(await webSearchOf(request)).toBe(false)
    await page.reload()
    await expect(page.getByRole('article', { name: 'Learning assistant' }).getByRole('checkbox', { name: 'Internet search' })).not.toBeChecked()
    expect(await webSearchOf(request)).toBe(false)

    const bare = await request.put(`${API}/api/agents/assistant/settings`, { data: { web_search: true } })
    expect(bare.status()).toBe(403)
    expect(await webSearchOf(request)).toBe(false)
  })

  test('Search when enabled: saved with Save, the trace shows the web search and the answer lists sources', async ({
    page,
    request,
  }) => {
    const p = await makeProvider(request, 'Claude web', 'claude-code', 'sonnet')
    await assignAssistant(request, p.id)
    await page.goto('/#/settings')
    const card = page.getByRole('article', { name: 'Learning assistant' })
    await expect(card).toContainText('Lets the agent search the web')
    await card.getByRole('checkbox', { name: 'Internet search' }).check()
    await card.getByRole('button', { name: 'Save' }).click()
    await expect(card.getByText('Saved.')).toBeVisible()
    await expect.poll(() => webSearchOf(request)).toBe(true)
    // Only the assistant changed.
    expect(await webSearchOf(request, 'lesson-writer')).toBe(false)
    await shot(page, 'settings-web-search')

    await page.reload()
    await expect(
      page.getByRole('article', { name: 'Learning assistant' }).getByRole('checkbox', { name: 'Internet search' }),
    ).toBeChecked()

    await page.goto('/')
    const agent = await ask(page, QUESTION)
    await expect(agent.getByText(/From the web: fake findings about redis/)).toBeVisible()
    await expect(agent.getByText(/https:\/\/example\.test\/fake-web-result/).first()).toBeVisible()
    await agent.getByText(/^Used \d+ tools?$/).click()
    await expect(agent.getByText("Searched the web for 'redis latest news'")).toBeVisible()
    await shot(page, 'agent-web-search-trace')
  })

  test('Not a Claude Code or Anthropic provider: the setting says it needs one', async ({ page, request }) => {
    const p = await makeProvider(request, 'OpenAI-like', 'local', 'fake-ok')
    await assignAssistant(request, p.id)
    await page.goto('/#/settings')
    const card = page.getByRole('article', { name: 'Learning assistant' })
    await expect(card.getByRole('checkbox', { name: 'Internet search' })).toBeVisible()
    await expect(card).toContainText('Internet search needs a Claude Code or Anthropic provider; it has no effect with the current one.')
    await shot(page, 'settings-web-search-other-provider')
  })
})
