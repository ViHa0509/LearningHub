/**
 * Spec checks for the change agent-tools-tab (openspec/changes/agent-tools-tab/specs/agent-settings):
 * Tools page under Agents (open, remove and save, add back, own tools only, Cancel), a removed tool is
 * not offered in a chat (fake LLM [[echo-tools]]), Connections page (Knowledge Hub card moved there).
 *
 * Not e2e-testable here: Claude Code provider (MCP server list), Interactive tutor keeps its output,
 * Reconnect notice opens Connections (needs the KH expiry flow), Another user, Round trip backup,
 * Both layers (backend pytest cover them). A foreign tool being refused is checked through the API.
 * Every tool set changed here is restored afterwards.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://127.0.0.1:8001/api'
const H = { 'X-LearningHub': '1' }
const FAKE = 'http://127.0.0.1:8002/v1'
const LABEL = 'Tools main'
const AGENTS = ['assistant', 'lesson-writer', 'outline', 'a2ui']

interface ToolSet {
  agent_id: string
  attached: string[]
  available: string[]
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-results/screens/${name}.png`, fullPage: true })
}

async function allSchemes(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await shot(page, `${name}-${scheme}`)
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

const toolSet = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`${API}/agents/${id}/tools`)).json()) as ToolSet

const original: Record<string, string[]> = {}

test.beforeEach(async ({ request }) => {
  for (const id of AGENTS) original[id] = (await toolSet(request, id)).attached
})

test.afterEach(async ({ request }) => {
  for (const id of AGENTS) {
    await request.put(`${API}/agents/${id}/tools`, { headers: H, data: { attached: original[id] } })
  }
  await request.put(`${API}/agents/assistant/provider`, { headers: H, data: { primary_provider_id: null, fallback_provider_id: null } })
  const providers = (await (await request.get(`${API}/ai-providers`)).json()) as Array<{ id: string; name: string }>
  for (const p of providers.filter((x) => x.name.startsWith(LABEL))) {
    await request.delete(`${API}/ai-providers/${p.id}`, { headers: H })
  }
})

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const toolsIn = (c: ReturnType<typeof card>, name: string) => c.locator('code').filter({ hasText: new RegExp(`^${name}$`) })
const options = (c: ReturnType<typeof card>) => c.getByRole('combobox', { name: 'Add tool' }).locator('option')

async function openTools(page: Page) {
  await page.goto('/#/settings')
  const nav = page.getByRole('navigation', { name: 'Settings sections' })
  await nav.getByRole('link', { name: 'Tools' }).click()
  await expect(page).toHaveURL(/#\/settings\/agents\/tools$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Tools' })).toBeVisible()
  await expect(card(page, 'Learning assistant')).toBeVisible()
}

test('Tools page under Agents: opens from the Settings nav and shows the four agent cards with described tools', async ({ page }) => {
  await openTools(page)
  const nav = page.getByRole('navigation', { name: 'Settings sections' })
  await expect(nav.getByRole('link', { name: 'Tools' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Connections' })).toBeVisible()
  for (const name of ['Learning assistant', 'Lesson writer', 'Topic outline', 'Interactive tutor']) {
    await expect(card(page, name)).toBeVisible()
  }
  const first = card(page, 'Learning assistant').locator('li').first()
  await expect(first.locator('code')).toBeVisible()
  await expect(first.locator('.muted')).not.toHaveText('')
  await allSchemes(page, 'agent-tools-page')
})

test('Add and remove an agent tool: remove write_lesson and Save, it survives a reload and the dropdown offers it; add it back', async ({ page, request }) => {
  await openTools(page)
  const a = card(page, 'Learning assistant')
  const save = a.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeDisabled()
  await expect(a.getByRole('button', { name: 'Cancel' })).toBeDisabled()

  await a.getByRole('button', { name: 'Remove write_lesson from Learning assistant' }).click()
  await expect(save).toBeEnabled()
  await expect(options(a).filter({ hasText: 'write_lesson' })).toHaveCount(1)
  expect((await toolSet(request, 'assistant')).attached).toContain('write_lesson')
  await shot(page, 'agent-tools-removed')
  await save.click()
  await expect(save).toBeDisabled()
  expect((await toolSet(request, 'assistant')).attached).not.toContain('write_lesson')

  await page.reload()
  await expect(a).toBeVisible()
  await expect(toolsIn(a, 'write_lesson')).toHaveCount(0)
  await expect(options(a).filter({ hasText: 'write_lesson' })).toHaveCount(1)

  await a.getByRole('combobox', { name: 'Add tool' }).selectOption('write_lesson')
  await a.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(toolsIn(a, 'write_lesson')).toHaveCount(1)
  await save.click()
  await expect(save).toBeDisabled()
  expect((await toolSet(request, 'assistant')).attached).toContain('write_lesson')
})

test("Only the agent's own tools: the Lesson writer dropdown never offers save_learned_note or propose_topics, a foreign tool is refused", async ({ page, request }) => {
  await openTools(page)
  const w = card(page, 'Lesson writer')
  const own = await toolSet(request, 'lesson-writer')
  const name = own.attached[0]
  await w.getByRole('button', { name: `Remove ${name} from Lesson writer` }).click()
  const offered = await options(w).allTextContents()
  expect(offered).toEqual([...own.available, name].filter((n) => offered.includes(n)))
  expect(offered).toContain(name)
  for (const foreign of ['save_learned_note', 'propose_topics']) expect(offered).not.toContain(foreign)
  await w.getByRole('button', { name: 'Cancel' }).click()

  const res = await request.put(`${API}/agents/lesson-writer/tools`, {
    headers: H,
    data: { attached: [...own.attached, 'save_learned_note'] },
  })
  expect(res.status()).toBeGreaterThanOrEqual(400)
  expect(res.status()).toBeLessThan(500)
  expect((await toolSet(request, 'lesson-writer')).attached).toEqual(own.attached)
})

test('Cancel: a removed tool comes back and nothing is stored', async ({ page, request }) => {
  await openTools(page)
  const a = card(page, 'Learning assistant')
  const before = (await toolSet(request, 'assistant')).attached
  await a.getByRole('button', { name: 'Remove read_note from Learning assistant' }).click()
  await expect(toolsIn(a, 'read_note')).toHaveCount(0)
  await a.getByRole('button', { name: 'Cancel' }).click()
  await expect(toolsIn(a, 'read_note')).toHaveCount(1)
  await expect(a.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  expect((await toolSet(request, 'assistant')).attached).toEqual(before)
  await page.reload()
  await expect(toolsIn(card(page, 'Learning assistant'), 'read_note')).toHaveCount(1)
})

test('A removed tool is not offered: search_notes removed from the assistant is not offered in a chat, the Lesson writer keeps it', async ({ page, request }) => {
  const res = await request.post(`${API}/ai-providers`, {
    headers: H,
    data: { name: `${LABEL} ${Date.now().toString(36)}`, provider_type: 'local', model_name: 'fake-ok', base_url: FAKE, config: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
  const provider = (await res.json()) as { id: string }
  await request.put(`${API}/agents/assistant/provider`, { headers: H, data: { primary_provider_id: provider.id, fallback_provider_id: null } })

  await openTools(page)
  const a = card(page, 'Learning assistant')
  await a.getByRole('button', { name: 'Remove search_notes from Learning assistant' }).click()
  await a.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(a.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()

  await page.goto('/')
  const agent = page.getByRole('complementary', { name: 'Agent' })
  const box = agent.getByRole('textbox', { name: 'Message the agent' })
  await expect(box).toBeVisible()
  await box.fill('[[echo-tools]]')
  await box.press('Enter')
  const line = agent.getByRole('log', { name: 'Conversation' }).getByText(/^TOOLS /)
  await expect(line).toBeVisible({ timeout: 20_000 })
  const names = (await line.textContent())!.replace('TOOLS ', '').trim().split(',')
  expect(names.length).toBeGreaterThan(0)
  expect(names).not.toContain('search_notes')
  await shot(page, 'agent-tools-chat-offered')

  expect((await toolSet(request, 'lesson-writer')).attached).toContain('search_notes')
})

test('Connections page under Agents: the Knowledge Hub card is there and not on the Agents page', async ({ page }) => {
  await page.goto('/#/settings')
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Connections' }).click()
  await expect(page).toHaveURL(/#\/settings\/agents\/connections$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Connections' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Knowledge Hub' })).toBeVisible()
  await allSchemes(page, 'agent-connections-page')

  await page.goto('/#/settings/agents')
  await expect(page.getByRole('region', { name: 'Areas' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('article', { name: 'Knowledge Hub' })).toHaveCount(0)
})

test('Tools and Connections pages on a phone: screenshots, no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/settings/agents/tools')
  await expect(card(page, 'Learning assistant')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await allSchemes(page, 'agent-tools-phone')
  await page.goto('/#/settings/agents/connections')
  await expect(page.getByRole('article', { name: 'Knowledge Hub' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await allSchemes(page, 'agent-connections-phone')
})
